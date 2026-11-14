-- get_period_metrics: replace COUNT(DISTINCT ...) with a per-ad hash aggregate.
--
-- Production 502s: the all-accounts call (90 days, about 200k rows) spent 5.4 s, most of it in a
-- 10 MB on-disk sort that COUNT(DISTINCT) forces. Grouping by ad_id first lets Postgres use a
-- HashAggregate (one entry per ad, a few thousand to tens of thousands) and then sum the per-ad
-- sums, so there is one scan and no sort.
--
-- Same results as before:
--   * sums are sums of per-ad sums (exact for integers and numeric);
--   * active_count is the number of distinct non-null ad_ids with at least one row with spend > 0
--     (COUNT(DISTINCT) ignores NULL, so the NULL ad_id group is excluded here as well).
-- Same signature, same caller gate, same search_path, same SECURITY DEFINER. CREATE OR REPLACE
-- keeps the existing grants, so no grant statements are needed.

CREATE OR REPLACE FUNCTION public.get_period_metrics(
  p_account_id text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE(
  total_spend numeric,
  total_impressions bigint,
  total_clicks bigint,
  total_purchases bigint,
  total_purchase_value numeric,
  total_adds_to_cart bigint,
  total_video_views bigint,
  active_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'builder')
     AND NOT public.has_role(auth.uid(), 'employee') THEN
    IF p_account_id IS NULL OR p_account_id NOT IN (SELECT public.get_user_account_ids(auth.uid())) THEN
      RAISE EXCEPTION 'access denied to account %', COALESCE(p_account_id, '(all accounts)') USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH per_ad AS (
    SELECT m.ad_id,
           SUM(m.spend) AS spend,
           SUM(m.impressions) AS impressions,
           SUM(m.clicks) AS clicks,
           SUM(m.purchases) AS purchases,
           SUM(m.purchase_value) AS purchase_value,
           SUM(m.adds_to_cart) AS adds_to_cart,
           SUM(m.video_views) AS video_views,
           MAX(m.spend) AS max_spend
    FROM public.creative_daily_metrics m
    WHERE (p_account_id IS NULL OR m.account_id = p_account_id)
      AND (p_from IS NULL OR m.date >= p_from)
      AND (p_to IS NULL OR m.date <= p_to)
    GROUP BY m.ad_id
  )
  SELECT COALESCE(SUM(p.spend), 0)::numeric,
         COALESCE(SUM(p.impressions), 0)::bigint,
         COALESCE(SUM(p.clicks), 0)::bigint,
         COALESCE(SUM(p.purchases), 0)::bigint,
         COALESCE(SUM(p.purchase_value), 0)::numeric,
         COALESCE(SUM(p.adds_to_cart), 0)::bigint,
         COALESCE(SUM(p.video_views), 0)::bigint,
         COUNT(*) FILTER (WHERE p.ad_id IS NOT NULL AND p.max_spend > 0)::bigint
  FROM per_ad p;
END;
$function$;
