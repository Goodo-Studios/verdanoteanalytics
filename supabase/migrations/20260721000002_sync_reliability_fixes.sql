-- =============================================================================
-- Sync reliability fixes — rollup timeout + full-sync marker
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- Companion to the sync/index.ts + scheduled-sync/index.ts changes:
--   Fix #2 — Phase 5 rollup (rollup_creatives_from_daily) was dying with
--     "canceling statement due to statement timeout" on large accounts
--     (Flatpack: ~3.7k creatives over a 180d window). The snapshot never
--     refreshed, so the UI totals stayed stale even when daily rows landed.
--     Pin a generous per-function statement_timeout so the aggregation
--     completes. (The edge fn caller is comfortably inside its own limit.)
--   Fix #1 — record when a FULL-scope sync last ran, so scheduled-sync can run
--     the light daily-only scope routinely and escalate to full ~once/day.
-- =============================================================================

-- Fix #2: give the rollup room to finish on large accounts.
ALTER FUNCTION public.rollup_creatives_from_daily(text, date, date)
  SET statement_timeout = '180s';

-- Fix #1: marker for the last full-scope sync (drives daily-vs-full scope choice).
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS last_full_sync_at timestamptz;

COMMENT ON COLUMN public.ad_accounts.last_full_sync_at IS
  'Timestamp of the last sync that ran sync_scope=full (phases 1-5). scheduled-sync '
  'uses the light daily scope [4,5] for routine runs and escalates to full when this '
  'is null or older than the full-refresh interval, so metadata still refreshes ~daily '
  'without a full campaign/creative re-pull every cycle.';
