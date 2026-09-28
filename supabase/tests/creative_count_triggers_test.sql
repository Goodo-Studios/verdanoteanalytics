-- pgTAP regression test for the 2026-09-28 Cattasaurus rollup timeout.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The per-row trg_refresh_account_creative_counts recounted the account and
-- rewrote its ad_accounts row once per updated creative, so the Phase 5 rollup
-- (one UPDATE over every creative in the account) timed out on large accounts.
-- These tests pin the statement-level replacement:
--   1. the per-row trigger is gone and the three statement-level triggers exist,
--   2. INSERT, tag_source UPDATE, and DELETE still keep counts correct,
--   3. a metric-only UPDATE (what the rollup does) leaves ad_accounts untouched.

BEGIN;
SELECT plan(9);

SELECT hasnt_trigger('public', 'creatives', 'trg_refresh_account_creative_counts',
  'per-row creative-count trigger is removed');
SELECT has_trigger('public', 'creatives', 'trg_refresh_account_creative_counts_ins',
  'statement-level INSERT trigger exists');
SELECT has_trigger('public', 'creatives', 'trg_refresh_account_creative_counts_upd',
  'statement-level UPDATE trigger exists');
SELECT has_trigger('public', 'creatives', 'trg_refresh_account_creative_counts_del',
  'statement-level DELETE trigger exists');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_pgtap_counts', 'pgTAP counts');

INSERT INTO public.creatives (ad_id, account_id, ad_name, tag_source)
SELECT 'pgtap_ad_' || g, 'act_pgtap_counts', 'ad ' || g,
       CASE WHEN g <= 3 THEN 'untagged' ELSE 'parsed' END
FROM generate_series(1, 5) g;

SELECT results_eq(
  $$ SELECT creative_count, untagged_count FROM public.ad_accounts WHERE id = 'act_pgtap_counts' $$,
  $$ VALUES (5, 3) $$,
  'bulk INSERT sets creative_count and untagged_count');

UPDATE public.creatives SET tag_source = 'manual'
WHERE ad_id IN ('pgtap_ad_1', 'pgtap_ad_2');

SELECT results_eq(
  $$ SELECT creative_count, untagged_count FROM public.ad_accounts WHERE id = 'act_pgtap_counts' $$,
  $$ VALUES (5, 1) $$,
  'tag_source UPDATE refreshes untagged_count');

-- Metric-only update, like rollup_creatives_from_daily: counts don't change,
-- so the ad_accounts row must not be rewritten (xmin stays the same).
CREATE TEMP TABLE pgtap_xmin AS
  SELECT xmin::text AS x FROM public.ad_accounts WHERE id = 'act_pgtap_counts';

UPDATE public.creatives SET spend = 100, impressions = 1000
WHERE account_id = 'act_pgtap_counts';

SELECT results_eq(
  $$ SELECT xmin::text FROM public.ad_accounts WHERE id = 'act_pgtap_counts' $$,
  $$ SELECT x FROM pgtap_xmin $$,
  'metric-only UPDATE does not rewrite the ad_accounts row');

SELECT results_eq(
  $$ SELECT creative_count, untagged_count FROM public.ad_accounts WHERE id = 'act_pgtap_counts' $$,
  $$ VALUES (5, 1) $$,
  'metric-only UPDATE leaves counts unchanged');

DELETE FROM public.creatives WHERE ad_id IN ('pgtap_ad_3', 'pgtap_ad_4');

SELECT results_eq(
  $$ SELECT creative_count, untagged_count FROM public.ad_accounts WHERE id = 'act_pgtap_counts' $$,
  $$ VALUES (3, 0) $$,
  'bulk DELETE refreshes counts');

SELECT * FROM finish();
ROLLBACK;
