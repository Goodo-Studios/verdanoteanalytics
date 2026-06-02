-- Autonomous media-convergence cron.
--
-- Why: backfilling videos for large accounts (discover → cache) is memory- and
-- time-bounded per edge invocation (256 MB / 150 s), so it must run as many small,
-- safe batches over time. Laptop-driven loops are unreliable (sleep pauses them) and
-- HTTP self-chaining is killed when an edge function returns. A server-side cron of
-- small batches is the robust mechanism: each tick is a fresh worker doing a bounded
-- batch; the pipeline's retry-backoff + expired-self-heal handle failures. Over a few
-- hours this drains the fleet to null=0 / cdnOnly=0 with no human in the loop.
--
-- Two jobs (all accounts; the functions self-bound via TIME_BUDGET_MS + limits):
--   * scope=video every 3 min — discover videos for null/due rows (writes CDN urls)
--   * scope=cache every 2 min — download those CDN urls into storage (8/tick, OOM-safe)
--
-- Prereq (already stored for the other crons):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Idempotent: drop prior registrations.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job
    WHERE jobname IN ('media-video-discover-3min', 'media-video-cache-2min')
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'media-video-discover-3min',
  '*/3 * * * *',
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
  'media-video-cache-2min',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/enrich-thumbnails?scope=cache',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- Verify: SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'media-video-%';
