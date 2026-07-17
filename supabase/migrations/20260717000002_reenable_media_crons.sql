-- =============================================================================
-- Re-enable the two QUEUE-BASED media crons (drain + refresh feeder)
-- =============================================================================
-- Idempotent. Manual `supabase db push --linked`.
--
-- These two were unscheduled during the Meta-throttle diagnosis and held off until
-- Full access + the fetch rework + the page-token backlog fix shipped (all now live:
-- PRs #52/#55/#56/#57, migration 20260717000001). This re-schedules ONLY the two
-- bounded, queue-driven media crons — NOT the retired US-011 blind-fanout crons that
-- caused the original throttling, and NOT (yet) the sync/backfill/thumbnail pollers.
--
--   • drain-media-queue-2min   — pokes the bounded drain worker (BATCH_SIZE=5,
--     self-chaining, per-invocation fresh memory). Resolves + caches queued media.
--   • refresh-media-queue-15min — the bounded self-heal feeder that enqueues
--     eligible-but-not-covered ads (now incl. re-cacheable video_permission) oldest-
--     first, honoring exponential backoff. NOT a blind fanout.
--
-- Definitions are byte-identical to their originals (migrations 20260714000008 /
-- 20260714000028); unschedule-by-name first so this is a safe idempotent replay.
-- =============================================================================

-- ── drain-media-queue-2min ───────────────────────────────────────────────────
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

-- ── refresh-media-queue-15min ────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'refresh-media-queue-15min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'refresh-media-queue-15min',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/refresh-media-queue',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);
