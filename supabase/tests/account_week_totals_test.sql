-- account_week_totals (audit plan item 7.3, part 3): one account's spend and purchase value over
-- a half-open date range, over every row; service_role only.
--
-- Run with the local stack (requires Docker):  supabase test db
-- All rows are made up and use dates in 2020.

BEGIN;
SELECT plan(5);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_awt', 'AWT', now()), ('act_awt_x', 'AWT X', now());
-- The daily rows reference creatives, so the ads exist first.
INSERT INTO public.creatives (ad_id, account_id, ad_name)
SELECT 'awt_' || i, 'act_awt', 'Ad ' || i FROM generate_series(1, 1500) AS i;
INSERT INTO public.creatives (ad_id, account_id, ad_name) VALUES ('awt_x', 'act_awt_x', 'Ad X');
-- 1,500 ads with one row each on 2020-07-01 (spend 2, value 6), plus rows outside the range
-- and in another account that must not count.
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, spend, purchase_value)
SELECT 'awt_' || i, 'act_awt', '2020-07-01', 2, 6 FROM generate_series(1, 1500) AS i;
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, spend, purchase_value) VALUES
  ('awt_1', 'act_awt', '2020-07-08', 999, 999),
  ('awt_x', 'act_awt_x', '2020-07-01', 999, 999);

SELECT is((SELECT spend FROM public.account_week_totals('act_awt', '2020-07-01', '2020-07-08')), 3000::numeric,
  'spend over every row in the range, past 1,000 rows');
SELECT is((SELECT purchase_value FROM public.account_week_totals('act_awt', '2020-07-01', '2020-07-08')), 9000::numeric,
  'purchase value over every row; the end date is excluded and other accounts do not count');
SELECT is((SELECT spend FROM public.account_week_totals('act_awt', '2021-01-01', '2021-01-08')), 0::numeric,
  'an empty range is zero, not null');
SELECT ok(has_function_privilege('service_role', 'public.account_week_totals(text, date, date)', 'EXECUTE'), 'service_role can execute');
SELECT ok(NOT has_function_privilege('authenticated', 'public.account_week_totals(text, date, date)', 'EXECUTE'), 'authenticated cannot execute');

SELECT * FROM finish();
ROLLBACK;
