ALTER TABLE public.ad_library_saved_ads
ADD COLUMN transcript text,
ADD COLUMN transcript_status text NOT NULL DEFAULT 'none';