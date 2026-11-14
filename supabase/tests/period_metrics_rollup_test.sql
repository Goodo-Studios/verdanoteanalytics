-- get_period_metrics rollup (migration 20261215110001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks that the triggers keep creative_daily_rollup and creative_ad_spend_span in step with
-- creative_daily_metrics (insert, upsert, update, delete), that get_period_metrics answers the
-- same numbers as the raw rows, the active count (including a spend gap), the caller gate, and
-- that the two new tables are closed to browser roles. All rows are made up, dates in 2020.

BEGIN;
SELECT plan(15);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES
  ('act_rl_a', 'RL A', now()), ('act_rl_b', 'RL B', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name, ad_type, hook, spend, purchases, purchase_value) VALUES
  ('rl_a1', 'act_rl_a', 'RLA1', 'Image', 'H1', 0, 0, 0),
  ('rl_a2', 'act_rl_a', 'RLA2', 'Video', 'H2', 0, 0, 0),
  ('rl_a3', 'act_rl_a', 'RLA3', 'Video', 'H3', 0, 0, 0),
  ('rl_b1', 'act_rl_b', 'RLB1', 'Static', 'H1', 0, 0, 0);

INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency) VALUES
  ('rl_a1', 'act_rl_a', '2020-02-01', 1000, 50, 20, 2, 120, 5, 10, 1),
  ('rl_a1', 'act_rl_a', '2020-02-02', 3000, 100, 30, 3, 300, 6, 20, 1),
  ('rl_a2', 'act_rl_a', '2020-02-01', 500, 0, 0, 0, 0, 0, 0, 1),
  ('rl_a3', 'act_rl_a', '2020-03-15', 9999, 9999, 1, 1, 1, 1, 1, 1),
  ('rl_b1', 'act_rl_b', '2020-02-01', 800, 80, 8, 4, 160, 2, 3, 1);

-- The insert trigger filled the rollup, one row per account and day.
SELECT results_eq(
  $$SELECT account_id, date, spend, impressions, purchases FROM public.creative_daily_rollup
     WHERE account_id LIKE 'act_rl_%' ORDER BY account_id, date$$,
  $$VALUES ('act_rl_a'::text, '2020-02-01'::date, 50::numeric, 1500::bigint, 2::bigint),
           ('act_rl_a', '2020-02-02', 100, 3000, 3),
           ('act_rl_a', '2020-03-15', 9999, 9999, 1),
           ('act_rl_b', '2020-02-01', 80, 800, 4)$$,
  'insert trigger builds one rollup row per account and day'
);

SELECT results_eq(
  $$SELECT ad_id, first_date, last_date FROM public.creative_ad_spend_span WHERE ad_id LIKE 'rl_%' ORDER BY ad_id$$,
  $$VALUES ('rl_a1'::text, '2020-02-01'::date, '2020-02-02'::date),
           ('rl_a3', '2020-03-15', '2020-03-15'),
           ('rl_b1', '2020-02-01', '2020-02-01')$$,
  'spans cover only ads with spend, from first to last spend day'
);

-- Upsert path (what the syncs do): same key again with new numbers replaces the day total.
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency)
VALUES ('rl_a1', 'act_rl_a', '2020-02-01', 1200, 70, 25, 2, 120, 5, 10, 1)
ON CONFLICT (ad_id, date) DO UPDATE SET impressions = EXCLUDED.impressions, spend = EXCLUDED.spend, clicks = EXCLUDED.clicks;

SELECT is(
  (SELECT spend FROM public.creative_daily_rollup WHERE account_id = 'act_rl_a' AND date = '2020-02-01'),
  70::numeric,
  'upsert updates the day total (70 from rl_a1 plus 0 from rl_a2)'
);

-- Plain update.
UPDATE public.creative_daily_metrics SET spend = 10 WHERE ad_id = 'rl_a2' AND date = '2020-02-01';
SELECT is(
  (SELECT spend FROM public.creative_daily_rollup WHERE account_id = 'act_rl_a' AND date = '2020-02-01'),
  80::numeric,
  'update changes the day total'
);
SELECT is(
  (SELECT first_date FROM public.creative_ad_spend_span WHERE ad_id = 'rl_a2'),
  '2020-02-01'::date,
  'an ad that starts spending gets a span'
);

-- Delete: totals shrink, and a day with no raw rows left disappears.
DELETE FROM public.creative_daily_metrics WHERE ad_id = 'rl_a3';
SELECT is(
  (SELECT count(*)::int FROM public.creative_daily_rollup WHERE account_id = 'act_rl_a' AND date = '2020-03-15'),
  0,
  'delete removes a rollup day that has no raw rows left'
);

-- Re-add it and a spend gap for ad rl_a1 (spend on 02-01/02-02 and 03-20, nothing between).
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency)
VALUES ('rl_a1', 'act_rl_a', '2020-03-20', 100, 5, 1, 0, 0, 0, 0, 1);

SELECT diag('DIAG role=' || current_user || ' rollup=' || (SELECT count(*) FROM public.creative_daily_rollup WHERE account_id LIKE 'act_rl_%')
  || ' spans=' || (SELECT count(*) FROM public.creative_ad_spend_span WHERE ad_id LIKE 'rl_%')
  || ' a1=' || coalesce((SELECT first_date::text || '..' || last_date::text FROM public.creative_ad_spend_span WHERE ad_id = 'rl_a1'), 'none')
  || ' a2=' || coalesce((SELECT first_date::text || '..' || last_date::text FROM public.creative_ad_spend_span WHERE ad_id = 'rl_a2'), 'none')
  || ' a3=' || coalesce((SELECT first_date::text || '..' || last_date::text FROM public.creative_ad_spend_span WHERE ad_id = 'rl_a3'), 'none')
  || ' tbl_owner=' || (SELECT tableowner FROM pg_tables WHERE tablename = 'creative_ad_spend_span')
  || ' bypassrls=' || (SELECT rolbypassrls::text FROM pg_roles WHERE rolname = current_user));

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

-- Whole-range sums equal the raw sums.
SELECT results_eq(
  $$SELECT total_spend, total_impressions, total_clicks, total_purchases, total_purchase_value,
           total_adds_to_cart, total_video_views
      FROM public.get_period_metrics('act_rl_a', '2020-01-01', '2020-12-31')$$,
  $$SELECT COALESCE(SUM(spend),0)::numeric, COALESCE(SUM(impressions),0)::bigint, COALESCE(SUM(clicks),0)::bigint,
           COALESCE(SUM(purchases),0)::bigint, COALESCE(SUM(purchase_value),0)::numeric,
           COALESCE(SUM(adds_to_cart),0)::bigint, COALESCE(SUM(video_views),0)::bigint
      FROM public.creative_daily_metrics WHERE account_id = 'act_rl_a'$$,
  'one account, whole year: rollup sums equal the raw sums'
);

SELECT results_eq(
  $$SELECT total_spend, active_count FROM public.get_period_metrics(NULL, '2020-02-01', '2020-02-28')$$,
  $$VALUES (260::numeric, 3::bigint)$$,
  'all accounts, February: spend across accounts, active ads a1, a2 and b1'
);

SELECT is(
  (SELECT active_count FROM public.get_period_metrics('act_rl_a', '2020-03-01', '2020-03-31')),
  2::bigint,
  'March: rl_a1 (spend on 03-20) plus rl_a3, whose rows were deleted but whose span stays (documented overcount)'
);

-- Known limit: an ad whose spend span covers the range but has no spend inside it counts as active.
SELECT is(
  (SELECT active_count FROM public.get_period_metrics('act_rl_a', '2020-02-10', '2020-03-10')),
  1::bigint,
  'documented overcount: rl_a1 spent before and after the range, so its span overlaps it'
);

SELECT results_eq(
  $$SELECT total_spend, total_impressions, active_count FROM public.get_period_metrics('act_rl_a', '2019-01-01', '2019-01-31')$$,
  $$VALUES (0::numeric, 0::bigint, 0::bigint)$$,
  'empty range returns one row of zeros'
);

-- Caller gate.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000bb"}';

SELECT throws_ok(
  $$SELECT * FROM public.get_period_metrics('act_rl_a', '2020-02-01', '2020-02-28')$$,
  '42501', NULL, 'a user without access to the account is refused'
);
SELECT throws_ok(
  $$SELECT * FROM public.get_period_metrics(NULL, '2020-02-01', '2020-02-28')$$,
  '42501', NULL, 'a user without a staff role cannot ask for all accounts'
);
SELECT throws_ok(
  $$SELECT * FROM public.creative_daily_rollup$$,
  '42501', NULL, 'browser roles cannot read the rollup table directly'
);
SELECT throws_ok(
  $$SELECT * FROM public.creative_ad_spend_span$$,
  '42501', NULL, 'browser roles cannot read the span table directly'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
