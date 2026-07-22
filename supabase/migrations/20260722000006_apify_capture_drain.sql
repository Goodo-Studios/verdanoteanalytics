-- =============================================================================
-- US-003 — Apify capture-drain: pause the (no-op) resolver cron, add the capture
--          queue index + single-flight primitive, register the drain pg_cron.
-- =============================================================================
-- ONE additive + idempotent migration. Manual `supabase db push --linked`
-- (CI does NOT run migrations — see MIGRATIONS.md). Re-running is a safe no-op.
--
-- Numbering: 20260722000006 follows the remote + local ledger frontier
-- (…20260722000005_resolve_ad_archive_ids) so ordering is preserved.
--
-- Four concerns, all part of wiring the US-002 per-ad capture into the pipeline:
--   1. PAUSE the resolve-ad-archive-ids-30min cron (blocked upstream — it burns
--      shared app-wide Meta quota for a no-op until Ad Library API access lands).
--   2. Partial index serving the newest-first capture queue drain.
--   3. A durable single-flight primitive so the drain cron never overlaps itself.
--   4. Register the apify-capture-drain pg_cron poke (cron-evaporation lesson).
-- =============================================================================

-- ─── 1. PAUSE the resolver cron (US-001B) ────────────────────────────────────
-- US-001B is BLOCKED: Meta Ad Library API access is permission-denied for our app,
-- so ad_archive_id_status is NULL for all creatives and the resolver's 30-min cron
-- currently NO-OPS — yet each free-path sweep still consumes shared, app-wide Meta
-- quota (the same budget the live sync + media drain compete for). Unschedule it
-- until access is granted. Unschedule-by-name = idempotent (mirrors the existing
-- 20260717000003_pause_media_crons pattern).
--
-- RE-ENABLE once Meta Ad Library access is granted: re-run the schedule block from
-- 20260722000005_resolve_ad_archive_ids.sql (the `cron.schedule('resolve-ad-
-- archive-ids-30min', '*/30 * * * *', ...)` statement), or apply a small
-- reenable-guarded migration mirroring 20260717000005_reenable_media_crons_guarded.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'resolve-ad-archive-ids-30min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

-- ─── 2. Capture-queue drain index (newest-first) ─────────────────────────────
-- The drain selects creatives that are resolved + pending + uncaptured, NEWEST
-- FIRST. A tight PARTIAL index on created_time DESC, predicated on exactly the
-- drain filter (apify_capture_status='pending' AND ad_archive_id_status='resolved'),
-- serves the order+limit off the index and stays tiny on this large hot table (it
-- indexes only the live capture queue — empty today, so index maintenance is nil).
CREATE INDEX IF NOT EXISTS idx_creatives_apify_capture_queue
  ON public.creatives (created_time DESC)
  WHERE apify_capture_status = 'pending' AND ad_archive_id_status = 'resolved';

COMMENT ON INDEX public.idx_creatives_apify_capture_queue IS
  'US-003: partial index serving the apify-capture-drain queue (apify_capture_status'
  '=''pending'' AND ad_archive_id_status=''resolved''), ordered created_time DESC so '
  'the drain reads the newest resolved-but-uncaptured creatives off the index.';

-- ─── 3. Single-flight primitive for the drain cron ───────────────────────────
-- A one-row lock table (NOT a session advisory lock — PostgREST pools connections,
-- so a session lock would release when the claim RPC returns). Mirrors
-- apify_resolver_state from 20260722000005. The drain's cron poke (chain=0) claims
-- before working and releases in `finally`; self-chain continuations (chain>0) ARE
-- the running flight and never claim. Reclaimed after a staleness window so a
-- crashed flight cannot wedge the drain.
CREATE TABLE IF NOT EXISTS public.apify_drain_state (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  running_since timestamptz
);
INSERT INTO public.apify_drain_state (id, running_since)
  VALUES (true, NULL)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.apify_drain_state ENABLE ROW LEVEL SECURITY;
-- Service-role only (bypasses RLS); no public policies, like apify_resolver_state.

COMMENT ON TABLE public.apify_drain_state IS
  'US-003: single-row single-flight lock for the apify-capture-drain cron. '
  'running_since = when the current flight claimed the lock (NULL = free). Reclaimed '
  'after a staleness window so a crashed flight cannot wedge the drain.';

-- Atomically claim the lock iff free or older than p_stale_seconds. Returns true on
-- claim, false when another live flight holds it. (Twin of claim_resolver_singleflight.)
CREATE OR REPLACE FUNCTION public.claim_apify_drain_singleflight(p_stale_seconds int DEFAULT 900)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.apify_drain_state
     SET running_since = now()
   WHERE id = true
     AND (running_since IS NULL OR running_since < now() - make_interval(secs => p_stale_seconds))
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_apify_drain_singleflight()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.apify_drain_state SET running_since = NULL WHERE id = true;
$$;

COMMENT ON FUNCTION public.claim_apify_drain_singleflight(int) IS
  'US-003: atomically claim the apify-capture-drain single-flight lock (free or stale). Returns true on claim.';
COMMENT ON FUNCTION public.release_apify_drain_singleflight() IS
  'US-003: release the apify-capture-drain single-flight lock.';

-- ─── 4. pg_cron poke (registration IN-MIGRATION — cron-evaporation lesson) ────
-- Pokes apify-capture-drain every 10 min with an EMPTY body. The drain single-
-- flight-claims, captures a bounded newest-first batch of resolved+pending
-- creatives (calling apify-capture per ad), self-chains while pending rows remain,
-- stops on 'budget_exceeded', and is INERT when the queue is empty (returns
-- no_work, releases the lock, does nothing — no captures, no spend, no Meta calls).
-- SAFE to go live today: ad_archive_id_status is NULL for every creative, so the
-- resolved+pending queue is EMPTY and the drain no-ops cleanly.
--
-- Uses the exact cron idiom the resolver/media crons use: hardcoded function URL +
-- service-role bearer from vault.decrypted_secrets. Unschedule-by-name first so a
-- replay is idempotent.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'apify-capture-drain-10min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'apify-capture-drain-10min',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/apify-capture-drain',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify (run manually after push) ──────────────────────────────────────────
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('apify-capture-drain-10min', 'resolve-ad-archive-ids-30min');
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_creatives_apify_capture_queue';
--   SELECT apify_capture_status, ad_archive_id_status, count(*) FROM public.creatives GROUP BY 1, 2;
