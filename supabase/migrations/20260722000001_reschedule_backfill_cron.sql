-- =============================================================================
-- Re-schedule backfill-daily-history — the missing historical-backfill drain
-- =============================================================================
-- Idempotent (unschedule-by-name then schedule). Manual `supabase db push --linked`.
-- Numbered off the remote frontier (20260721000003 was highest applied at authoring).
--
-- backfill-daily-history walks each not-yet-backfilled account's daily history
-- back to RETENTION_DAYS=365 in ~28d chunks, advancing daily_backfilled_since and
-- self-limiting to a few accounts per run (Meta rate limit is app-wide). It was
-- scheduled by 20260714000003 but the job is NOT present in cron.job on prod (the
-- recurring "cron evaporated" pattern — same as the dead scheduled-sync cron). With
-- no drain running, historical gaps never heal and new accounts never backfill.
--
-- Concretely (2026-07-21): Goodo Studios has NO data 2025-10-21 → 2026-05-13 even
-- though it ran ads throughout — a real gap the (unscheduled) backfill never
-- repaired. Re-scheduling the drain + resetting that account's watermark (done
-- operationally) lets the backfill re-walk the year and fill the hole. Idempotent
-- (ad_id,date) upsert, so re-covering already-present days is a no-op.
--
-- Every account is currently at target, so a fired cron is a cheap no-op until an
-- account's watermark is reset behind the target. 20-min cadence + 3 accounts/run
-- spreads load (mirrors 20260714000003). Service-role key from Vault; not hardcoded.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'backfill-daily-history-20min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'backfill-daily-history-20min',
  '*/20 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/backfill-daily-history',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- Verify: SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'backfill-daily-history-20min';
