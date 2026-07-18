-- =============================================================================
-- Creative Intelligence (WS2 / US-004) — destination → product resolution store
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- One row per unique landing destination (keyed by the canonical destination_key
-- from _shared/normalize-destination.ts), so every ad pointing at the same page
-- shares one resolved product/type. Creatives join in via
-- (account_id, destination_key). Feeds the `product` tag suggestion (US-008) and a
-- same-destination corroboration signal for entity resolution (US-006).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.landing_destinations (
  account_id        text NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  destination_key   text NOT NULL,
  destination_type  text,          -- product | collection | homepage | lead-form | other
  destination_product text,        -- humanized product name (product type only); NULL otherwise
  product_slug      text,          -- raw handle parsed from the path (product OR collection)
  page_title        text,          -- optional og:title/<title> from a cached lightweight fetch
  sample_url        text,          -- an example raw landing_page_url for reference
  resolved_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, destination_key)
);

CREATE INDEX IF NOT EXISTS idx_landing_destinations_account
  ON public.landing_destinations(account_id);
CREATE INDEX IF NOT EXISTS idx_landing_destinations_product
  ON public.landing_destinations(account_id, destination_product)
  WHERE destination_product IS NOT NULL;

ALTER TABLE public.landing_destinations ENABLE ROW LEVEL SECURITY;
-- Internal/service-role batch (resolve-destinations); no public policies (service
-- role bypasses RLS). A browser read path (Entity report, US-007) can add a
-- SECURITY DEFINER RPC later, mirroring entity-report.

COMMENT ON TABLE public.landing_destinations IS
  'WS2 (US-004): resolved landing destination per (account_id, destination_key). Shared across all ads to the same page. Path-classified by _shared/classify-destination.ts; product name optionally refined by a cached og:title fetch.';

-- Distinct destinations for an account (with one sample raw URL), for the
-- resolve-destinations batch to iterate without pulling every creative row.
CREATE OR REPLACE FUNCTION public.distinct_destinations(
  p_account_id text,
  p_limit      int DEFAULT 2000
) RETURNS TABLE(destination_key text, sample_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.destination_key, min(c.landing_page_url) AS sample_url
  FROM public.creatives c
  WHERE c.account_id = p_account_id
    AND c.destination_key IS NOT NULL
  GROUP BY c.destination_key
  LIMIT GREATEST(p_limit, 1);
$$;
