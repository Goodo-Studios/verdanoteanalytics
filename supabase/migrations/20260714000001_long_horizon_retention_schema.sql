-- US-001: Schema foundations for retention, rollup, and backfill watermark.
--
-- Pure, additive, backwards-compatible schema for the long-horizon-retention
-- project. No behavior change: later stories (US-002..US-007) read these
-- columns. Idempotent (IF NOT EXISTS) so re-applying against a partially-
-- migrated DB is a safe no-op and reconciles cleanly with `supabase db push`.

-- 1) Backfill watermark on ad_accounts.
--    Earliest date with complete daily coverage in creative_daily_metrics.
--    NULL = the account has not been backfilled yet (US-004 advances it).
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS daily_backfilled_since DATE DEFAULT NULL;

COMMENT ON COLUMN public.ad_accounts.daily_backfilled_since IS
  'Earliest date with complete daily creative_daily_metrics coverage for this account. NULL = not yet backfilled. Advanced by the historical backfill job (US-004); read by the rolling incremental sync (US-002) to size the recent window.';

-- 2) Daily-grain play-curve / retention columns on creative_daily_metrics.
--    These let the aggregate retention curve be reconstructed by a LOCAL rollup
--    (US-003) instead of being re-fetched from Meta. The JSONB stores the
--    normalized per-interval retention curve (true percentages in [0,100], see
--    _shared/play-curve.ts); the four scalars are the quartile-threshold values
--    derived in the same pass, mirroring the existing public.creatives columns.
ALTER TABLE public.creative_daily_metrics
  ADD COLUMN IF NOT EXISTS video_play_curve_actions jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_p25 numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_p50 numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_p75 numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_p100 numeric DEFAULT NULL;

COMMENT ON COLUMN public.creative_daily_metrics.video_play_curve_actions IS
  'Daily-grain normalized video retention curve as true percentages in [0,100] (per _shared/play-curve.ts). Stored per (ad_id,date) so the aggregate play-curve survives a fully-local rollup (US-003) without re-pulling from Meta.';
COMMENT ON COLUMN public.creative_daily_metrics.retention_p25 IS
  '% of plays still watching at the 25% mark for this day. Daily-grain input to the local retention rollup (US-003).';
COMMENT ON COLUMN public.creative_daily_metrics.retention_p50 IS
  '% of plays still watching at the 50% mark for this day. Daily-grain input to the local retention rollup (US-003).';
COMMENT ON COLUMN public.creative_daily_metrics.retention_p75 IS
  '% of plays still watching at the 75% mark for this day. Daily-grain input to the local retention rollup (US-003).';
COMMENT ON COLUMN public.creative_daily_metrics.retention_p100 IS
  '% of plays still watching at the 100% (completion) mark for this day. Daily-grain input to the local retention rollup (US-003).';
