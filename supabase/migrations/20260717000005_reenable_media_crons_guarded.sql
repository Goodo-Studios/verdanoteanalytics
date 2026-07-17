-- =============================================================================
-- Re-enable the two queue-based media crons (now throttle-safe)
-- =============================================================================
-- Idempotent. Manual `supabase db push --linked`.
--
-- Safe to re-enable now that the throttle drivers are fixed (PR #60 / migration
-- 20260717000004):
--   • the feeder is SCOPED to ad_accounts.media_backfill_enabled accounts (only the
--     ~2 with Pages assigned today), so the queue holds only resolvable ads;
--   • the drain is SINGLE-FLIGHT (a chain=0 poke no-ops while a chain is active), so
--     only one bounded ~500-ad chain — the canary-proven safe profile — runs at once;
--   • the feeder no longer pokes the drain.
-- Definitions byte-identical to migration 20260714000008 / 20260714000028;
-- unschedule-by-name first for idempotent replay.
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
