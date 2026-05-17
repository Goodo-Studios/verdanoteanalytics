-- H-10: Server-side aggregation for period metrics
-- Replaces client-side exhaustive pagination + JS SUM over creative_daily_metrics.
-- A single Postgres SUM() replaces shipping 100K+ rows to the browser.

CREATE OR REPLACE FUNCTION public.get_period_metrics(
  p_account_id text DEFAULT NULL,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS TABLE (
  total_spend          numeric,
  total_impressions    bigint,
  total_clicks         bigint,
  total_purchases      bigint,
  total_purchase_value numeric,
  total_adds_to_cart   bigint,
  total_video_views    bigint,
  active_count         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(m.spend), 0)::numeric                                   AS total_spend,
    COALESCE(SUM(m.impressions), 0)::bigint                              AS total_impressions,
    COALESCE(SUM(m.clicks), 0)::bigint                                   AS total_clicks,
    COALESCE(SUM(m.purchases), 0)::bigint                                AS total_purchases,
    COALESCE(SUM(m.purchase_value), 0)::numeric                          AS total_purchase_value,
    COALESCE(SUM(m.adds_to_cart), 0)::bigint                             AS total_adds_to_cart,
    COALESCE(SUM(m.video_views), 0)::bigint                              AS total_video_views,
    COUNT(DISTINCT CASE WHEN m.spend > 0 THEN m.ad_id ELSE NULL END)     AS active_count
  FROM public.creative_daily_metrics m
  WHERE
    (p_account_id IS NULL OR m.account_id = p_account_id)
    AND (p_from IS NULL OR m.date >= p_from)
    AND (p_to   IS NULL OR m.date <= p_to);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_period_metrics(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_period_metrics(text, date, date) TO service_role;

-- H-9: Server-side daily trend aggregation
-- Replaces client-side exhaustive pagination + JS groupBy over creative_daily_metrics.
-- Groups rows by date, sums metrics, averages frequency, counts distinct active ads.

CREATE OR REPLACE FUNCTION public.get_daily_trends(
  p_account_id text DEFAULT NULL,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS TABLE (
  trend_date           date,
  spend                numeric,
  impressions          bigint,
  clicks               bigint,
  purchases            bigint,
  purchase_value       numeric,
  adds_to_cart         bigint,
  video_views          bigint,
  avg_frequency        numeric,
  active_ad_count      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.date                                                                                AS trend_date,
    COALESCE(SUM(m.spend), 0)::numeric                                                   AS spend,
    COALESCE(SUM(m.impressions), 0)::bigint                                              AS impressions,
    COALESCE(SUM(m.clicks), 0)::bigint                                                   AS clicks,
    COALESCE(SUM(m.purchases), 0)::bigint                                                AS purchases,
    COALESCE(SUM(m.purchase_value), 0)::numeric                                          AS purchase_value,
    COALESCE(SUM(m.adds_to_cart), 0)::bigint                                             AS adds_to_cart,
    COALESCE(SUM(m.video_views), 0)::bigint                                              AS video_views,
    COALESCE(
      AVG(m.frequency) FILTER (WHERE m.frequency IS NOT NULL AND m.frequency > 0),
      0
    )::numeric                                                                           AS avg_frequency,
    COUNT(DISTINCT m.ad_id)                                                              AS active_ad_count
  FROM public.creative_daily_metrics m
  WHERE
    (p_account_id IS NULL OR m.account_id = p_account_id)
    AND (p_from IS NULL OR m.date >= p_from)
    AND (p_to   IS NULL OR m.date <= p_to)
  GROUP BY m.date
  ORDER BY m.date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_trends(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_trends(text, date, date) TO service_role;
