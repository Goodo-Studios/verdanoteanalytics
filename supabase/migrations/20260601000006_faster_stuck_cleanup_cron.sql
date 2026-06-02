-- Run stuck-media cleanup every 2 min (was 10).
--
-- Why: refresh-thumbnails / enrich crashes (e.g. OOM on a large video) leave a
-- media_refresh_log stuck in 'running', which blocks enrich-thumbnails' per-account
-- guard and starves that account's discovery/caching (froze Miracle Brand). The
-- cleanup function now treats anything 'running' > 3 min as dead (edge fns cap at
-- 150s), so running it every 2 min keeps the guard clear within ~3-5 min of any crash.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job
    WHERE jobname IN ('cleanup-stuck-media-10min', 'cleanup-stuck-media-2min')
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'cleanup-stuck-media-2min',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/cleanup-stuck-media',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);
