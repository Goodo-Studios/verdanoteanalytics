-- creatives_list_page applies the Creatives page's advanced filters to the whole set
-- (audit plan item 7.1, part 3).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The advanced filter panel ran over the 100 rows the page had loaded. Fixture: 130 made-up
-- ads, spend falling from ad 1 to ad 130. Ads 121-130 (lowest spend, off the first page by
-- spend) have ROAS 5; the rest have ROAS 1. A few ads carry a hook, a legacy ad type, a
-- paused status, an old start date or a campaign name; ad 130 has two weeks of daily rows
-- with ROAS doubling (Scaling). All rows are made up; the date-range rows use 2020.

BEGIN;
SELECT plan(13);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_cla', 'CLA', now());

INSERT INTO public.creatives (ad_id, account_id, ad_name, spend, purchases, purchase_value, roas, cpa, ctr, frequency,
                              hook, ad_type, ad_status, campaign_name, created_at)
SELECT 'cla_' || lpad(i::text, 3, '0'), 'act_cla', 'Ad ' || i,
       1000 - i, 1, (1000 - i) * CASE WHEN i > 120 THEN 5 ELSE 1 END, CASE WHEN i > 120 THEN 5 ELSE 1 END,
       1000 - i, 1, 1,
       CASE WHEN i = 125 THEN 'Question hook' END,
       CASE WHEN i = 126 THEN 'Image' END,
       CASE WHEN i = 127 THEN 'PAUSED' ELSE 'ACTIVE' END,
       CASE WHEN i = 129 THEN 'Holiday Push' ELSE 'Evergreen' END,
       CASE WHEN i = 128 THEN now() - interval '40 days' ELSE now() END
  FROM generate_series(1, 130) AS i;

INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, impressions, clicks, spend, purchases, purchase_value)
SELECT ad_id, account_id, '2020-06-01', 1000, 10, spend, 1, purchase_value
  FROM public.creatives WHERE account_id = 'act_cla';

-- Ad 130: prior week ROAS 1, this week ROAS 2 (two full UTC weeks ending yesterday).
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, impressions, spend, purchase_value)
SELECT 'cla_130', 'act_cla', (now() AT TIME ZONE 'UTC')::date - d, 100, 10, CASE WHEN d <= 7 THEN 20 ELSE 10 END
  FROM generate_series(1, 14) AS d;

CREATE FUNCTION pg_temp.cla_total(conds jsonb, dated boolean) RETURNS int LANGUAGE sql AS $$
  SELECT (public.creatives_list_page(
            p_account_id := 'act_cla',
            p_date_from := CASE WHEN dated THEN '2020-06-01'::date END,
            p_date_to   := CASE WHEN dated THEN '2020-06-30'::date END,
            p_conditions := conds)->>'total')::int
$$;

-- ---------------------------------------------------------------- numbers (1-3)
SELECT is(pg_temp.cla_total('[{"field":"roas","operator":"gt","value":"3"}]', true), 10,
  'dates: ROAS > 3 finds all 10 matching ads, including the ones past the first page');
SELECT is(pg_temp.cla_total('[{"field":"roas","operator":"gt","value":"3"}]', false), 10,
  'no dates: ROAS > 3 finds all 10 matching ads');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements((public.creatives_list_page(
             p_account_id := 'act_cla', p_date_from := '2020-06-01', p_date_to := '2020-06-30',
             p_conditions := '[{"field":"roas","operator":"gt","value":"3"}]'))->'data')), 10,
  'dates: the matching ads are on page one');

-- ---------------------------------------------------------------- text and choices (4-8)
SELECT is(pg_temp.cla_total('[{"field":"hook_type","operator":"contains","value":" question "}]', false), 1,
  'hook contains, trimmed and case-insensitive');
SELECT is(pg_temp.cla_total('[{"field":"format","operator":"is","value":"","multiValues":["Static"]}]', false), 1,
  'ad type Static also matches a legacy Image row');
SELECT is(pg_temp.cla_total('[{"field":"campaign","operator":"contains","value":"HOLI"}]', true), 1,
  'campaign contains, case-insensitive');
SELECT is(pg_temp.cla_total('[{"field":"status","operator":"is","value":"","multiValues":["Paused"]}]', false), 1,
  'status Paused');
SELECT is(pg_temp.cla_total('[{"field":"days_running","operator":"gt","value":"30"}]', false), 1,
  'days running > 30');

-- ---------------------------------------------------------------- grade and momentum (9-10)
-- Grade A = top fifth by spend within the account over the whole set: ads 1-26 of 130.
SELECT is(pg_temp.cla_total('[{"field":"grade","operator":"is","value":"","multiValues":["A"]}]', true), 26,
  'grade A is the whole-set top fifth');
SELECT is(pg_temp.cla_total('[{"field":"status","operator":"is","value":"","multiValues":["Scaling"]}]', false), 1,
  'status Scaling uses week-over-week ROAS');

-- ---------------------------------------------------------------- combined and empty (11-13)
SELECT is(pg_temp.cla_total('[{"field":"roas","operator":"gt","value":"3"},{"field":"hook_type","operator":"contains","value":"question"}]', false), 1,
  'conditions combine with AND');
SELECT is(pg_temp.cla_total('[]', true), 130, 'an empty condition list filters nothing');
SELECT ok((SELECT (public.creatives_list_page(
             p_account_id := 'act_cla', p_date_from := '2020-06-01', p_date_to := '2020-06-30',
             p_conditions := '[{"field":"roas","operator":"gt","value":"3"}]')->'aggregates'->>'total_spend')::numeric
           = (SELECT sum(1000 - i) FROM generate_series(121, 130) AS i)),
  'aggregates cover only the filtered ads');

SELECT * FROM finish();
ROLLBACK;
