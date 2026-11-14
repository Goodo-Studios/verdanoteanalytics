-- pg_cron schedule for the ClickUp -> pipeline_tasks sync, and retirement of the
-- Coda one.
--
-- Calls the sync-clickup-tasks edge function every 4 hours (same cadence the Coda
-- sync had, chosen 2026-05-31 so the /pipeline board stays current through the
-- day). The function is GET-only against ClickUp.
--
-- The Coda schedule is removed here: Coda was retired on 2026-10-09, so the job
-- can only fail or re-read a frozen table.
--
-- The service role key is read from Supabase Vault at runtime and is never
-- hardcoded. Prerequisite: the 'service_role_key' Vault secret (already used by
-- the other scheduled syncs) and the CLICKUP_API_TOKEN function secret.
--
-- Staging: scripts/staging-lockdown.sql removes every pg_cron job after each
-- staging push, so this schedule only ever runs in production.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Unschedule the retired Coda sync and any previous registration of this job (idempotent).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname IN ('sync-coda-tasks-4h', 'sync-clickup-tasks-4h')
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'sync-clickup-tasks-4h',
  '0 */4 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/sync-clickup-tasks',
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

-- Verify after applying:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'sync-%-tasks-4h';
