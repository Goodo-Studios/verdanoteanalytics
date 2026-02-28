
CREATE TABLE IF NOT EXISTS public.score_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_id text NOT NULL,
  account_id text NOT NULL,
  score integer NOT NULL,
  roas_component integer,
  ctr_component integer,
  hook_rate_component integer,
  spend_efficiency_component integer,
  momentum_component integer,
  fatigue_component integer,
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX idx_score_history_ad_id_recorded ON public.score_history(ad_id, recorded_at DESC);
CREATE INDEX idx_score_history_account_id ON public.score_history(account_id);

ALTER TABLE public.score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder/employee can manage score_history" ON public.score_history
  FOR ALL USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

CREATE POLICY "Client can view linked score_history" ON public.score_history
  FOR SELECT USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));
