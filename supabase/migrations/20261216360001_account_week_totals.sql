-- Audit plan item 7.3, part 3: the email digest's weekly totals cover every row.
--
-- send-digest summed spend from a plain select (capped at 1,000 rows by PostgREST) and
-- averaged each daily row's ROAS. This function returns one account's spend and purchase
-- value over [p_from, p_to_exclusive), so the digest can show the full total and ROAS as
-- purchase value over spend. It reads any account, so it is service_role only.

CREATE OR REPLACE FUNCTION public.account_week_totals(
  p_account_id     text,
  p_from           date,
  p_to_exclusive   date
)
RETURNS TABLE (spend numeric, purchase_value numeric)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(m.spend), 0)::numeric, COALESCE(SUM(m.purchase_value), 0)::numeric
    FROM public.creative_daily_metrics m
   WHERE m.account_id = p_account_id
     AND m.date >= p_from
     AND m.date <  p_to_exclusive
$$;

COMMENT ON FUNCTION public.account_week_totals(text, date, date) IS
  'Spend and purchase value for one account over [p_from, p_to_exclusive), for the email digest (audit 7.3). service_role only.';

REVOKE ALL ON FUNCTION public.account_week_totals(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_week_totals(text, date, date) TO service_role;
