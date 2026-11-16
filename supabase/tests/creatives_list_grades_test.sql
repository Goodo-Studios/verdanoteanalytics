-- creatives_list_page grades over the whole filtered set (audit plan item 7.1, part 2).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The Creatives page graded the 100 rows it had loaded, so an ad's grade depended on which
-- page it was on. The function now returns grade and spend_percentile for every row, worked
-- out over the whole filtered set within each account. Fixture: 150 made-up ads in account
-- A with spend 1..150 (ad 150 has the most), 10 in account B, and one ad with no spend.
-- All rows are made up and use dates in 2020.

BEGIN;
SELECT plan(10);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES
  ('act_clg_a', 'CLG A', now()), ('act_clg_b', 'CLG B', now());

INSERT INTO public.creatives (ad_id, account_id, ad_name, spend)
SELECT 'clg_a' || lpad(i::text, 3, '0'), 'act_clg_a', 'A ' || i, i FROM generate_series(1, 150) AS i;
INSERT INTO public.creatives (ad_id, account_id, ad_name, spend)
SELECT 'clg_b' || lpad(i::text, 3, '0'), 'act_clg_b', 'B ' || i, i * 1000 FROM generate_series(1, 10) AS i;
INSERT INTO public.creatives (ad_id, account_id, ad_name, spend) VALUES ('clg_a000', 'act_clg_a', 'A zero', 0);

INSERT INTO public.creative_daily_metrics (ad_id, account_id, date, impressions, spend)
SELECT ad_id, account_id, '2020-05-01', 100, spend FROM public.creatives WHERE ad_id LIKE 'clg_%';

CREATE TEMP TABLE g AS
SELECT d AS row
  FROM jsonb_array_elements((public.creatives_list_page(
         p_account_id := 'act_clg_a', p_date_from := '2020-05-01', p_date_to := '2020-05-31',
         p_limit := 500))->'data') AS d;

-- ---------------------------------------------------------------- date range, whole set (1-5)
-- Ad 150: 149 of 150 spending ads spend less, 99.3 -> A. Ad 1: none less -> F.
-- Ad 61: 60 of 150 less = 40 -> C. Ad 60: 59 of 150 = 39.3 -> D.
SELECT is((SELECT row->>'grade' FROM g WHERE row->>'ad_id' = 'clg_a150'), 'A', 'dates: the top spender is an A');
SELECT is((SELECT row->>'grade' FROM g WHERE row->>'ad_id' = 'clg_a001'), 'F', 'dates: the lowest spender is an F');
SELECT is((SELECT row->>'grade' FROM g WHERE row->>'ad_id' = 'clg_a061'), 'C', 'dates: 40th percentile is a C');
SELECT is((SELECT row->>'grade' FROM g WHERE row->>'ad_id' = 'clg_a060'), 'D', 'dates: just under the 40th percentile is a D');
SELECT ok((SELECT row->'grade' = 'null'::jsonb FROM g WHERE row->>'ad_id' = 'clg_a000'), 'dates: an ad with no spend has no grade');

-- ---------------------------------------------------------------- same grade on every page (6-7)
-- Ad 50 sits on page two when sorted by spend. Its grade must match the one-page answer (33 -> D).
SELECT is((SELECT d->>'grade'
             FROM jsonb_array_elements((public.creatives_list_page(
                    p_account_id := 'act_clg_a', p_date_from := '2020-05-01', p_date_to := '2020-05-31',
                    p_limit := 100, p_offset := 100))->'data') AS d
            WHERE d->>'ad_id' = 'clg_a050'), 'D',
  'dates: an ad on page two keeps its whole-set grade');
SELECT is((SELECT (d->>'spend_percentile')::int
             FROM jsonb_array_elements((public.creatives_list_page(
                    p_account_id := 'act_clg_a', p_limit := 100, p_offset := 100))->'data') AS d
            WHERE d->>'ad_id' = 'clg_a050'), 33,
  'no dates: an ad on page two keeps its whole-set spend percentile');

-- ---------------------------------------------------------------- per account in all-accounts view (8)
-- Account B's lowest spender (1,000) outspends every A ad but is still an F within its own account.
SELECT is((SELECT d->>'grade'
             FROM jsonb_array_elements((public.creatives_list_page(
                    p_date_from := '2020-05-01', p_date_to := '2020-05-31', p_limit := 500))->'data') AS d
            WHERE d->>'ad_id' = 'clg_b001'), 'F',
  'all accounts: grades are worked out within each account');

-- ---------------------------------------------------------------- grade sort (9-10)
SELECT is((public.creatives_list_page(
            p_account_id := 'act_clg_a', p_sort := 'grade', p_sort_dir := 'desc')->'data'->0->>'ad_id'), 'clg_a000',
  'grade desc: the ungraded ad comes first in reverse order');
SELECT is((public.creatives_list_page(
            p_account_id := 'act_clg_a', p_date_from := '2020-05-01', p_date_to := '2020-05-31',
            p_sort := 'grade', p_sort_dir := 'asc', p_limit := 100, p_offset := 100)->'data'->0->>'grade'), 'D',
  'grade asc: page two continues from the whole-set order (30 A, 30 B, 30 C, then D)');

SELECT * FROM finish();
ROLLBACK;
