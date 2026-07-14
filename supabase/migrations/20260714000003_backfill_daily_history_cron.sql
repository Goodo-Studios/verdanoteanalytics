-- US-004: pg_cron that drains the historical-backfill queue at a SAFE cadence.
--
-- The backfill-daily-history edge function walks each active account's daily
-- history back to RETENTION_DAYS=365 in chunks, advancing
-- ad_accounts.daily_backfilled_since as it goes and self-limiting to
-- MAX_ACCOUNTS_PER_RUN accounts per invocation. This cron simply pokes the
-- function on a slow cadence so the queue drains over time WITHOUT fanning out
-- across every account simultaneously (Meta's rate limit is app-wide, per
-- verdanote-meta-rate-limit-is-app-wide-not-per-user — hammering all accounts at
-- once would throttle the whole app).
--
-- CADENCE: every 20 minutes. Combined with MAX_ACCOUNTS_PER_RUN=3 and the
-- ~28d/chunk step, this spreads the one-time backfill across hours rather than
-- minutes. The function is idempotent and resumable, so a fired cron that finds
-- nothing left to do is a cheap no-op (it returns drained=true, accounts=0). Once
-- every account reaches the 365d target the queue is permanently empty and each
-- invocation short-circuits — the cron can be left running or unscheduled later.
--
-- Scheduling lives in this migration (NOT an HQ-session cron, which evaporates at
-- session end). The service role key is read from Supabase Vault at runtime and
-- is never hardcoded (mirrors 20260602000010_scheduled_sync_cron.sql).
--
-- Idempotent: re-applying unschedules any prior registration first, so
-- `supabase db push` re-runs are safe no-ops (per
-- verdanote-supabase-ledger-drift-reconcile-with-db-push).

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Unschedule any previous registration (idempotent) ───────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'backfill-daily-history-20min'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Historical daily backfill drain — every 20 minutes ──────────────────────
SELECT cron.schedule(
  'backfill-daily-history-20min',
  '*/20 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/backfill-daily-history',
      headers := json_build_object(
        'Authorization',
        'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        ),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'backfill-daily-history-20min';
