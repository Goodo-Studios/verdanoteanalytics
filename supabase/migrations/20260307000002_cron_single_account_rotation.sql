-- Migration: Update cron schedules for single-account media refresh rotation
-- and more frequent sync continuation
--
-- CHANGE 1: refresh-thumbnails now runs every 12 minutes (was once per day).
--   Each invocation processes ONE account. With 12+ accounts, full rotation ~= 2-3 hours.
--   The function's own cooldown logic (MEDIA_REFRESH_COOLDOWN_HOURS=2) prevents
--   re-refreshing an account that was just done.
--
-- CHANGE 2: sync/continue runs every 2 minutes (was already 1-2 min — no change needed).
--   The incremental sync changes are in the function code, not the schedule.

-- Ensure pg_cron and pg_net are enabled
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Remove old once-per-day media refresh cron (if it exists) ──────────────
-- The old schedule name was likely 'trigger-media-refresh' or 'refresh-thumbnails-daily'.
-- We use unschedule with SELECT to avoid errors if the job doesn't exist.
DO $$
BEGIN
  -- Try to remove known old job names (safe if not found)
  PERFORM cron.unschedule('trigger-media-refresh');
EXCEPTION WHEN OTHERS THEN
  -- Job didn't exist — that's fine
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-thumbnails-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('media-refresh-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ── Schedule: media refresh every 12 minutes ───────────────────────────────
-- Each invocation picks ONE account (the most stale) and processes it.
-- With a 2-hour cooldown per account and 12-minute cadence:
--   - 2h cooldown / 12min interval = 10 slots per account per cooldown window
--   - Supports up to ~10 accounts refreshing in rotation within the cooldown window
--   - For 14 accounts: each gets refreshed roughly every 2-3 hours
SELECT cron.schedule(
  'refresh-thumbnails-rotation',           -- job name
  '*/12 * * * *',                          -- every 12 minutes
  $$
  SELECT public.trigger_media_refresh();
  $$
);

-- ── Update trigger_media_refresh to NOT skip if "any" refresh is running ───
-- The old guard blocked ALL refreshes if any account was running.
-- New behavior: the function itself handles per-account concurrency.
-- We update the guard to only block if the SAME account is running,
-- which is now handled inside the edge function. So the PG function
-- just fires unconditionally (rate limiting is in the edge function).
CREATE OR REPLACE FUNCTION public.trigger_media_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  supabase_url text := 'https://vjjlulifovsdjwphmdsh.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqamx1bGlmb3ZzZGp3cGhtZHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTk0NTksImV4cCI6MjA4NjQzNTQ1OX0.z-tGPzV6p0IT2JpbQmz0ScNKqwOXj8jmFNOPC0kClpc';
BEGIN
  -- Fire the edge function (non-blocking).
  -- The edge function handles:
  --   1. Picking the most-stale account (single-account rotation)
  --   2. Skipping if that specific account is already refreshing
  --   3. Skipping if all accounts are within the cooldown window
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/refresh-thumbnails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := '{}'::jsonb
  );

  RAISE NOTICE 'trigger_media_refresh: refresh-thumbnails rotation invoked at %', now();
END;
$$;

-- ── Verify the new schedule is active ────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE '%refresh%' OR jobname LIKE '%sync%';
