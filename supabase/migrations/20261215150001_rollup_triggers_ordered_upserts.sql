-- Rollup triggers: take row locks in a fixed order so concurrent sync batches cannot deadlock.
--
-- The delta triggers from 20261215130001 upsert into creative_daily_rollup (and, through
-- widen_creative_ad_spend_span, into creative_ad_spend_span) from a GROUP BY with no ORDER BY.
-- A hash aggregate emits groups in arbitrary order, so two sync batches touching overlapping
-- account-days can lock the same rollup rows in opposite orders and fail with 40P01 (deadlock
-- detected). INSERT ... SELECT processes rows in the order the SELECT returns them, so the
-- aggregate is now wrapped in a subquery and sorted before the INSERT ... ON CONFLICT:
--   creative_daily_rollup:     ORDER BY account_id, date
--   creative_ad_spend_span:    ORDER BY ad_id
-- The delete trigger updates rollup rows through an UPDATE ... FROM, whose lock order is also
-- arbitrary, so it first locks the affected rollup rows in (account_id, date) order.
-- Behavior is otherwise identical to 20261215130001 (same sums, same function names and grants).

CREATE OR REPLACE FUNCTION public.widen_creative_ad_spend_span(p_ads text[], p_accounts text[], p_dates date[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  INSERT INTO public.creative_ad_spend_span AS s (ad_id, account_id, first_date, last_date)
  SELECT g.ad_id, g.account_id, g.first_date, g.last_date
    FROM (
      SELECT t.ad_id, (array_agg(t.account_id))[1] AS account_id,
             MIN(t.date) AS first_date, MAX(t.date) AS last_date
        FROM unnest(p_ads, p_accounts, p_dates) AS t(ad_id, account_id, date)
       WHERE t.ad_id IS NOT NULL
       GROUP BY t.ad_id
    ) g
   ORDER BY g.ad_id
  ON CONFLICT (ad_id) DO UPDATE
    SET first_date = LEAST(s.first_date, EXCLUDED.first_date),
        last_date = GREATEST(s.last_date, EXCLUDED.last_date),
        account_id = COALESCE(EXCLUDED.account_id, s.account_id);
$function$;

CREATE OR REPLACE FUNCTION public.creative_daily_metrics_rollup_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.creative_daily_rollup AS r
    (account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views)
  SELECT g.account_id, g.date, g.spend, g.impressions, g.clicks, g.purchases,
         g.purchase_value, g.adds_to_cart, g.video_views
    FROM (
      SELECT n.account_id, n.date,
             COALESCE(SUM(n.spend), 0) AS spend, COALESCE(SUM(n.impressions), 0) AS impressions,
             COALESCE(SUM(n.clicks), 0) AS clicks, COALESCE(SUM(n.purchases), 0) AS purchases,
             COALESCE(SUM(n.purchase_value), 0) AS purchase_value,
             COALESCE(SUM(n.adds_to_cart), 0) AS adds_to_cart, COALESCE(SUM(n.video_views), 0) AS video_views
        FROM new_rows n
       WHERE n.account_id IS NOT NULL
       GROUP BY n.account_id, n.date
    ) g
   ORDER BY g.account_id, g.date
  ON CONFLICT (account_id, date) DO UPDATE
    SET spend = r.spend + EXCLUDED.spend,
        impressions = r.impressions + EXCLUDED.impressions,
        clicks = r.clicks + EXCLUDED.clicks,
        purchases = r.purchases + EXCLUDED.purchases,
        purchase_value = r.purchase_value + EXCLUDED.purchase_value,
        adds_to_cart = r.adds_to_cart + EXCLUDED.adds_to_cart,
        video_views = r.video_views + EXCLUDED.video_views;

  PERFORM public.widen_creative_ad_spend_span(
    ARRAY(SELECT ad_id FROM new_rows WHERE spend > 0 ORDER BY ad_id, date),
    ARRAY(SELECT account_id FROM new_rows WHERE spend > 0 ORDER BY ad_id, date),
    ARRAY(SELECT date FROM new_rows WHERE spend > 0 ORDER BY ad_id, date)
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.creative_daily_metrics_rollup_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.creative_daily_rollup AS r
    (account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views)
  SELECT g.account_id, g.date, g.spend, g.impressions, g.clicks, g.purchases,
         g.purchase_value, g.adds_to_cart, g.video_views
    FROM (
      SELECT d.account_id, d.date,
             SUM(d.spend) AS spend, SUM(d.impressions) AS impressions, SUM(d.clicks) AS clicks,
             SUM(d.purchases) AS purchases, SUM(d.purchase_value) AS purchase_value,
             SUM(d.adds_to_cart) AS adds_to_cart, SUM(d.video_views) AS video_views
        FROM (
          SELECT n.account_id, n.date,
                 COALESCE(n.spend, 0) AS spend, COALESCE(n.impressions, 0) AS impressions,
                 COALESCE(n.clicks, 0) AS clicks, COALESCE(n.purchases, 0) AS purchases,
                 COALESCE(n.purchase_value, 0) AS purchase_value, COALESCE(n.adds_to_cart, 0) AS adds_to_cart,
                 COALESCE(n.video_views, 0) AS video_views
            FROM new_rows n WHERE n.account_id IS NOT NULL
          UNION ALL
          SELECT o.account_id, o.date,
                 -COALESCE(o.spend, 0), -COALESCE(o.impressions, 0),
                 -COALESCE(o.clicks, 0), -COALESCE(o.purchases, 0),
                 -COALESCE(o.purchase_value, 0), -COALESCE(o.adds_to_cart, 0),
                 -COALESCE(o.video_views, 0)
            FROM old_rows o WHERE o.account_id IS NOT NULL
        ) d
       GROUP BY d.account_id, d.date
    ) g
   ORDER BY g.account_id, g.date
  ON CONFLICT (account_id, date) DO UPDATE
    SET spend = r.spend + EXCLUDED.spend,
        impressions = r.impressions + EXCLUDED.impressions,
        clicks = r.clicks + EXCLUDED.clicks,
        purchases = r.purchases + EXCLUDED.purchases,
        purchase_value = r.purchase_value + EXCLUDED.purchase_value,
        adds_to_cart = r.adds_to_cart + EXCLUDED.adds_to_cart,
        video_views = r.video_views + EXCLUDED.video_views;

  PERFORM public.widen_creative_ad_spend_span(
    ARRAY(SELECT ad_id FROM new_rows WHERE spend > 0 ORDER BY ad_id, date),
    ARRAY(SELECT account_id FROM new_rows WHERE spend > 0 ORDER BY ad_id, date),
    ARRAY(SELECT date FROM new_rows WHERE spend > 0 ORDER BY ad_id, date)
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.creative_daily_metrics_rollup_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Lock the affected rollup rows in a fixed order before the UPDATE ... FROM touches them.
  PERFORM 1
    FROM public.creative_daily_rollup r
   WHERE EXISTS (
     SELECT 1 FROM old_rows o
      WHERE o.account_id IS NOT NULL AND o.account_id = r.account_id AND o.date = r.date
   )
   ORDER BY r.account_id, r.date
     FOR UPDATE OF r;

  UPDATE public.creative_daily_rollup r
     SET spend = r.spend - d.spend,
         impressions = r.impressions - d.impressions,
         clicks = r.clicks - d.clicks,
         purchases = r.purchases - d.purchases,
         purchase_value = r.purchase_value - d.purchase_value,
         adds_to_cart = r.adds_to_cart - d.adds_to_cart,
         video_views = r.video_views - d.video_views
    FROM (
      SELECT o.account_id, o.date,
             COALESCE(SUM(o.spend), 0) AS spend, COALESCE(SUM(o.impressions), 0) AS impressions,
             COALESCE(SUM(o.clicks), 0) AS clicks, COALESCE(SUM(o.purchases), 0) AS purchases,
             COALESCE(SUM(o.purchase_value), 0) AS purchase_value,
             COALESCE(SUM(o.adds_to_cart), 0) AS adds_to_cart, COALESCE(SUM(o.video_views), 0) AS video_views
        FROM old_rows o
       WHERE o.account_id IS NOT NULL
       GROUP BY o.account_id, o.date
    ) d
   WHERE r.account_id = d.account_id AND r.date = d.date;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.widen_creative_ad_spend_span(text[], text[], date[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_delete() FROM PUBLIC, anon, authenticated;
