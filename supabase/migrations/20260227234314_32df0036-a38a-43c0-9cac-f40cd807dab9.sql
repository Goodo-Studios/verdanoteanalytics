ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS portfolio_account_ids text[] DEFAULT '{}'::text[];