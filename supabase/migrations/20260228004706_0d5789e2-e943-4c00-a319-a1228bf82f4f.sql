ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS sync_frequency text DEFAULT 'manual';
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS sync_hour integer DEFAULT 2;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS sync_timezone text DEFAULT 'America/New_York';
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS next_sync_at timestamptz;