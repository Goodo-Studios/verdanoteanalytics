
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS last_media_sync timestamptz;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS total_spend numeric;
