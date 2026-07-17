-- Schedule the stuck-run watchdog (cleanup-stuck-media) via pg_cron.
--
-- WHY: the cleanup-stuck-media edge function cancels media_refresh_logs rows stranded
-- in status='running' when a media worker died mid-flight (edge fns hard-cap at ~150s,
-- so any 'running' log older than a few minutes is definitively abandoned). Its
-- recurring cron was RETIRED in 20260714000008 (retire_blind_fanout_cutover /
-- drain_media_queue_worker) because the in-stack queue's claim RPC self-heals a dead
-- CACHE claim. But the cleanup function itself was kept, and NOTHING re-scheduled it —
-- so a media_refresh_logs row that still goes stuck 'running' (e.g. a legacy
-- enrich-thumbnails / refresh path outside the queue) is never released. This migration
-- re-schedules it as a bounded background watchdog.
--
-- Cadence: every 10 minutes. The cleanup function only marks logs stuck 'running' for
-- > 3 min as 'failed'; a poke that finds nothing is a cheap no-op (returns cleaned:0).
--
-- Idempotent: unschedule the job by name first (so a `supabase db push` replay is a
-- safe no-op that reconciles the ledger cleanly), then schedule — the EXACT
-- unschedule-then-schedule + pg_net http_post idiom used by the existing media crons
-- (drain-media-queue-2min in 20260714000008, refresh-media-queue-15min in
-- 20260714000028). Numbering 20260714000032 follows the highest existing migration
-- (20260714000031_bulk_metadata_expected_frame_count).
--
-- No edge function is added or removed here, so scripts/deploy-functions.sh and
-- supabase/config.toml are intentionally untouched (per verdanote-supabase-add-function
-- — cleanup-stuck-media already ships in both). This migration only (re)schedules a
-- function that already exists and is already deployed.

-- ── Extensions (defensive; already present) ──────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Schedule: cleanup-stuck-media every 10 minutes ───────────────────────────
-- Unschedule-by-name first (idempotent replay), exactly like drain-media-queue-2min /
-- refresh-media-queue-15min.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-stuck-media-10min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'cleanup-stuck-media-10min',
  '*/10 * * * *',
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

-- ── Verify (run manually after push) ──────────────────────────────────────────
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'cleanup-stuck-media-10min';
--   -- Manual poke of the watchdog returns a cleaned count:
--   --   curl -X POST .../functions/v1/cleanup-stuck-media  → { "cleaned": <n> }
