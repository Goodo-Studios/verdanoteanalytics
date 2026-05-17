-- H-11: Server-side aggregation for agency dashboard
-- Replaces 3 parallel exhaustive paginators (200K+ combined rows) with a single
-- GROUP BY aggregate SQL query — O(1) network calls instead of O(N pages).
--
-- Returns per-account aggregates for the current period plus prior-month spend
-- for WoW/MoM comparisons, and per-ad creative rows for the winners table.

CREATE OR REPLACE FUNCTION public.get_agency_dashboard_summary(
  p_from      date DEFAULT NULL,
  p_to        date DEFAULT NULL,
  p_prior_from date DEFAULT NULL,
  p_prior_to   date DEFAULT NULL
)
RETURNS TABLE (
  -- per-account aggregates (current period)
  account_id           text,
  period_spend         numeric,
  period_revenue       numeric,
  active_ad_count      bigint,
  -- per-account prior-month spend (for MoM delta)
  prior_spend          numeric,
  -- per-ad creative rows (for winners table + fatigue alerts)
  ad_id                text,
  ad_name              text,
  thumbnail_url        text,
  ad_spend             numeric,
  ad_purchase_value    numeric,
  ad_impressions       bigint,
  -- weighted frequency numerator / denominator (client finishes the division)
  ad_frequency_weighted  numeric,
  ad_frequency_impressions bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH current_by_ad AS (
    SELECT
      m.account_id,
      m.ad_id,
      COALESCE(SUM(m.spend), 0)::numeric           AS ad_spend,
      COALESCE(SUM(m.purchase_value), 0)::numeric  AS ad_purchase_value,
      COALESCE(SUM(m.impressions), 0)::bigint       AS ad_impressions,
      -- weighted frequency: SUM(freq * impressions) / SUM(impressions)
      COALESCE(SUM(
        CASE WHEN m.frequency > 0 AND m.impressions > 0
             THEN m.frequency * m.impressions ELSE 0 END
      ), 0)::numeric                               AS ad_frequency_weighted,
      COALESCE(SUM(
        CASE WHEN m.frequency > 0 AND m.impressions > 0
             THEN m.impressions ELSE 0 END
      ), 0)::bigint                                AS ad_frequency_impressions
    FROM public.creative_daily_metrics m
    WHERE
      (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
    GROUP BY m.account_id, m.ad_id
  ),
  prior_by_account AS (
    SELECT
      m.account_id,
      COALESCE(SUM(m.spend), 0)::numeric AS prior_spend
    FROM public.creative_daily_metrics m
    WHERE
      (p_prior_from IS NULL OR m.date >= p_prior_from)
      AND (p_prior_to   IS NULL OR m.date <= p_prior_to)
    GROUP BY m.account_id
  ),
  account_agg AS (
    SELECT
      ca.account_id,
      COALESCE(SUM(ca.ad_spend), 0)::numeric       AS period_spend,
      COALESCE(SUM(ca.ad_purchase_value), 0)::numeric AS period_revenue,
      COUNT(DISTINCT CASE WHEN ca.ad_spend > 0 THEN ca.ad_id ELSE NULL END)::bigint AS active_ad_count
    FROM current_by_ad ca
    GROUP BY ca.account_id
  )
  SELECT
    aa.account_id,
    aa.period_spend,
    aa.period_revenue,
    aa.active_ad_count,
    COALESCE(pa.prior_spend, 0)::numeric AS prior_spend,
    ca.ad_id,
    cr.ad_name,
    cr.thumbnail_url,
    ca.ad_spend,
    ca.ad_purchase_value,
    ca.ad_impressions,
    ca.ad_frequency_weighted,
    ca.ad_frequency_impressions
  FROM account_agg aa
  JOIN current_by_ad ca ON ca.account_id = aa.account_id
  LEFT JOIN public.creatives cr ON cr.ad_id = ca.ad_id AND cr.account_id = ca.account_id
  LEFT JOIN prior_by_account pa ON pa.account_id = aa.account_id
  ORDER BY aa.account_id, ca.ad_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_dashboard_summary(date, date, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_dashboard_summary(date, date, date, date) TO service_role;
