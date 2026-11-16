-- get_agency_dashboard_data (audit plan item 7.3, part 9): the agency dashboard in ONE row.
--
-- get_agency_dashboard_summary returns one row per (account, ad). Production has about 6,000
-- such rows for a month, and PostgREST returns at most 1,000, so whole accounts dropped out of
-- the dashboard. The new function returns a single jsonb value: one entry per account and one
-- per spending ad, so the row cap never applies.
--
-- Run with the local stack (requires Docker):  supabase test db
-- All rows are made up and use dates in 2020.

BEGIN;
SELECT plan(9);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES
  ('act_agd_a', 'AGD A', now()), ('act_agd_b', 'AGD B', now());
-- 1,200 ads in A and 300 in B; one ad in A never spends.
INSERT INTO public.creatives (ad_id, account_id, ad_name)
SELECT 'agd_a_' || i, 'act_agd_a', 'A ad ' || i FROM generate_series(1, 1200) AS i;
INSERT INTO public.creatives (ad_id, account_id, ad_name)
SELECT 'agd_b_' || i, 'act_agd_b', 'B ad ' || i FROM generate_series(1, 300) AS i;
INSERT INTO public.creatives (ad_id, account_id, ad_name) VALUES ('agd_a_zero', 'act_agd_a', 'A zero');

-- Current range 2020-08-01..2020-08-31: each ad spends 2 with value 6 on one day.
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, spend, purchase_value, impressions, frequency)
SELECT 'agd_a_' || i, 'act_agd_a', '2020-08-10', 2, 6, 100, 2 FROM generate_series(1, 1200) AS i;
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, spend, purchase_value, impressions, frequency)
SELECT 'agd_b_' || i, 'act_agd_b', '2020-08-10', 2, 6, 100, 2 FROM generate_series(1, 300) AS i;
INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, spend, purchase_value, impressions, frequency) VALUES
  ('agd_a_zero', 'act_agd_a', '2020-08-10', 0, 0, 50, 1),
  -- prior range 2020-07-01..2020-07-31
  ('agd_a_1', 'act_agd_a', '2020-07-15', 500, 0, 10, 1);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

CREATE TEMP TABLE agd AS
  SELECT public.get_agency_dashboard_data('2020-08-01', '2020-08-31', '2020-07-01', '2020-07-31') AS d;

SELECT is(
  (SELECT count(*) FROM agd, jsonb_array_elements(d->'ads') e WHERE e->>'account_id' IN ('act_agd_a', 'act_agd_b')),
  1500::bigint,
  'every spending ad is returned, past 1,000, in one value'
);
SELECT is(
  (SELECT count(*) FROM agd, jsonb_array_elements(d->'ads') e WHERE e->>'ad_id' = 'agd_a_zero'),
  0::bigint,
  'an ad with no spend in the range is not listed'
);
SELECT results_eq(
  $$SELECT (e->>'period_spend')::numeric, (e->>'period_revenue')::numeric, (e->>'active_ad_count')::bigint, (e->>'prior_spend')::numeric
      FROM agd, jsonb_array_elements(d->'accounts') e WHERE e->>'account_id' = 'act_agd_a'$$,
  $$VALUES (2400::numeric, 7200::numeric, 1200::bigint, 500::numeric)$$,
  'account A totals: spend, revenue, active ads and prior spend'
);
SELECT results_eq(
  $$SELECT (e->>'period_spend')::numeric, (e->>'active_ad_count')::bigint, (e->>'prior_spend')::numeric
      FROM agd, jsonb_array_elements(d->'accounts') e WHERE e->>'account_id' = 'act_agd_b'$$,
  $$VALUES (600::numeric, 300::bigint, 0::numeric)$$,
  'account B totals are present even though A has more than 1,000 ads'
);
SELECT results_eq(
  $$SELECT e->>'ad_name', (e->>'spend')::numeric, (e->>'purchase_value')::numeric, (e->>'impressions')::bigint,
           (e->>'frequency_weighted')::numeric, (e->>'frequency_impressions')::bigint
      FROM agd, jsonb_array_elements(d->'ads') e WHERE e->>'ad_id' = 'agd_b_7'$$,
  $$VALUES ('B ad 7'::text, 2::numeric, 6::numeric, 100::bigint, 200::numeric, 100::bigint)$$,
  'per-ad fields: name, spend, value, impressions and frequency weights'
);

RESET ROLE;
-- An authenticated user with no staff role is refused.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000ad"}';
SELECT throws_ok(
  $$SELECT public.get_agency_dashboard_data('2020-08-01', '2020-08-31', '2020-07-01', '2020-07-31')$$,
  '42501',
  NULL,
  'a non-staff user is refused'
);
RESET ROLE;

SELECT ok(has_function_privilege('authenticated', 'public.get_agency_dashboard_data(date, date, date, date)', 'EXECUTE'),
  'authenticated can execute (the staff gate is inside)');
SELECT ok(NOT has_function_privilege('anon', 'public.get_agency_dashboard_data(date, date, date, date)', 'EXECUTE'),
  'anon cannot execute');
SELECT ok(
  (SELECT 'search_path=""' = ANY (p.proconfig) OR 'search_path=' = ANY (p.proconfig)
     FROM pg_proc p WHERE p.oid = 'public.get_agency_dashboard_data(date, date, date, date)'::regprocedure),
  'fixed empty search_path'
);

SELECT * FROM finish();
ROLLBACK;
