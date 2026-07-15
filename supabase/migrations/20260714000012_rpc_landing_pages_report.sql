-- Landing Pages report (Creative Terminal — Phase 1, Feature 1), US-002.
--
-- Rolls creative_daily_metrics up to the DESTINATION grain (creatives.destination_key)
-- for an account + window, so the report reads stored daily rows rather than
-- re-pulling Meta. Same summable-base + derived-ratio contract as
-- get_creative_window_aggregates (US-005): ratios are DERIVED from summed base
-- metrics, never averaged, so a destination's roas/cpa/cvr reconcile exactly with
-- its summed spend/purchases/etc.
--
-- One row per destination_key. NULL and '' (the no-usable-destination sentinel set
-- by backfill-destination-key) are excluded. p_min_spend drops low-spend
-- destinations via HAVING. The UI computes the "report average" (mean across the
-- returned destinations) and per-card deltas from these rows.
--
-- Idempotent (CREATE OR REPLACE). Backed by idx_creatives_account_destination and
-- idx_daily_metrics_account_date. Window capped at RETENTION_DAYS=365.

CREATE OR REPLACE FUNCTION public.get_landing_pages_report(
  p_account_id text,
  p_from       date,
  p_to         date,
  p_min_spend  numeric DEFAULT 0
)
RETURNS TABLE (
  destination_key   text,
  creative_count    bigint,
  spend             numeric,
  impressions       bigint,
  clicks            bigint,
  purchases         bigint,
  purchase_value    numeric,
  adds_to_cart      bigint,
  video_views       bigint,
  roas              numeric,
  cpa               numeric,
  cvr               numeric,
  atc_rate          numeric,
  aov               numeric,
  ctr               numeric,
  cpm               numeric,
  cpc               numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'get_landing_pages_report: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_landing_pages_report: p_from and p_to are required';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'get_landing_pages_report: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;
  IF (p_to - p_from) > 365 THEN
    RAISE EXCEPTION 'get_landing_pages_report: window (% days) exceeds RETENTION_DAYS=365', (p_to - p_from);
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT
      c.destination_key                                        AS destination_key,
      COUNT(DISTINCT m.ad_id)                                  AS creative_count,
      COALESCE(SUM(m.spend), 0)::numeric                       AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint                  AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint                       AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint                    AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric              AS purchase_value,
      COALESCE(SUM(m.adds_to_cart), 0)::bigint                 AS adds_to_cart,
      COALESCE(SUM(m.video_views), 0)::bigint                  AS video_views
    FROM public.creative_daily_metrics m
    JOIN public.creatives c ON c.ad_id = m.ad_id
    WHERE m.account_id = p_account_id
      AND c.destination_key IS NOT NULL
      AND c.destination_key <> ''
      AND m.date >= p_from
      AND m.date <= p_to
    GROUP BY c.destination_key
    HAVING COALESCE(SUM(m.spend), 0) >= COALESCE(p_min_spend, 0)
  )
  SELECT
    a.destination_key,
    a.creative_count,
    a.spend,
    a.impressions,
    a.clicks,
    a.purchases,
    a.purchase_value,
    a.adds_to_cart,
    a.video_views,
    -- Derived ratios (never averaged). Percentage fields are true percentages
    -- (per verdanote-pct-fields-true-percentage-at-source).
    (CASE WHEN a.spend > 0 THEN a.purchase_value / a.spend ELSE 0 END)::numeric               AS roas,
    (CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END)::numeric                AS cpa,
    (CASE WHEN a.clicks > 0 THEN (a.purchases::numeric / a.clicks) * 100 ELSE 0 END)::numeric AS cvr,
    (CASE WHEN a.clicks > 0 THEN (a.adds_to_cart::numeric / a.clicks) * 100 ELSE 0 END)::numeric AS atc_rate,
    (CASE WHEN a.purchases > 0 THEN a.purchase_value / a.purchases ELSE 0 END)::numeric       AS aov,
    (CASE WHEN a.impressions > 0 THEN (a.clicks::numeric / a.impressions) * 100 ELSE 0 END)::numeric AS ctr,
    (CASE WHEN a.impressions > 0 THEN (a.spend / a.impressions) * 1000 ELSE 0 END)::numeric   AS cpm,
    (CASE WHEN a.clicks > 0 THEN a.spend / a.clicks ELSE 0 END)::numeric                      AS cpc
  FROM agg a
  ORDER BY a.spend DESC;
END;
$$;

COMMENT ON FUNCTION public.get_landing_pages_report(text, date, date, numeric) IS
  'US-002 Landing Pages report: rolls creative_daily_metrics up to creatives.destination_key for an account+window (<= 365d). Summable base + derived ratios (never averaged); NULL/'''' destinations excluded; p_min_spend via HAVING. UI computes report-average + deltas.';

GRANT EXECUTE ON FUNCTION public.get_landing_pages_report(text, date, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_landing_pages_report(text, date, date, numeric) TO service_role;
