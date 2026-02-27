ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS portfolio_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portfolio_slug text,
  ADD COLUMN IF NOT EXISTS portfolio_headline text,
  ADD COLUMN IF NOT EXISTS portfolio_results text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS portfolio_cta_url text DEFAULT 'https://goodostudios.com',
  ADD COLUMN IF NOT EXISTS logo_url text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_accounts_portfolio_slug ON public.ad_accounts(portfolio_slug) WHERE portfolio_slug IS NOT NULL;