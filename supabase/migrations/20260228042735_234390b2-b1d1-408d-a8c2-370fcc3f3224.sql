ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS parent_ad_id text;