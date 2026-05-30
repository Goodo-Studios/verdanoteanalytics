-- US-004: pg_cron daily schedule for the Coda ad-name -> name_mappings sync.
--
-- Calls the sync-coda-names edge function once a day. The function is GET-only
-- against Coda and writes only name_mappings (csv tier); manual overrides are
-- protected downstream by the precedence resolver.
--
-- Scheduling lives in this migration (NOT an HQ-session cron, which evaporates
-- at session end). The service role key is read from Supabase Vault at runtime
-- and is never hardcoded.
--
-- Prerequisite (run once in the SQL editor if not already stored):
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
    SELECT jobid FROM cron.job WHERE jobname = 'sync-coda-names-daily'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Daily Coda ad-name sync — 08:00 UTC ─────────────────────────────────────
SELECT cron.schedule(
  'sync-coda-names-daily',
  '0 8 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/sync-coda-names',
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
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'sync-coda-names-daily';
