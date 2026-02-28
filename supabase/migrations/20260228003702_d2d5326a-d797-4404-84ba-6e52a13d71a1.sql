
CREATE TABLE IF NOT EXISTS public.hooks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text,
  category text NOT NULL,
  hook_text text NOT NULL,
  source_ad_id text,
  avg_hook_rate numeric,
  usage_count integer DEFAULT 0,
  created_by uuid,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.hooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage hooks"
  ON public.hooks FOR ALL
  USING (has_role(auth.uid(), 'builder') OR has_role(auth.uid(), 'employee'));
