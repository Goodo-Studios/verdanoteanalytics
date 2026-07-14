-- US-011: Retire blind fanout scans and cut over the media pipeline to the queue.
--
-- WS2 cutover. US-008 made sync ENQUEUE only newly-inserted ads into
-- public.media_cache_queue; US-009 added within-account media dedupe; US-010 added
-- the in-stack drain-media-queue worker (claim RPC + 2-min pg_cron + self-chain) and
-- UNSCHEDULED the blind-fanout + OOM/stuck-media churn crons. This migration completes
-- the cutover so drain-media-queue is the SOLE media pipeline:
--
--   1. RE-ASSERTS that every blind-fanout discovery/cache cron and every stuck-media
--      cleanup cron is unscheduled. US-010 already unscheduled these, but an older
--      fanout migration re-running (a `supabase db push` replay) could re-create one,
--      so we idempotently sweep them again here. Unschedule-by-name is a no-op when a
--      job is already absent, so this is safe on every replay.
--   2. Leaves the drain-media-queue-2min cron (US-010) as the only media scheduler.
--   3. Removes NO function directory — enrich-thumbnails and cleanup-stuck-media are
--      KEPT for manual repair/force use only (they are off every sync and cron path
--      after this story). So per verdanote-config-toml-audit-on-function-deletion,
--      config.toml and scripts/deploy-functions.sh are correctly left untouched: no
--      [functions.X] entry is now a ghost, and nothing was deleted.
--
-- The blind-fanout code CALLER retired by this story lives in application code, not
-- SQL: sync/index.ts previously fired `enrich-thumbnails?scope=all` (a whole-account
-- re-scan) after every sync; US-011 replaces that with a drain-media-queue poke. This
-- migration is the DB-side half of the same cutover — it guarantees no scheduler ever
-- resurrects the fanout.
--
-- Idempotent: only DO-block unschedules (no schema change), each a no-op if the job is
-- absent. Numbered 20260714000009 — strictly after 20260714000008
-- (drain_media_queue_worker), whose crons this migration reasons about, per
-- verdanote-supabase-migration-numbering-order-before-references.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- ── Re-assert the blind-fanout + stuck-media churn crons stay retired ─────────
-- Every job name ever scheduled by the fanout/cleanup migrations
-- (20260601000001/000004/000005/000006, 20260602000001/000004) plus the maint
-- aliases. Sweeping by the full name set means a replayed older migration cannot
-- leave a fanout cron live behind our back.
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

-- Belt-and-suspenders: catch any not-yet-known media-* / cleanup-stuck-media-* job
-- that pokes enrich-thumbnails or cleanup-stuck-media, EXCEPT the queue drain itself.
-- The drain-media-queue-2min cron (US-010) is the ONE media scheduler that must stay.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE (command ILIKE '%/functions/v1/enrich-thumbnails%'
        OR command ILIKE '%/functions/v1/cleanup-stuck-media%')
      AND jobname <> 'drain-media-queue-2min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

-- ── Verify (run manually after push) ─────────────────────────────────────────
--   -- The ONLY remaining media cron must be the queue drain:
--   SELECT jobname, schedule, active FROM cron.job
--   WHERE command ILIKE '%/functions/v1/enrich-thumbnails%'
--      OR command ILIKE '%/functions/v1/cleanup-stuck-media%'
--      OR command ILIKE '%/functions/v1/drain-media-queue%';
--   -- expect exactly one row: drain-media-queue-2min
--
--   -- No blind-fanout / stuck-media jobs remain:
--   SELECT jobname FROM cron.job
--   WHERE jobname LIKE 'media-%' OR jobname LIKE 'cleanup-stuck-media-%';
--   -- expect empty
