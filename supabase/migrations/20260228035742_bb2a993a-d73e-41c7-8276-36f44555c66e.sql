
ALTER TABLE public.account_context 
ADD COLUMN IF NOT EXISTS scoring_config jsonb DEFAULT '{
  "roas_weight": 35,
  "ctr_weight": 20,
  "hook_rate_weight": 15,
  "spend_efficiency_weight": 10,
  "momentum_weight": 10,
  "fatigue_weight": 10,
  "scale_threshold": 2.0,
  "kill_threshold": 0.8,
  "min_spend": 100,
  "ctr_benchmark": 3.0,
  "hook_rate_benchmark": 25.0
}';
