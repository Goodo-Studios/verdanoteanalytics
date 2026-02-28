CREATE TABLE IF NOT EXISTS public.webhooks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  events text[] NOT NULL,
  account_ids text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  secret text,
  last_triggered_at timestamptz,
  last_status_code integer,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder manages webhooks" ON public.webhooks
  FOR ALL USING (has_role(auth.uid(), 'builder'::app_role));