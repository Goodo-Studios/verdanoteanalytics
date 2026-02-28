
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS client_responsiveness text DEFAULT 'good';
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS client_start_date date;
