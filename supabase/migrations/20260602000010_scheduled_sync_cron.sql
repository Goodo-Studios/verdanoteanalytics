-- Restore the missing pg_cron job that drives the Meta data sync.
--
-- ROOT CAUSE (2026-06-02): no cron invoked `scheduled-sync`, so automated
-- creative-data syncing had been dead since the last manual bulk sync on
-- 2026-05-31. `ad_accounts.next_sync_at` was frozen at 2026-03-15 because
-- nothing claimed due accounts. The only rows accumulating in `sync_logs`
-- were from `sync-coda-names` (sync_type='daily'), which masked the outage.
--
-- This migration registers `scheduled-sync` on a 5-minute cadence. On each
-- run the function:
--   1. Claims accounts whose next_sync_at <= now() via claim_due_sync_accounts,
--      triggering a fresh /sync for each.
--   2. Fires /sync/continue to advance any in-flight multi-phase syncs past
--      the inter-phase / inter-account cooldown gap.
-- The claim advances next_sync_at by 6h as a placeholder; scheduled-sync then
-- recomputes the real next_sync_at from each account's sync_frequency.
--
-- The first invocation after deploy will claim all active non-manual accounts
-- (every one is past-due against the frozen March 15 value) and refresh them.
-- NOTE: accounts with sync_frequency='manual' are intentionally NOT claimed.
--
-- Scheduling lives in this migration (NOT an HQ-session cron, which evaporates
-- at session end). The service role key is read from Supabase Vault at runtime
-- and is never hardcoded.
--
-- Prerequisite (already satisfied for sync-coda-names-daily; run once in the
-- SQL editor if the secret is somehow absent):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Unschedule any previous registration (idempotent) ───────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'scheduled-sync-5min'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Meta data sync — every 5 minutes ────────────────────────────────────────
SELECT cron.schedule(
  'scheduled-sync-5min',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/scheduled-sync',
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
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'scheduled-sync-5min';
