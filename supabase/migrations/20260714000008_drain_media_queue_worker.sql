-- US-010: In-stack video download queue worker — claim RPC + pg_cron poke, and
-- retire the OOM/stuck-media churn crons the queue makes unnecessary.
--
-- The drain-media-queue edge function drains public.media_cache_queue (US-008) via
-- a queue-backed, self-chaining worker that stays within Supabase. This migration:
--   1. Adds claim_media_cache_queue(p_limit) — atomically claims a batch of pending
--      rows (FOR UPDATE SKIP LOCKED) so concurrent invocations never grab the same
--      ad, marks them 'processing', bumps attempts, and returns them.
--   2. Requeues rows stuck in 'processing' longer than a stale-claim window (a worker
--      died mid-flight — e.g. OOM), so a dead claim self-heals without a separate
--      cleanup cron. This is the in-queue replacement for the stuck-media guard.
--   3. Schedules a pg_cron that pokes drain-media-queue on a steady cadence; the
--      worker's own self-chain handles bursts within a drain.
--   4. RETIRES the blind-fanout + OOM/stuck-media churn crons that the queue makes
--      unnecessary (media-cache-fanout-maint, media-video-discover-maint, and the
--      cleanup-stuck-media crons). The video download path no longer OOMs a shared
--      worker or strands a 'running' media_refresh_log, so the stuck-log cleanup
--      cron has nothing to clean. (The cleanup-stuck-media EDGE FUNCTION itself is
--      simplified but kept for manual use; its config.toml/deploy entries stay — no
--      function directory is removed in this story, so config-toml-audit-on-function-
--      deletion does not trigger. A new function directory IS added — drain-media-
--      queue — so scripts/deploy-functions.sh + config.toml gain it in this same
--      commit, per verdanote-supabase-add-function.)
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP/CREATE POLICY not needed (function
-- only), and every cron.schedule is preceded by an unschedule of the prior job name,
-- so `supabase db push` re-runs are safe no-ops and the ledger reconciles cleanly
-- (per verdanote-supabase-ledger-drift-reconcile-with-db-push). Numbered
-- 20260714000008 — strictly after 20260714000006 (media_cache_queue), whose table
-- and columns this migration references (per
-- verdanote-supabase-migration-numbering-order-before-references).

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Atomic claim RPC ─────────────────────────────────────────────────────────
-- Claims up to p_limit rows that are either 'pending' OR 'processing' but stale
-- (claimed by a worker that died > 5 min ago — edge fns hard-cap at 150s, so any
-- 'processing' row older than 5 min is definitively abandoned). FOR UPDATE SKIP
-- LOCKED lets multiple concurrent workers claim disjoint batches without blocking.
-- Marks the claimed rows 'processing', bumps attempts, and RETURNS them so the
-- worker knows which ads to cache.
--
-- SECURITY DEFINER + a pinned search_path so the service-role caller runs it with
-- table owner rights regardless of RLS (the worker uses the service role, which
-- bypasses RLS anyway, but this keeps the RPC self-contained).
CREATE OR REPLACE FUNCTION public.claim_media_cache_queue(p_limit INTEGER DEFAULT 5)
RETURNS SETOF public.media_cache_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT q.ad_id
    FROM public.media_cache_queue q
    WHERE q.status = 'pending'
       OR (q.status = 'processing' AND q.updated_at < now() - INTERVAL '5 minutes')
    ORDER BY q.enqueued_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.media_cache_queue mq
  SET status = 'processing',
      attempts = mq.attempts + 1,
      updated_at = now()
  FROM claimable c
  WHERE mq.ad_id = c.ad_id
  RETURNING mq.*;
END;
$$;

COMMENT ON FUNCTION public.claim_media_cache_queue(INTEGER) IS
  'US-010: Atomically claim up to p_limit media_cache_queue rows for the drain-media-queue worker. Picks pending rows OR processing rows stale > 5 min (a dead worker self-heals — the in-queue replacement for the stuck-media cleanup cron). FOR UPDATE SKIP LOCKED lets concurrent workers claim disjoint batches. Marks claimed rows processing, bumps attempts, returns them.';

-- Only the service role (the worker) may claim. Revoke the broad default grant and
-- grant to service_role explicitly so no client JWT can drain the queue.
REVOKE ALL ON FUNCTION public.claim_media_cache_queue(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_media_cache_queue(INTEGER) TO service_role;

-- ── Schedule the drain worker — every 2 minutes ──────────────────────────────
-- The worker self-chains within an invocation to handle a burst; this cron just
-- guarantees the queue keeps draining even if a chain link is dropped. A poke that
-- finds an empty queue is a cheap no-op (claims 0 rows, chains nothing).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'drain-media-queue-2min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'drain-media-queue-2min',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/drain-media-queue',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Retire the churn crons the queue makes unnecessary ───────────────────────
-- The queue-driven worker (bounded batch, streaming upload, per-invocation fresh
-- memory, self-heal on stale claim) replaces:
--   * the blind-fanout media crons that poked enrich-thumbnails against every
--     account every few minutes (media-cache-fanout-maint, media-video-discover-
--     maint, and any lingering backfill-era names), and
--   * the cleanup-stuck-media crons whose entire job was to release media_refresh_
--     logs stranded by an OOM death — a failure mode the queue removes.
-- Unschedule by name; each is a no-op if already absent, so this is idempotent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN (
    'media-cache-fanout-maint',
    'media-video-discover-maint',
    'media-cache-fanout-2min',
    'media-video-discover-3min',
    'media-video-cache-2min',
    'media-miracle-discover-4min',
    'media-miracle-cache-4min',
    'cleanup-stuck-media-10min',
    'cleanup-stuck-media-2min'
  ) LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'drain-media-queue-2min';
--   SELECT jobname FROM cron.job WHERE jobname LIKE 'media-%' OR jobname LIKE 'cleanup-stuck-media-%';  -- should be empty
--   SELECT * FROM public.claim_media_cache_queue(3);  -- claims a batch (or returns 0 rows)
