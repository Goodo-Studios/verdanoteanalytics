ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS target_roas numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_cpa numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_monthly_spend numeric DEFAULT NULL;