
CREATE TABLE IF NOT EXISTS public.account_context (
  account_id text PRIMARY KEY REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  brand_brief text,
  creative_rules jsonb DEFAULT '[]'::jsonb,
  offer_history jsonb DEFAULT '[]'::jsonb,
  audience_notes text,
  competitor_notes text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.account_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage account_context"
  ON public.account_context FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));
