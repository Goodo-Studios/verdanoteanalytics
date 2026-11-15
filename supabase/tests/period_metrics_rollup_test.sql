-- get_period_metrics rollup (migration 20261215110001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks that the triggers keep creative_daily_rollup and creative_ad_spend_span in step with
-- creative_daily_metrics (insert, upsert, update, delete), that get_period_metrics answers the
-- same numbers as the raw rows, the active count (including a spend gap), the caller gate, and
-- that the two new tables are closed to browser roles. All rows are made up, dates in 2020.

BEGIN;
SELECT plan(20);

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

-- Delete: the deleted rows are subtracted; a day with nothing left is a row of zeros.
DELETE FROM public.creative_daily_metrics WHERE ad_id = 'rl_a3';
SELECT is(
  (SELECT spend FROM public.creative_daily_rollup WHERE account_id = 'act_rl_a' AND date = '2020-03-15'),
  0::numeric,
  'delete subtracts the removed rows (the day is left at zero)'
);

-- A move: an update that changes the day and the account carries the numbers with it.
UPDATE public.creative_daily_metrics SET date = '2020-02-03', account_id = 'act_rl_b' WHERE ad_id = 'rl_b1';
SELECT results_eq(
  $$SELECT account_id, date, spend FROM public.creative_daily_rollup
     WHERE account_id = 'act_rl_b' AND date IN ('2020-02-01', '2020-02-03') ORDER BY date$$,
  $$VALUES ('act_rl_b'::text, '2020-02-01'::date, 0::numeric), ('act_rl_b', '2020-02-03', 80)$$,
  'moving a row to another day subtracts it from the old day and adds it to the new one'
);
UPDATE public.creative_daily_metrics SET date = '2020-02-01', account_id = 'act_rl_b' WHERE ad_id = 'rl_b1';

-- Re-add it and a spend gap for ad rl_a1 (spend on 02-01/02-02 and 03-20, nothing between).
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency)
VALUES ('rl_a1', 'act_rl_a', '2020-03-20', 100, 5, 1, 0, 0, 0, 0, 1);

-- The rollup equals the raw rows after all of the above (zero rows left behind are ignored).
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT account_id, date, sum(spend) s, sum(impressions) i, sum(clicks) c, sum(purchases) p,
            sum(purchase_value) pv, sum(adds_to_cart) a, sum(video_views) v
       FROM public.creative_daily_metrics WHERE account_id LIKE 'act_rl_%' GROUP BY account_id, date
     EXCEPT
     SELECT account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views
       FROM public.creative_daily_rollup WHERE account_id LIKE 'act_rl_%'
   ) x),
  0,
  'every raw account-day has a matching rollup row after inserts, upserts, updates, a move and a delete'
);

-- Ordered upserts (migration 20261215140001): the trigger functions sort the aggregate before the
-- INSERT ... ON CONFLICT so concurrent batches lock rollup rows in one fixed order (no 40P01).
SELECT ok(
  pg_get_functiondef('public.creative_daily_metrics_rollup_insert()'::regprocedure) LIKE '%ORDER BY g.account_id, g.date%'
  AND pg_get_functiondef('public.creative_daily_metrics_rollup_update()'::regprocedure) LIKE '%ORDER BY g.account_id, g.date%'
  AND pg_get_functiondef('public.creative_daily_metrics_rollup_delete()'::regprocedure) LIKE '%FOR UPDATE OF r%'
  AND pg_get_functiondef('public.widen_creative_ad_spend_span(text[], text[], date[])'::regprocedure) LIKE '%ORDER BY g.ad_id%',
  'rollup and span trigger functions sort their aggregates before upserting'
);

-- A multi-account, multi-day batch given in reverse key order still lands exactly (sums and spans).
-- Uses its own accounts and ads in April so the period checks below are unaffected.
INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES
  ('act_rl_c', 'RL C', now()), ('act_rl_d', 'RL D', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name, ad_type, hook, spend, purchases, purchase_value) VALUES
  ('rl_c1', 'act_rl_c', 'RLC1', 'Image', 'H1', 0, 0, 0),
  ('rl_c2', 'act_rl_c', 'RLC2', 'Image', 'H2', 0, 0, 0),
  ('rl_d1', 'act_rl_d', 'RLD1', 'Image', 'H1', 0, 0, 0);
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency)
VALUES
  ('rl_d1', 'act_rl_d', '2020-04-02', 10, 4, 1, 1, 8, 0, 0, 1),
  ('rl_c1', 'act_rl_c', '2020-04-02', 20, 6, 2, 0, 0, 0, 0, 1),
  ('rl_c2', 'act_rl_c', '2020-04-01', 30, 7, 3, 1, 9, 0, 0, 1),
  ('rl_c1', 'act_rl_c', '2020-04-01', 40, 8, 4, 1, 11, 0, 0, 1);
UPDATE public.creative_daily_metrics SET spend = spend + 1, impressions = impressions + 1
 WHERE account_id IN ('act_rl_c', 'act_rl_d');
DELETE FROM public.creative_daily_metrics WHERE ad_id = 'rl_c2' AND date = '2020-04-01';

SELECT results_eq(
  $$SELECT account_id, date, spend, impressions, purchases FROM public.creative_daily_rollup
     WHERE account_id IN ('act_rl_c', 'act_rl_d') ORDER BY account_id, date$$,
  $$VALUES ('act_rl_c'::text, '2020-04-01'::date, 9::numeric, 41::bigint, 1::bigint),
           ('act_rl_c', '2020-04-02', 7, 21, 0),
           ('act_rl_d', '2020-04-02', 5, 11, 1)$$,
  'a reverse-ordered batch insert, update and delete leave exact day totals'
);
SELECT results_eq(
  $$SELECT ad_id, first_date, last_date FROM public.creative_ad_spend_span
     WHERE ad_id IN ('rl_c1', 'rl_c2', 'rl_d1') ORDER BY ad_id$$,
  $$VALUES ('rl_c1'::text, '2020-04-01'::date, '2020-04-02'::date),
           ('rl_c2', '2020-04-01', '2020-04-01'),
           ('rl_d1', '2020-04-02', '2020-04-02')$$,
  'spans come out right through the ordered span upsert'
);

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
