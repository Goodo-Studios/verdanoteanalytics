-- pgTAP test for audit plan item 5.10 (cluster restamp in one step).
--
-- cluster-creatives cleared every creative's cluster stamp for the account, then
-- re-stamped group by group. A failure part way left the account partly or fully
-- unclustered. restamp_creative_clusters(account, stamps) does the clear and the
-- re-stamp in one statement-level transaction, so it lands whole or not at all.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(9);

SELECT has_function('public', 'restamp_creative_clusters', ARRAY['text', 'jsonb'],
  'restamp_creative_clusters(text, jsonb) exists');

SELECT ok(NOT has_function_privilege('authenticated', 'public.restamp_creative_clusters(text, jsonb)', 'EXECUTE'),
  'signed-in users cannot call it');
SELECT ok(NOT has_function_privilege('anon', 'public.restamp_creative_clusters(text, jsonb)', 'EXECUTE'),
  'anon cannot call it');
SELECT ok(has_function_privilege('service_role', 'public.restamp_creative_clusters(text, jsonb)', 'EXECUTE'),
  'service role can call it');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_pgtap_restamp', 'pgTAP restamp'), ('act_pgtap_other', 'other');
INSERT INTO public.creatives (ad_id, account_id, ad_name, tag_source, cluster_id, cluster_confidence) VALUES
  ('rs_1', 'act_pgtap_restamp', 'a', 'parsed', '00000000-0000-0000-0000-0000000000a1', 'probable'),
  ('rs_2', 'act_pgtap_restamp', 'b', 'parsed', '00000000-0000-0000-0000-0000000000a1', 'probable'),
  ('rs_3', 'act_pgtap_restamp', 'c', 'parsed', '00000000-0000-0000-0000-0000000000a2', 'visual_only'),
  ('rs_x', 'act_pgtap_other',   'x', 'parsed', '00000000-0000-0000-0000-0000000000f1', 'exact');

SELECT is(
  public.restamp_creative_clusters('act_pgtap_restamp', '[
    {"ad_id":"rs_1","cluster_id":"00000000-0000-0000-0000-0000000000b1","confidence":"exact"},
    {"ad_id":"rs_2","cluster_id":"00000000-0000-0000-0000-0000000000b1","confidence":"exact"},
    {"ad_id":"rs_x","cluster_id":"00000000-0000-0000-0000-0000000000b1","confidence":"exact"}
  ]'::jsonb),
  2, 'returns the number of creatives stamped');

SELECT results_eq(
  $$ SELECT ad_id, cluster_id::text, cluster_confidence FROM public.creatives
       WHERE account_id = 'act_pgtap_restamp' ORDER BY ad_id $$,
  $$ VALUES ('rs_1', '00000000-0000-0000-0000-0000000000b1', 'exact'),
            ('rs_2', '00000000-0000-0000-0000-0000000000b1', 'exact'),
            ('rs_3', NULL, NULL) $$,
  'members get the new stamp and creatives not in any group are cleared');

SELECT results_eq(
  $$ SELECT cluster_id::text FROM public.creatives WHERE ad_id = 'rs_x' $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000000f1') $$,
  'another account is untouched, even if its ad id is passed in');

-- A bad stamp (confidence the check constraint rejects) fails the whole call, and the
-- earlier stamps stay as they were.
SELECT throws_ok(
  $$ SELECT public.restamp_creative_clusters('act_pgtap_restamp', '[
       {"ad_id":"rs_1","cluster_id":"00000000-0000-0000-0000-0000000000c1","confidence":"bogus"}
     ]'::jsonb) $$,
  '23514', NULL, 'an invalid stamp raises');

SELECT results_eq(
  $$ SELECT ad_id, cluster_id::text FROM public.creatives
       WHERE account_id = 'act_pgtap_restamp' AND cluster_id IS NOT NULL ORDER BY ad_id $$,
  $$ VALUES ('rs_1', '00000000-0000-0000-0000-0000000000b1'),
            ('rs_2', '00000000-0000-0000-0000-0000000000b1') $$,
  'after a failed call the previous stamps are still there');

SELECT * FROM finish();
ROLLBACK;
