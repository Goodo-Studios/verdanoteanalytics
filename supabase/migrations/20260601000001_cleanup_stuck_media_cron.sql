-- Scheduled cleanup of stuck media-refresh logs.
--
-- Why: enrich-thumbnails has a per-account concurrency guard that SKIPS a run
-- while any media_refresh_logs row for that account is status='running'. If a
-- run dies mid-flight (e.g. WORKER_RESOURCE_LIMIT during the heavy video-caching
-- phase) its log is never marked complete, so the guard blocks ALL future media
-- refreshes for that account indefinitely. This is exactly what stranded Cane
-- Masters' videos (a single hung log blocked re-caching for 20+ minutes).
--
-- The cleanup-stuck-media edge function marks any 'running' log older than 15 min
-- as 'failed', releasing the guard. Running it every 10 minutes bounds the worst-
-- case block to ~15-25 min instead of "until someone notices".
--
-- Scheduling lives in this migration (NOT an HQ-session cron, which evaporates at
-- session end). The service role key is read from Supabase Vault at runtime and is
-- never hardcoded.
--
-- Prerequisite (run once in the SQL editor if not already stored — the other
-- Verdanote crons share this same secret):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Unschedule any previous registration (idempotent) ───────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'cleanup-stuck-media-10min'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Every 10 minutes: release any media-refresh log stuck >15 min ───────────
SELECT cron.schedule(
  'cleanup-stuck-media-10min',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/cleanup-stuck-media',
      headers := json_build_object(
        'Authorization',
        'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        ),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'cleanup-stuck-media-10min';
