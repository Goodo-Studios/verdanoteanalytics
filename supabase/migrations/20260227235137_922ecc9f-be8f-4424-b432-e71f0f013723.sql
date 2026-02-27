CREATE TABLE IF NOT EXISTS public.competitors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL,
  brand_name text NOT NULL,
  facebook_page_id text,
  facebook_page_name text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage competitors"
  ON public.competitors
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));
