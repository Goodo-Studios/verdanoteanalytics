-- get_period_metrics (migration 20261215100001): per-ad hash aggregate instead of COUNT(DISTINCT).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Hand-computed expectations on made-up 2020 rows: sums, the active ad count (an ad counts once
-- however many days it has, and only if some day has spend > 0), account scoping, date scoping,
-- the empty-range answer, the caller gate, and that the function keeps its fixed search_path.

BEGIN;
SELECT plan(9);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES
  ('act_pm_a', 'PM A', now()), ('act_pm_b', 'PM B', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name, ad_type, hook, spend, purchases, purchase_value) VALUES
  ('pm_a1', 'act_pm_a', 'PMA1', 'Image', 'H1', 0, 0, 0),
  ('pm_a2', 'act_pm_a', 'PMA2', 'Video', 'H2', 0, 0, 0),
  ('pm_a3', 'act_pm_a', 'PMA3', 'Video', 'H3', 0, 0, 0),
  ('pm_b1', 'act_pm_b', 'PMB1', 'Static', 'H1', 0, 0, 0);
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency) VALUES
  ('pm_a1', 'act_pm_a', '2020-02-01', 1000, 50, 20, 2, 120, 5, 10, 1),
  ('pm_a1', 'act_pm_a', '2020-02-02', 3000, 100, 30, 3, 300, 6, 20, 1),
  ('pm_a2', 'act_pm_a', '2020-02-01', 500, 0, 0, 0, 0, 0, 0, 1),
  ('pm_a2', 'act_pm_a', '2020-02-02', 700, 0, 1, 0, 0, 0, 5, 1),
  ('pm_a3', 'act_pm_a', '2020-03-15', 9999, 9999, 1, 1, 1, 1, 1, 1),
  ('pm_b1', 'act_pm_b', '2020-02-01', 800, 80, 8, 4, 160, 2, 3, 1);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

-- Account A, February: a1 (two days, spend) active; a2 (no spend) not active; a3 outside the range.
SELECT results_eq(
  $$SELECT total_spend, total_impressions, total_clicks, total_purchases, total_purchase_value,
           total_adds_to_cart, total_video_views, active_count
      FROM public.get_period_metrics('act_pm_a', '2020-02-01', '2020-02-28')$$,
  $$VALUES (150::numeric, 5200::bigint, 51::bigint, 5::bigint, 420::numeric, 11::bigint, 35::bigint, 1::bigint)$$,
  'one account, one month: sums and active count match hand-computed values'
);

-- An ad with several spending days counts once.
SELECT is(
  (SELECT active_count FROM public.get_period_metrics('act_pm_a', '2020-02-01', '2020-02-02')),
  1::bigint,
  'an ad with two spending days is counted once'
);

-- All accounts (no account), February: a1 and b1 are active.
SELECT results_eq(
  $$SELECT total_spend, active_count FROM public.get_period_metrics(NULL, '2020-02-01', '2020-02-28')$$,
  $$VALUES (230::numeric, 2::bigint)$$,
  'all accounts: spend and active count span both accounts'
);

-- Whole range including March: a3 joins the active count.
SELECT results_eq(
  $$SELECT total_spend, active_count FROM public.get_period_metrics(NULL, '2020-01-01', '2020-12-31')$$,
  $$VALUES (10229::numeric, 3::bigint)$$,
  'wider range picks up the March ad'
);

-- Open-ended dates behave as before (NULL means no bound).
SELECT is(
  (SELECT total_spend FROM public.get_period_metrics('act_pm_b', NULL, NULL)),
  80::numeric,
  'NULL dates mean no date bound'
);

-- Empty range: one row of zeros.
SELECT results_eq(
  $$SELECT total_spend, total_impressions, active_count FROM public.get_period_metrics('act_pm_a', '2019-01-01', '2019-01-31')$$,
  $$VALUES (0::numeric, 0::bigint, 0::bigint)$$,
  'empty range returns one row of zeros'
);

-- Caller gate: a signed-in user with no staff role and no access to the account is refused.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000aa"}';

SELECT throws_ok(
  $$SELECT * FROM public.get_period_metrics('act_pm_a', '2020-02-01', '2020-02-28')$$,
  '42501',
  NULL,
  'a user without access to the account is refused'
);

SELECT throws_ok(
  $$SELECT * FROM public.get_period_metrics(NULL, '2020-02-01', '2020-02-28')$$,
  '42501',
  NULL,
  'a user without a staff role cannot ask for all accounts'
);

RESET ROLE;

SELECT ok(
  coalesce(
    (SELECT 'search_path=""' = ANY (p.proconfig) OR 'search_path=' = ANY (p.proconfig)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_period_metrics'),
    false
  ),
  'get_period_metrics keeps an empty search_path'
);

SELECT * FROM finish();
ROLLBACK;
