-- =============================================================================
-- Sync reliability — restore the data-sync scheduler + wire the freshness watchdog
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
-- Numbered off the remote frontier (highest applied at authoring: 20260718000003).
--
-- ROOT CAUSE (2026-07-21): automated Meta data sync had been dead since
-- 2026-07-16 — the `scheduled-sync-5min` pg_cron job (restored once already by
-- 20260602000010) was again absent from cron.job, so nothing claimed accounts
-- past their next_sync_at. Every account's next_sync_at was frozen at
-- 2026-07-17 and last_data_sync at ~07-16. The two sync-coda crons kept writing
-- sync_logs and MASKED the outage — the exact failure mode called out in the
-- June-2 and June-9 incidents. Meanwhile media auto-refresh was flag-scoped to
-- 2 of 15 accounts, so 13 accounts' media had not refreshed since ~07-14.
--
-- This migration makes the pipeline reliable and self-announcing:
--   1. Re-register `scheduled-sync-5min` (durable — lives in a migration, not an
--      HQ-session cron that evaporates). Same idiom as 20260602000010.
--   2. Register `system-health-check-30min`. That function already detects stale
--      accounts against each account's own cadence (>3 days dead = fail) but was
--      NEVER scheduled — so the outage it was built to catch went unseen. The
--      companion function change adds a Slack alert on status transitions, so a
--      future outage pages instead of hiding behind the Coda crons.
--   3. Enable media auto-refresh for ALL active, non-manual accounts (owner
--      decision 2026-07-21) so the refresh-media-queue feeder covers everything.
--   4. Stagger next_sync_at across ~45 min so the 15 overdue accounts roll into
--      the scheduler gradually instead of a thundering herd against the Meta API.
--
-- The data sync itself is already incremental (sync/index.ts US-002 rolling
-- 28-day window; historical daily rows are immutable and fetched once by the
-- backfill), and media re-caching is content-hash deduped, and analysis skips
-- already-analyzed creatives — so this restores steady daily DELTAS, never a
-- full-year re-pull, and never re-analyzes media already in Verdanote.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- ── 1. Meta data sync — every 5 minutes (unschedule-by-name for idempotent replay)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'scheduled-sync-5min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'scheduled-sync-5min',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/scheduled-sync',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── 2. Freshness/health watchdog — every 30 minutes ─────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'system-health-check-30min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'system-health-check-30min',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/system-health-check',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── 3. Enable media auto-refresh for every active, non-manual account ───────
UPDATE public.ad_accounts
   SET media_backfill_enabled = true
 WHERE is_active = true
   AND coalesce(sync_frequency, 'manual') <> 'manual'
   AND coalesce(media_backfill_enabled, false) = false;

-- ── 4. Stagger the catch-up: spread the 15 overdue accounts over ~45 min so the
--       first scheduler ticks don't fan out 15 simultaneous Meta syncs. Oldest
--       (most stale) accounts go first.
WITH ranked AS (
  SELECT id,
         row_number() OVER (ORDER BY last_data_sync ASC NULLS FIRST) - 1 AS pos
    FROM public.ad_accounts
   WHERE is_active = true
     AND coalesce(sync_frequency, 'manual') <> 'manual'
)
UPDATE public.ad_accounts a
   SET next_sync_at = now() + (ranked.pos * interval '3 minutes')
  FROM ranked
 WHERE a.id = ranked.id;

-- ── Verify (run manually after push) ────────────────────────────────────────
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('scheduled-sync-5min','system-health-check-30min');
--   SELECT name, next_sync_at, media_backfill_enabled FROM public.ad_accounts WHERE is_active ORDER BY next_sync_at;
