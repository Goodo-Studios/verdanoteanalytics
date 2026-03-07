-- Migration: Add incremental sync tracking columns to ad_accounts
-- Enables CHANGE 2: Incremental Data Sync (Only New/Changed Content)

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS last_data_sync TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_media_sync TIMESTAMP WITH TIME ZONE;

-- Index for efficient ordering by last_media_sync (used by single-account rotation)
CREATE INDEX IF NOT EXISTS idx_ad_accounts_last_media_sync
  ON public.ad_accounts (last_media_sync ASC NULLS FIRST)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ad_accounts_last_data_sync
  ON public.ad_accounts (last_data_sync ASC NULLS FIRST)
  WHERE is_active = true;

-- Comment for clarity
COMMENT ON COLUMN public.ad_accounts.last_data_sync IS
  'Timestamp of the last successful data sync (Phase 2 insights). Used for incremental sync — only fetch data since this timestamp.';

COMMENT ON COLUMN public.ad_accounts.last_media_sync IS
  'Timestamp of the last successful media refresh for this account. Used by single-account rotation to pick the stalest account.';
