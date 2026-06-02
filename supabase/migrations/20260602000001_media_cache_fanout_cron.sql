-- Parallel (fan-out) video-cache cron.
--
-- Why: a single all-accounts cache worker can only safely buffer ~2 videos before
-- OOM (256MB worker), so serial caching of ~1900 discovered videos would take many
-- hours. Throughput must come from PARALLELISM: this cron fans out one ACCOUNT-SCOPED
-- cache worker per active account every 2 min. Each worker is bounded (2 videos), so
-- no OOM, while ~N_accounts run concurrently → ~N×2 videos cached per tick. Account
-- scoping also means each worker's per-account guard only blocks if that account is
-- mid-refresh. Replaces the serial media-video-cache-2min job.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job
    WHERE jobname IN ('media-video-cache-2min', 'media-cache-fanout-2min')
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'media-cache-fanout-2min',
  '*/2 * * * *',
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
