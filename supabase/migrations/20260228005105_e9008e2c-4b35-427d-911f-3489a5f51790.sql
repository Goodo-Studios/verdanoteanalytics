CREATE TABLE IF NOT EXISTS public.segments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  filter_config jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_id text,
  created_by uuid NOT NULL,
  is_shared boolean DEFAULT false,
  color text DEFAULT '#6366f1',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage segments"
  ON public.segments FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));
