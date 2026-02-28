
-- Add platform column to creatives
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'meta';

-- Add TikTok connection fields to ad_accounts
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS tiktok_advertiser_id text;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS tiktok_access_token text;

-- Add platform column to creative_daily_metrics too
ALTER TABLE public.creative_daily_metrics ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'meta';

-- Index for platform filtering
CREATE INDEX IF NOT EXISTS idx_creatives_platform ON public.creatives (platform);
CREATE INDEX IF NOT EXISTS idx_creatives_account_platform ON public.creatives (account_id, platform);
