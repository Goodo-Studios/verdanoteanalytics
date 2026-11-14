-- Rollup triggers: apply deltas instead of recomputing whole account-days.
--
-- Production, after the rollup release (20261215110001): the Meta sync's daily upserts into
-- creative_daily_metrics started timing out again ("Daily upsert error: canceling statement due to
-- statement timeout", POST /rest/v1/creative_daily_metrics 500, snapshot_prior_roas 500). The
-- triggers re-aggregated every raw row of each touched (account, day), about 1,100 rows each, for
-- every sync batch.
--
-- The trigger functions now add or subtract only the rows in the statement's transition tables:
--   insert: + new rows            delete: - old rows            update: + new rows, - old rows
-- so the cost is proportional to the batch. INSERT ... ON CONFLICT DO UPDATE fires the insert
-- trigger for rows it inserts and the update trigger for rows it updates, each with its own rows,
-- so the deltas add up exactly. A rollup row whose raw rows are all gone stays as a row of zeros
-- (get_period_metrics sums are unaffected).
--
-- refresh_creative_daily_rollup(accounts, dates) is kept as the repair tool: it recomputes the
-- given account-days from the raw rows (use it if the rollup is ever suspected to have drifted).
-- Same function names, so the existing triggers pick up the new bodies with no trigger change.

CREATE OR REPLACE FUNCTION public.creative_daily_metrics_rollup_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.creative_daily_rollup AS r
    (account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views)
  SELECT n.account_id, n.date,
         COALESCE(SUM(n.spend), 0), COALESCE(SUM(n.impressions), 0), COALESCE(SUM(n.clicks), 0),
         COALESCE(SUM(n.purchases), 0), COALESCE(SUM(n.purchase_value), 0),
         COALESCE(SUM(n.adds_to_cart), 0), COALESCE(SUM(n.video_views), 0)
    FROM new_rows n
   WHERE n.account_id IS NOT NULL
   GROUP BY n.account_id, n.date
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
  SELECT d.account_id, d.date,
         SUM(d.spend), SUM(d.impressions), SUM(d.clicks), SUM(d.purchases),
         SUM(d.purchase_value), SUM(d.adds_to_cart), SUM(d.video_views)
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

REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_delete() FROM PUBLIC, anon, authenticated;

-- The three triggers may have been disabled by hand on production as a stopgap while the old
-- recompute bodies were timing out sync writes. Make sure they are on, then bring the rollup back
-- in line with the raw rows (idempotent: it overwrites each account-day with the raw sums, month
-- by month so no single statement is large).
ALTER TABLE public.creative_daily_metrics ENABLE TRIGGER creative_daily_metrics_rollup_ins;
ALTER TABLE public.creative_daily_metrics ENABLE TRIGGER creative_daily_metrics_rollup_upd;
ALTER TABLE public.creative_daily_metrics ENABLE TRIGGER creative_daily_metrics_rollup_del;

DO $recompute$
DECLARE
  m date;
  lo date;
  hi date;
BEGIN
  SELECT date_trunc('month', MIN(date))::date, date_trunc('month', MAX(date))::date
    INTO lo, hi FROM public.creative_daily_metrics;
  IF lo IS NULL THEN
    RETURN;
  END IF;
  FOR m IN SELECT g::date FROM generate_series(lo, hi, interval '1 month') g LOOP
    INSERT INTO public.creative_daily_rollup AS r
      (account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views)
    SELECT account_id, date,
           COALESCE(SUM(spend), 0), COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0),
           COALESCE(SUM(purchases), 0), COALESCE(SUM(purchase_value), 0),
           COALESCE(SUM(adds_to_cart), 0), COALESCE(SUM(video_views), 0)
      FROM public.creative_daily_metrics
     WHERE account_id IS NOT NULL AND date >= m AND date < (m + interval '1 month')::date
     GROUP BY account_id, date
    ON CONFLICT (account_id, date) DO UPDATE
      SET spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
          purchases = EXCLUDED.purchases, purchase_value = EXCLUDED.purchase_value,
          adds_to_cart = EXCLUDED.adds_to_cart, video_views = EXCLUDED.video_views;
  END LOOP;

  -- Account-days with no raw rows at all: zero them out (they cannot be deleted by the delta
  -- triggers, and a deleted raw day must read as zero).
  UPDATE public.creative_daily_rollup r
     SET spend = 0, impressions = 0, clicks = 0, purchases = 0, purchase_value = 0,
         adds_to_cart = 0, video_views = 0
   WHERE NOT EXISTS (
     SELECT 1 FROM public.creative_daily_metrics x WHERE x.account_id = r.account_id AND x.date = r.date
   ) AND (r.spend <> 0 OR r.impressions <> 0 OR r.clicks <> 0 OR r.purchases <> 0
          OR r.purchase_value <> 0 OR r.adds_to_cart <> 0 OR r.video_views <> 0);
END;
$recompute$;
