
-- Create creators table
CREATE TABLE IF NOT EXISTS public.creators (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  handle text,
  type text DEFAULT 'ugc',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.creators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage creators"
  ON public.creators FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

-- Add creator_id to creatives
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.creators(id) ON DELETE SET NULL;
