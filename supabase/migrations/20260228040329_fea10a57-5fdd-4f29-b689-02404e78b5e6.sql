
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS click_window integer DEFAULT 7;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS view_window integer DEFAULT 1;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS attribution_model text DEFAULT 'last_touch';
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS attribution_notes text;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS industry_category text;
