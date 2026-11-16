-- Result counts follow the account's optimization goal (audit plan item 6.5, part 4).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- creative_daily_metrics keeps each day's result count, and rollup_creatives_from_daily sums
-- it for SESSION_CONVERSION accounts instead of copying purchases. PURCHASE accounts still
-- use purchases. All rows are made up and use dates in 2020.

BEGIN;
SELECT plan(5);

SELECT has_column('public', 'creative_daily_metrics', 'result_count', 'daily rows keep the result count');

INSERT INTO public.ad_accounts (id, name, last_synced_at, optimization_goal) VALUES
  ('act_rg_s', 'RG Sessions', now(), 'SESSION_CONVERSION'),
  ('act_rg_p', 'RG Purchases', now(), 'PURCHASE');
INSERT INTO public.creatives (ad_id, account_id, ad_name, ad_type) VALUES
  ('rg_s1', 'act_rg_s', 'RGS1_one', 'Video'),
  ('rg_p1', 'act_rg_p', 'RGP1_one', 'Video');
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, spend, purchases, result_count) VALUES
  ('rg_s1', 'act_rg_s', '2020-06-01', 30, 1, 3),
  ('rg_s1', 'act_rg_s', '2020-06-02', 40, 1, 4),
  ('rg_p1', 'act_rg_p', '2020-06-01', 30, 1, 9),
  ('rg_p1', 'act_rg_p', '2020-06-02', 40, 1, 9);

SELECT public.rollup_creatives_from_daily('act_rg_s', '2020-06-01', '2020-06-30');
SELECT public.rollup_creatives_from_daily('act_rg_p', '2020-06-01', '2020-06-30');

SELECT is((SELECT result_count::numeric FROM public.creatives WHERE ad_id = 'rg_s1'), 7::numeric,
  'SESSION_CONVERSION: results are the summed daily result counts');
SELECT is((SELECT round(cost_per_result::numeric, 4) FROM public.creatives WHERE ad_id = 'rg_s1'), 10.0000::numeric,
  'SESSION_CONVERSION: cost per result is spend over results');
SELECT is((SELECT result_count::numeric FROM public.creatives WHERE ad_id = 'rg_p1'), 2::numeric,
  'PURCHASE: results are purchases');
SELECT is((SELECT round(cost_per_result::numeric, 4) FROM public.creatives WHERE ad_id = 'rg_p1'), 35.0000::numeric,
  'PURCHASE: cost per result is spend over purchases');

SELECT * FROM finish();
ROLLBACK;
