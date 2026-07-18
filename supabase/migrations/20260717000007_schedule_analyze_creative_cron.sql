-- =============================================================================
-- Creative Intelligence (WS1 / US-002) — schedule the analyze-creative drain
-- =============================================================================
-- Idempotent (unschedule-by-name then schedule). Manual `supabase db push --linked`.
--
-- Pokes analyze-creative every 5 minutes with an EMPTY body. With no account_id
-- the function is FLAG-DRIVEN: it resolves the next creative_analysis_enabled
-- account with pending work (next_creative_analysis_account, 20260717000006) and
-- drains it, self-chaining until that account is done or hits its $ cap.
--
-- SAFE TO SCHEDULE NOW: creative_analysis_enabled defaults false, so until an
-- account is explicitly opted in this cron is a pure no-op (the selector returns
-- NULL → the function returns { no_work: true } and does nothing). No surprise
-- LLM spend. Throttle-safe by construction:
--   • FLAG-SCOPED — only opted-in accounts (mirrors the media feeder, 20260717000004);
--   • SINGLE-FLIGHT — a chain=0 poke no-ops while a chain is active (enforced in the
--     edge function), so only one bounded self-chaining drain runs at a time.
--
-- Uses the exact cron idiom the media crons use (20260717000005): hardcoded
-- function URL + service-role bearer from vault.decrypted_secrets.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Unschedule-by-name first for idempotent replay.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'analyze-creative-5min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'analyze-creative-5min',
  '*/5 * * * *',
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
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'analyze-creative-5min';
--   -- Opt an account in to start the drain:
--   --   UPDATE public.ad_accounts SET creative_analysis_enabled = true WHERE id = 'act_...';
