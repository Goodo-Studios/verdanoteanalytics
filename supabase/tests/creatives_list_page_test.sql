-- creatives_list_page (migration 20261207090004): the one-statement page behind GET /creatives.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks the date-range path against hand-computed sums and weighted rates, the tenant scope
-- (allowed ids), the all-accounts case (no account picked), filters, paging and total, the
-- empty-range answer, the lifetime path (no dates), and that only service_role can execute it.
-- All rows are made up and use dates in 2020.

BEGIN;
SELECT plan(17);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES
  ('act_clp_a', 'CLP A', now()), ('act_clp_b', 'CLP B', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name, ad_type, hook, spend, purchases, purchase_value) VALUES
  ('clp_a1', 'act_clp_a', 'CLPA1_one', 'Image', 'H1', 999, 9, 900),
  ('clp_a2', 'act_clp_a', 'CLPA2_two', 'Video', 'H2', 5, 0, 0),
  ('clp_b1', 'act_clp_b', 'CLPB1_three', 'Static', 'H1', 7, 1, 14);
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value, frequency) VALUES
  ('clp_a1', 'act_clp_a', '2020-02-01', 1000, 50, 20, 2, 120, 2),
  ('clp_a1', 'act_clp_a', '2020-02-02', 3000, 100, 30, 3, 300, 4),
  ('clp_a1', 'act_clp_a', '2020-03-15', 9999, 9999, 1, 1, 1, 1),
  ('clp_a2', 'act_clp_a', '2020-02-01', 500, 10, 0, 0, 0, 0),
  ('clp_b1', 'act_clp_b', '2020-02-01', 800, 80, 8, 4, 160, 0);

-- ---------------------------------------------------------------- grants (1-3)
SELECT ok(has_function_privilege('service_role',
  'public.creatives_list_page(text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer)', 'EXECUTE'),
  'service_role can execute creatives_list_page');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.creatives_list_page(text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer)', 'EXECUTE'),
  'authenticated cannot execute creatives_list_page');
SELECT ok(NOT has_function_privilege('anon',
  'public.creatives_list_page(text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer)', 'EXECUTE'),
  'anon cannot execute creatives_list_page');

-- ---------------------------------------------------------------- date range, one account (4-8)
-- a1 over Feb 1-2: spend 150, impressions 4000, clicks 50, purchases 5, value 420,
-- frequency = (2*1000 + 4*3000) / 4000 = 3.5; a2: spend 10. The March row is out of range.
CREATE TEMP TABLE r1 AS SELECT public.creatives_list_page(
  p_allowed_ids := NULL, p_account_id := 'act_clp_a', p_date_from := '2020-02-01', p_date_to := '2020-02-28') AS j;
SELECT is((SELECT (j->>'total')::int FROM r1), 2, 'one account: both ads with delivery in range are counted');
SELECT is((SELECT (j->'data'->0->>'ad_id') FROM r1), 'clp_a1', 'one account: highest spend first');
SELECT is((SELECT (j->'data'->0->>'spend')::numeric FROM r1), 150::numeric, 'one account: spend is summed over the range only');
SELECT is((SELECT (j->'data'->0->>'frequency')::numeric FROM r1), 3.5::numeric, 'one account: frequency is impression weighted');
SELECT ok((SELECT (j->'data'->0->>'roas')::numeric = 2.8 AND (j->'data'->0->>'cpa')::numeric = 30 AND (j->'data'->0->>'ctr')::numeric = 1.25 FROM r1),
  'one account: roas, cpa and ctr are derived from the sums');

-- ---------------------------------------------------------------- all accounts and tenant scope (9-11)
-- No account picked and no restriction (staff): all three ads. Aggregates are spend weighted:
-- spend 240, purchases 9, value 580.
CREATE TEMP TABLE r2 AS SELECT public.creatives_list_page(
  p_date_from := '2020-02-01', p_date_to := '2020-02-28') AS j;
SELECT is((SELECT (j->>'total')::int FROM r2), 3, 'all accounts: ads from every account are listed');
SELECT ok((SELECT (j->'aggregates'->>'total_spend')::numeric = 240
              AND round((j->'aggregates'->>'avg_roas')::numeric, 4) = round(580.0 / 240, 4)
              AND round((j->'aggregates'->>'avg_cpa')::numeric, 4) = round(240.0 / 9, 4) FROM r2),
  'all accounts: aggregates are spend weighted over the whole set');
SELECT is((SELECT (public.creatives_list_page(
              p_allowed_ids := ARRAY['act_clp_b'], p_date_from := '2020-02-01', p_date_to := '2020-02-28')->>'total')::int), 1,
  'a restricted caller sees only its own accounts even with no account picked');

-- ---------------------------------------------------------------- filters, paging, empty (12-14)
SELECT is((SELECT (public.creatives_list_page(
              p_date_from := '2020-02-01', p_date_to := '2020-02-28', p_ad_types := ARRAY['Static', 'Image', 'Photo'])->>'total')::int), 2,
  'Static filter also matches legacy Image rows');
SELECT is((SELECT jsonb_array_length(public.creatives_list_page(
              p_date_from := '2020-02-01', p_date_to := '2020-02-28', p_limit := 1, p_offset := 1)->'data')), 1,
  'limit and offset return one row while total stays the full count');
SELECT is((SELECT public.creatives_list_page(p_date_from := '2021-01-01', p_date_to := '2021-01-31')->>'no_daily_data'), 'true',
  'a range with no daily rows answers no_daily_data with an empty list');

-- ---------------------------------------------------------------- lifetime path, no dates (15-17)
SELECT is((SELECT (public.creatives_list_page(p_account_id := 'act_clp_a')->'data'->0->>'ad_id')), 'clp_a1',
  'no dates: ordered by lifetime spend');
SELECT is((SELECT (public.creatives_list_page(p_account_id := 'act_clp_a')->>'total')::int), 2,
  'no dates: total counts the account''s creatives');
SELECT is((SELECT (public.creatives_list_page(p_account_id := 'act_clp_a')->'aggregates'->>'total_spend')::numeric), 1004::numeric,
  'no dates: aggregates use the stored lifetime spend');

SELECT * FROM finish();
ROLLBACK;
