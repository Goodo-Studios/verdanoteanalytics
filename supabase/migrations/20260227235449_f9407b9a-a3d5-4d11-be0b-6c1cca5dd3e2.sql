CREATE TABLE IF NOT EXISTS public.competitor_ads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  competitor_id uuid REFERENCES public.competitors(id) ON DELETE CASCADE,
  ad_archive_id text UNIQUE,
  ad_creative_body text,
  thumbnail_url text,
  video_url text,
  started_running text,
  is_active boolean DEFAULT true,
  platforms text[],
  saved_at timestamptz DEFAULT now()
);

ALTER TABLE public.competitor_ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage competitor_ads"
  ON public.competitor_ads
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));