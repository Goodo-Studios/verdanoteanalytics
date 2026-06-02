-- Dial media crons back from one-time backfill cadence to steady-state maintenance.
--
-- The fleet is converged (thumbnails + ~all videos cached). The aggressive crons
-- (cache fan-out every 2 min, discover every 3 min, plus dedicated Miracle crons)
-- were for the one-time backfill of ~2,000 videos and would otherwise burn edge
-- invocations forever. Relax to a cadence that comfortably keeps up with new ads from
-- sync, and drop the Miracle-specific crons (that account is done — the fleet-wide
-- crons cover it). Keep cleanup-stuck-media frequent (cheap, guards against lockups).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Unschedule the backfill-era jobs (by name).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN (
    'media-cache-fanout-2min',
    'media-video-discover-3min',
    'media-miracle-discover-4min',
    'media-miracle-cache-4min',
    'media-cache-fanout-maint',
    'media-video-discover-maint'
  ) LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

-- Maintenance: discover new videos every 15 min; cache (fan-out per active account)
-- every 5 min. With VIDEO_CACHE_LIMIT=10 + streaming uploads this still drains any
-- residual tail within an hour or two, then idles cheaply on new ads.
SELECT cron.schedule(
  'media-video-discover-maint',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/enrich-thumbnails?scope=video',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

SELECT cron.schedule(
  'media-cache-fanout-maint',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/enrich-thumbnails?scope=cache&account_id=' || a.id,
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
    FROM ad_accounts a
    WHERE a.is_active = true
  $$
);

-- Verify: SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'media-%' OR jobname LIKE 'cleanup-%';
