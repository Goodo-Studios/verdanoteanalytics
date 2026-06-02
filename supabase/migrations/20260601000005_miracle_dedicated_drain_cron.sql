-- Dedicated drain cron for the largest, starved account (Miracle Brand, 2658).
--
-- Why: the all-accounts enrich crons order video discovery by spend DESC across the
-- whole fleet, so Miracle's (lower-priority, largest) ~2291 undiscovered videos never
-- get budget before the 115s window closes — and account-scoped bursts kept getting
-- {skipped: media_refresh_running} because the 12-min refresh-thumbnails cron holds
-- Miracle's media_refresh_log while it processes that account. An account-scoped enrich
-- cron gives Miracle its own budget and its guard only blocks when Miracle *itself* is
-- mid-refresh (a small fraction of the time), so it drains over successive ticks.
--
-- Remove once Miracle reaches null=0/cdnOnly=0 (or generalize to round-robin).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job
    WHERE jobname IN ('media-miracle-discover-4min', 'media-miracle-cache-4min')
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

-- Discover Miracle's videos (account-scoped) every 4 min.
SELECT cron.schedule(
  'media-miracle-discover-4min',
  '*/4 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/enrich-thumbnails?scope=video&account_id=act_306755179745605',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- Cache Miracle's discovered videos (account-scoped) every 4 min, offset by 2.
SELECT cron.schedule(
  'media-miracle-cache-4min',
  '2-59/4 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/enrich-thumbnails?scope=cache&account_id=act_306755179745605',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);
