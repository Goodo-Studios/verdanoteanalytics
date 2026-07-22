-- =============================================================================
-- Creative Intelligence (WS1) — speed up the analyze-creative kick cadence
-- =============================================================================
-- Idempotent (unschedule-by-name then reschedule). Manual `supabase db push --linked`.
-- Numbered off the remote frontier (last applied: 20260722000007).
--
-- Backlog-clearing speedup: the analyze-creative drain now processes each claimed
-- batch CONCURRENTLY and self-chains ACROSS accounts, so a single drain runs
-- continuously until the whole backlog is empty. The cron is only a KICK that
-- (re)starts a drain when none is active — e.g. after everything drained, or after
-- a crash killed the chain. Tightening 5min → 2min just shortens the worst-case
-- restart latency; it can NOT cause overlap:
--   • SINGLE-FLIGHT — a chain=0 poke no-ops while any creative is 'analyzing'
--     within the last 3 min (enforced in the edge function), so a 2-min tick that
--     lands during an active drain does nothing.
-- This mirrors the media pipeline's 2-min drain cadence (drain-media-queue-2min).
--
-- Unchanged: flag-scoped (only creative_analysis_enabled accounts), empty-body
-- flag-driven selection, service-role bearer from vault.decrypted_secrets.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Unschedule-by-name first for idempotent replay (covers the old 5-min job).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'analyze-creative-5min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'analyze-creative-2min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'analyze-creative-2min',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/analyze-creative',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify (run manually after push) ──────────────────────────────────────────
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'analyze-creative%';
--   -- expect exactly one row: analyze-creative-2min | */2 * * * * | t
