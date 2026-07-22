-- =============================================================================
-- US-001B — ad_archive_id resolver: index fix, single-flight, pg_cron
-- =============================================================================
-- ONE additive + idempotent migration. Manual `supabase db push --linked`
-- (CI does NOT run migrations — see MIGRATIONS.md). Re-running is a safe no-op.
--
-- Numbering: 20260722000005 follows the remote + local ledger frontier
-- (…20260722000004_apify_creative_capture_bookkeeping) so ordering is preserved.
--
-- Three concerns, all needed by the resolver edge fn (resolve-ad-archive-ids):
--   1. Fix the queue index so BOTH downstream queue predicates are index-served.
--   2. A durable single-flight primitive so the cron never overlaps its own drain.
--   3. Register the pg_cron poke IN THIS MIGRATION (cron-evaporation lesson).
-- =============================================================================

-- ─── 1. Queue index fix (schema-phase review finding) ────────────────────────
-- The US-001 index predicate `ad_archive_id_status IS DISTINCT FROM 'unresolvable'`
-- is NOT sargable for the two queue queries: the planner cannot prove that either
--   • resolver queue:  `ad_archive_id_status IS NULL`
--   • capture queue:   `ad_archive_id_status = 'resolved'`
-- is implied by `IS DISTINCT FROM 'unresolvable'`, so it falls back to a seq scan
-- on this large hot table. Replace it with an explicit disjunction the planner CAN
-- match against both predicates. Guarded drop+create = idempotent re-apply.
DROP INDEX IF EXISTS idx_creatives_ad_archive_id_status;
CREATE INDEX IF NOT EXISTS idx_creatives_ad_archive_id_status
  ON public.creatives (ad_archive_id_status)
  WHERE (ad_archive_id_status IS NULL OR ad_archive_id_status = 'resolved');

COMMENT ON INDEX public.idx_creatives_ad_archive_id_status IS
  'US-001B: partial index serving BOTH the resolver queue (ad_archive_id_status IS NULL) '
  'and the US-002 capture queue (= ''resolved''). Predicate is an explicit disjunction so '
  'the planner can prove index-usability for each queue query; terminal ''unresolvable'' '
  'rows are excluded to keep it small on this hot table.';

-- ─── 2. Single-flight primitive for the cron drain ───────────────────────────
-- A one-row lock table (not a session advisory lock — PostgREST pools connections,
-- so a session lock would release the moment the claim RPC returns). The claim RPC
-- atomically takes the lock only when free or stale; the release RPC frees it. The
-- resolver's cron poke (chain=0) claims before working and releases in `finally`;
-- self-chain continuations (chain>0) ARE the running flight and never claim.
CREATE TABLE IF NOT EXISTS public.apify_resolver_state (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  running_since timestamptz
);
INSERT INTO public.apify_resolver_state (id, running_since)
  VALUES (true, NULL)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.apify_resolver_state ENABLE ROW LEVEL SECURITY;
-- Service-role only (bypasses RLS); no public policies, like apify_spend.

COMMENT ON TABLE public.apify_resolver_state IS
  'US-001B: single-row single-flight lock for the resolve-ad-archive-ids cron drain. '
  'running_since = when the current flight claimed the lock (NULL = free). Reclaimed '
  'after a staleness window so a crashed flight cannot wedge the drain.';

-- Atomically claim the lock iff free or older than p_stale_seconds. Returns true on
-- claim, false when another live flight holds it.
CREATE OR REPLACE FUNCTION public.claim_resolver_singleflight(p_stale_seconds int DEFAULT 900)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.apify_resolver_state
     SET running_since = now()
   WHERE id = true
     AND (running_since IS NULL OR running_since < now() - make_interval(secs => p_stale_seconds))
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_resolver_singleflight()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.apify_resolver_state SET running_since = NULL WHERE id = true;
$$;

COMMENT ON FUNCTION public.claim_resolver_singleflight(int) IS
  'US-001B: atomically claim the resolver single-flight lock (free or stale). Returns true on claim.';
COMMENT ON FUNCTION public.release_resolver_singleflight() IS
  'US-001B: release the resolver single-flight lock.';

-- ─── 3. pg_cron poke (registration IN-MIGRATION — cron-evaporation lesson) ────
-- Pokes resolve-ad-archive-ids every 30 min with an EMPTY body. Empty body =>
-- FREE-PATH-ONLY cron mode (never spends): the fn single-flight-claims, sweeps the
-- next account that still has unresolved (status IS NULL) creatives, self-chains
-- while accounts remain, and is INERT when the queue is empty (returns no_work,
-- releases the lock, does nothing). New creatives arriving from sync get a free
-- Ad Library resolution attempt automatically; the paid Apify fallback is NEVER
-- triggered by cron (only by an explicit allow_fallback=true manual call).
--
-- Uses the exact cron idiom the media/analyze crons use: hardcoded function URL +
-- service-role bearer from vault.decrypted_secrets. Unschedule-by-name first so a
-- replay is idempotent.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'resolve-ad-archive-ids-30min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'resolve-ad-archive-ids-30min',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/resolve-ad-archive-ids',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify (run manually after push) ──────────────────────────────────────────
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'resolve-ad-archive-ids-30min';
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_creatives_ad_archive_id_status';
--   SELECT ad_archive_id_status, count(*) FROM public.creatives GROUP BY 1;
