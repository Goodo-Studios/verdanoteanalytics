-- creatives_list_page sorts the whole filtered set before paging (audit plan item 7.1, part 1).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The list always came back ordered by spend, and the Creatives page re-sorted only the 100
-- rows it had loaded. 105 made-up ads are inserted: spend falls from ad 001 to ad 105, and
-- ad 105 (lowest spend, so off the first page) has by far the best ROAS. Sorting by ROAS
-- must bring it to the top of page one, in both the date-range path and the lifetime path.
-- All rows are made up and use dates in 2020.

BEGIN;
SELECT plan(9);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_cls', 'CLS', now());

INSERT INTO public.creatives (ad_id, account_id, ad_name, spend, purchases, purchase_value, roas, cpa)
SELECT 'cls_' || lpad(i::text, 3, '0'), 'act_cls', 'Ad ' || lpad((106 - i)::text, 3, '0'),
       1000 - i, 1, CASE WHEN i = 105 THEN 50000 ELSE 1000 - i END,
       CASE WHEN i = 105 THEN 50000.0 / (1000 - i) ELSE 1 END,
       1000 - i
  FROM generate_series(1, 105) AS i;

INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, clicks, purchases, purchase_value)
SELECT 'cls_' || lpad(i::text, 3, '0'), 'act_cls', '2020-04-01', 1000, 1000 - i, 10, 1,
       CASE WHEN i = 105 THEN 50000 ELSE 1000 - i END
  FROM generate_series(1, 105) AS i;

-- ---------------------------------------------------------------- date-range path (1-5)
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_date_from := '2020-04-01', p_date_to := '2020-04-30',
            p_sort := 'roas', p_sort_dir := 'desc')->'data'->0->>'ad_id'), 'cls_105',
  'dates, roas desc: the best ROAS ad tops page one even though its spend is lowest');
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_date_from := '2020-04-01', p_date_to := '2020-04-30',
            p_sort := 'spend', p_sort_dir := 'asc')->'data'->0->>'ad_id'), 'cls_105',
  'dates, spend asc: the lowest spend ad comes first');
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_date_from := '2020-04-01', p_date_to := '2020-04-30',
            p_sort := 'ad_name', p_sort_dir := 'asc')->'data'->0->>'ad_name'), 'Ad 001',
  'dates, ad_name asc: alphabetical over the whole set (Ad 001 is ad 105)');
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_date_from := '2020-04-01', p_date_to := '2020-04-30',
            p_sort := 'roas', p_sort_dir := 'desc', p_limit := 100, p_offset := 100)->'data'->0->>'ad_id'), 'cls_001',
  'dates, roas desc, page two continues the same order (ties broken by ad_id)');
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_date_from := '2020-04-01', p_date_to := '2020-04-30',
            p_sort := 'spend; drop table x', p_sort_dir := 'sideways')->'data'->0->>'ad_id'), 'cls_001',
  'dates: an unknown sort key falls back to spend, highest first');

-- ---------------------------------------------------------------- lifetime path (6-8)
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_sort := 'roas', p_sort_dir := 'desc')->'data'->0->>'ad_id'), 'cls_105',
  'no dates, roas desc: the best lifetime ROAS ad tops page one');
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_sort := 'cpa', p_sort_dir := 'asc')->'data'->0->>'ad_id'), 'cls_105',
  'no dates, cpa asc: the cheapest lifetime cost per result comes first');
SELECT is((public.creatives_list_page(p_account_id := 'act_cls')->'data'->0->>'ad_id'), 'cls_001',
  'no dates, no sort given: still highest lifetime spend first');

-- ---------------------------------------------------------------- total unchanged (9)
SELECT is((public.creatives_list_page(
            p_account_id := 'act_cls', p_sort := 'roas')->>'total')::int, 105,
  'sorting does not change the total');

SELECT * FROM finish();
ROLLBACK;
