-- Wire up the scheduled-reports cron job.
--
-- ROOT CAUSE: `scheduled-reports` is an edge function that generates and
-- sends weekly/monthly Slack reports, but no pg_cron job existed to call it.
-- The function was deployed and its internal day-of-week / day-of-month
-- logic was correct, but nothing ever invoked it on a schedule — so reports
-- have never fired automatically since the feature was built.
--
-- This migration registers a daily cron at noon UTC (8 AM ET / 5 AM PT).
-- The function itself checks day-of-week (Monday → weekly) and day-of-month
-- (1st → monthly) before generating, so running daily is safe and cheap.
--
-- Scheduling lives here (NOT an HQ-session cron, which evaporates at session
-- end). The service_role_key is read from Supabase Vault at runtime.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Idempotent: drop prior registration if it exists.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'scheduled-reports-daily'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END;
$$;

-- Fire daily at noon UTC — Monday triggers weekly reports, 1st triggers monthly.
SELECT cron.schedule(
  'scheduled-reports-daily',
  '0 12 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/scheduled-reports',
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

-- Verify with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'scheduled-reports-daily';
