
CREATE TABLE IF NOT EXISTS public.performance_changelog (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  ad_id text REFERENCES public.creatives(ad_id) ON DELETE CASCADE,
  change_type text NOT NULL, -- 'roas_spike', 'roas_drop', 'spend_surge', 'spend_cut', 'status_change', 'fatigue_alert', 'manual'
  severity text NOT NULL DEFAULT 'info', -- 'info', 'positive', 'negative', 'critical'
  title text NOT NULL,
  description text,
  metric_name text,
  old_value numeric,
  new_value numeric,
  pct_change numeric,
  created_at timestamptz DEFAULT now(),
  created_by uuid -- null = auto-detected, uuid = manual entry
);

ALTER TABLE public.performance_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage changelog"
  ON public.performance_changelog FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

CREATE POLICY "Client can view linked changelog"
  ON public.performance_changelog FOR SELECT
  USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));

CREATE POLICY "Editor can view linked changelog"
  ON public.performance_changelog FOR SELECT
  USING (has_role(auth.uid(), 'editor'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));

CREATE INDEX idx_changelog_account_date ON public.performance_changelog(account_id, created_at DESC);
CREATE INDEX idx_changelog_ad_id ON public.performance_changelog(ad_id, created_at DESC);
