
-- Moodboards table
CREATE TABLE IF NOT EXISTS public.moodboards (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text,
  name text NOT NULL,
  description text,
  created_by uuid NOT NULL,
  is_shared boolean DEFAULT false,
  share_token text UNIQUE DEFAULT gen_random_uuid()::text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.moodboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage moodboards"
  ON public.moodboards FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

-- Moodboard items table
CREATE TABLE IF NOT EXISTS public.moodboard_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  moodboard_id uuid REFERENCES public.moodboards(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL,
  ad_id text,
  competitor_ad_id uuid,
  url text,
  thumbnail_url text,
  caption text,
  position integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.moodboard_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage moodboard_items"
  ON public.moodboard_items FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

-- Public access for shared moodboards
CREATE POLICY "Public can view shared moodboards"
  ON public.moodboards FOR SELECT
  USING (is_shared = true AND share_token IS NOT NULL);

CREATE POLICY "Public can view shared moodboard items"
  ON public.moodboard_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.moodboards
    WHERE id = moodboard_items.moodboard_id
    AND is_shared = true
  ));
