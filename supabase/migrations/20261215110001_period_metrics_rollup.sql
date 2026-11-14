-- Daily rollup behind get_period_metrics.
--
-- Production: the all-accounts 90 day call reads about 197k rows of creative_daily_metrics and
-- takes 6 to 7 s (gateway 502s, statement timeouts, collateral 502s on unrelated calls).
-- This adds two small tables that the sync writes keep current, and get_period_metrics reads
-- them instead of the raw rows (a few thousand rows, milliseconds).
--
--   creative_daily_rollup(account_id, date)    one row per account and day: the seven sums.
--   creative_ad_spend_span(ad_id)              first and last day with spend > 0 for the ad.
--
-- active_count (distinct ads with spend in the range) cannot be summed from per-day counts, so
-- it is answered from the spans: an ad is active if its span overlaps the range. This equals the
-- exact count except for an ad with spend before and after the range and none inside it. On
-- production data on 2026-11-14 the two agree exactly for the last 90 days (16694 and 16694).
-- Spans only widen: deleting or zeroing old rows does not shrink them (a rare overcount).
--
-- Both tables are server-side only: RLS on, no policies, no grants to browser roles. They are
-- read only through the SECURITY DEFINER function, which keeps its caller gate.

CREATE TABLE IF NOT EXISTS public.creative_daily_rollup (
  account_id text NOT NULL,
  date date NOT NULL,
  spend numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  purchases bigint NOT NULL DEFAULT 0,
  purchase_value numeric NOT NULL DEFAULT 0,
  adds_to_cart bigint NOT NULL DEFAULT 0,
  video_views bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, date)
);
CREATE INDEX IF NOT EXISTS creative_daily_rollup_date_idx ON public.creative_daily_rollup (date);

CREATE TABLE IF NOT EXISTS public.creative_ad_spend_span (
  ad_id text PRIMARY KEY,
  account_id text,
  first_date date NOT NULL,
  last_date date NOT NULL
);
CREATE INDEX IF NOT EXISTS creative_ad_spend_span_dates_idx ON public.creative_ad_spend_span (last_date, first_date);

ALTER TABLE public.creative_daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_ad_spend_span ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creative_daily_rollup FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.creative_ad_spend_span FROM PUBLIC, anon, authenticated;

-- Recompute the rollup rows for a set of (account_id, date) keys from the raw table, and drop
-- rollup rows whose raw rows are all gone.
CREATE OR REPLACE FUNCTION public.refresh_creative_daily_rollup(p_accounts text[], p_dates date[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF p_accounts IS NULL OR cardinality(p_accounts) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.creative_daily_rollup AS r
    (account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views)
  SELECT m.account_id, m.date,
         COALESCE(SUM(m.spend), 0), COALESCE(SUM(m.impressions), 0), COALESCE(SUM(m.clicks), 0),
         COALESCE(SUM(m.purchases), 0), COALESCE(SUM(m.purchase_value), 0),
         COALESCE(SUM(m.adds_to_cart), 0), COALESCE(SUM(m.video_views), 0)
    FROM public.creative_daily_metrics m
    JOIN (SELECT DISTINCT * FROM unnest(p_accounts, p_dates) AS k(account_id, date)) k
      ON k.account_id = m.account_id AND k.date = m.date
   GROUP BY m.account_id, m.date
  ON CONFLICT (account_id, date) DO UPDATE
    SET spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        purchases = EXCLUDED.purchases, purchase_value = EXCLUDED.purchase_value,
        adds_to_cart = EXCLUDED.adds_to_cart, video_views = EXCLUDED.video_views;

  DELETE FROM public.creative_daily_rollup r
   USING (SELECT DISTINCT * FROM unnest(p_accounts, p_dates) AS k(account_id, date)) k
   WHERE r.account_id = k.account_id AND r.date = k.date
     AND NOT EXISTS (
       SELECT 1 FROM public.creative_daily_metrics m
        WHERE m.account_id = r.account_id AND m.date = r.date
     );
END;
$function$;

-- Widen the spend span of the ads in a set of raw rows (only rows with spend > 0).
CREATE OR REPLACE FUNCTION public.widen_creative_ad_spend_span(p_ads text[], p_accounts text[], p_dates date[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  INSERT INTO public.creative_ad_spend_span AS s (ad_id, account_id, first_date, last_date)
  SELECT t.ad_id, (array_agg(t.account_id))[1], MIN(t.date), MAX(t.date)
    FROM unnest(p_ads, p_accounts, p_dates) AS t(ad_id, account_id, date)
   WHERE t.ad_id IS NOT NULL
   GROUP BY t.ad_id
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
  PERFORM public.refresh_creative_daily_rollup(
    ARRAY(SELECT account_id FROM (SELECT DISTINCT account_id, date FROM new_rows WHERE account_id IS NOT NULL) d ORDER BY date, account_id),
    ARRAY(SELECT date FROM (SELECT DISTINCT account_id, date FROM new_rows WHERE account_id IS NOT NULL) d ORDER BY date, account_id)
  );
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
  -- Keys of both the old and the new rows (a row can move to another account or day).
  PERFORM public.refresh_creative_daily_rollup(
    ARRAY(SELECT account_id FROM (SELECT account_id, date FROM new_rows UNION SELECT account_id, date FROM old_rows) d WHERE account_id IS NOT NULL ORDER BY date, account_id),
    ARRAY(SELECT date FROM (SELECT account_id, date FROM new_rows UNION SELECT account_id, date FROM old_rows) d WHERE account_id IS NOT NULL ORDER BY date, account_id)
  );
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
  PERFORM public.refresh_creative_daily_rollup(
    ARRAY(SELECT account_id FROM (SELECT DISTINCT account_id, date FROM old_rows WHERE account_id IS NOT NULL) d ORDER BY date, account_id),
    ARRAY(SELECT date FROM (SELECT DISTINCT account_id, date FROM old_rows WHERE account_id IS NOT NULL) d ORDER BY date, account_id)
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_creative_daily_rollup(text[], date[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.widen_creative_ad_spend_span(text[], text[], date[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_daily_metrics_rollup_delete() FROM PUBLIC, anon, authenticated;

-- Backfill from the existing rows first, then attach the triggers, in one explicit transaction
-- (the migration runner adds none), so no write is missed between the two.
BEGIN;
LOCK TABLE public.creative_daily_metrics IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.creative_daily_rollup
  (account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views)
SELECT account_id, date,
       COALESCE(SUM(spend), 0), COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0),
       COALESCE(SUM(purchases), 0), COALESCE(SUM(purchase_value), 0),
       COALESCE(SUM(adds_to_cart), 0), COALESCE(SUM(video_views), 0)
  FROM public.creative_daily_metrics
 WHERE account_id IS NOT NULL
 GROUP BY account_id, date
ON CONFLICT (account_id, date) DO NOTHING;

INSERT INTO public.creative_ad_spend_span (ad_id, account_id, first_date, last_date)
SELECT ad_id, (array_agg(account_id))[1], MIN(date), MAX(date)
  FROM public.creative_daily_metrics
 WHERE spend > 0 AND ad_id IS NOT NULL
 GROUP BY ad_id
ON CONFLICT (ad_id) DO NOTHING;

DROP TRIGGER IF EXISTS creative_daily_metrics_rollup_ins ON public.creative_daily_metrics;
CREATE TRIGGER creative_daily_metrics_rollup_ins
  AFTER INSERT ON public.creative_daily_metrics
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.creative_daily_metrics_rollup_insert();

DROP TRIGGER IF EXISTS creative_daily_metrics_rollup_upd ON public.creative_daily_metrics;
CREATE TRIGGER creative_daily_metrics_rollup_upd
  AFTER UPDATE ON public.creative_daily_metrics
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.creative_daily_metrics_rollup_update();

DROP TRIGGER IF EXISTS creative_daily_metrics_rollup_del ON public.creative_daily_metrics;
CREATE TRIGGER creative_daily_metrics_rollup_del
  AFTER DELETE ON public.creative_daily_metrics
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.creative_daily_metrics_rollup_delete();

-- get_period_metrics now reads the rollup. Same signature, caller gate, search_path and grants.
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
  SELECT COALESCE(SUM(r.spend), 0)::numeric,
         COALESCE(SUM(r.impressions), 0)::bigint,
         COALESCE(SUM(r.clicks), 0)::bigint,
         COALESCE(SUM(r.purchases), 0)::bigint,
         COALESCE(SUM(r.purchase_value), 0)::numeric,
         COALESCE(SUM(r.adds_to_cart), 0)::bigint,
         COALESCE(SUM(r.video_views), 0)::bigint,
         (SELECT COUNT(*)
            FROM public.creative_ad_spend_span s
           WHERE (p_account_id IS NULL OR s.account_id = p_account_id)
             AND (p_to IS NULL OR s.first_date <= p_to)
             AND (p_from IS NULL OR s.last_date >= p_from))::bigint
    FROM public.creative_daily_rollup r
   WHERE (p_account_id IS NULL OR r.account_id = p_account_id)
     AND (p_from IS NULL OR r.date >= p_from)
     AND (p_to IS NULL OR r.date <= p_to);
END;
$function$;
