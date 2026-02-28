
-- Drop existing table and recreate with user's requested schema
DROP TABLE IF EXISTS public.performance_changelog;

CREATE TABLE IF NOT EXISTS public.performance_changelog (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  ad_id text REFERENCES public.creatives(ad_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text NOT NULL,
  old_value numeric,
  new_value numeric,
  metadata jsonb DEFAULT '{}',
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.performance_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view changelog"
  ON public.performance_changelog FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Builder/employee can manage changelog"
  ON public.performance_changelog FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

CREATE INDEX idx_changelog_account_date ON public.performance_changelog(account_id, created_at DESC);
CREATE INDEX idx_changelog_ad_id ON public.performance_changelog(ad_id, created_at DESC);
