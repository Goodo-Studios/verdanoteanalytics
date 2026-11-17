-- pgTAP test for the stepped cluster restamp (audit plan item 7.3 follow-up).
--
-- restamp_creative_clusters cleared and re-stamped every member of an account in one
-- statement. On the largest accounts that ran past the API's 8 second statement limit.
-- restamp_creative_clusters_step(account, stamps, limit) changes only rows whose stamp
-- differs from the wanted set, at most `limit` of them, and returns how many still
-- differ. cluster-creatives calls it until that number is 0.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(14);

SELECT has_function('public', 'restamp_creative_clusters_step', ARRAY['text', 'jsonb', 'integer'],
  'restamp_creative_clusters_step(text, jsonb, integer) exists');

SELECT ok(NOT has_function_privilege('authenticated', 'public.restamp_creative_clusters_step(text, jsonb, integer)', 'EXECUTE'),
  'signed-in users cannot call it');
SELECT ok(NOT has_function_privilege('anon', 'public.restamp_creative_clusters_step(text, jsonb, integer)', 'EXECUTE'),
  'anon cannot call it');
SELECT ok(has_function_privilege('service_role', 'public.restamp_creative_clusters_step(text, jsonb, integer)', 'EXECUTE'),
  'service role can call it');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_pgtap_step', 'pgTAP step'), ('act_pgtap_step_other', 'other');
INSERT INTO public.creatives (ad_id, account_id, ad_name, tag_source, cluster_id, cluster_confidence) VALUES
  ('st_1', 'act_pgtap_step', 'a', 'parsed', '00000000-0000-0000-0000-0000000000a1', 'probable'),
  ('st_2', 'act_pgtap_step', 'b', 'parsed', '00000000-0000-0000-0000-0000000000a1', 'probable'),
  ('st_3', 'act_pgtap_step', 'c', 'parsed', '00000000-0000-0000-0000-0000000000a2', 'visual_only'),
  ('st_4', 'act_pgtap_step', 'd', 'parsed', '00000000-0000-0000-0000-0000000000b1', 'exact'),
  ('st_5', 'act_pgtap_step', 'e', 'parsed', NULL, NULL),
  ('st_x', 'act_pgtap_step_other', 'x', 'parsed', '00000000-0000-0000-0000-0000000000f1', 'exact');

-- Wanted: st_1, st_2 and st_4 in b1 (st_4 already is), st_3 cleared, st_5 stays clear.
-- So three rows differ: st_1, st_2, st_3. st_x belongs to another account.
CREATE TEMP TABLE wanted AS SELECT '[
  {"ad_id":"st_1","cluster_id":"00000000-0000-0000-0000-0000000000b1","confidence":"exact"},
  {"ad_id":"st_2","cluster_id":"00000000-0000-0000-0000-0000000000b1","confidence":"exact"},
  {"ad_id":"st_4","cluster_id":"00000000-0000-0000-0000-0000000000b1","confidence":"exact"},
  {"ad_id":"st_x","cluster_id":"00000000-0000-0000-0000-0000000000b1","confidence":"exact"}
]'::jsonb AS stamps;

SELECT is(public.restamp_creative_clusters_step('act_pgtap_step', (SELECT stamps FROM wanted), 2), 1,
  'first step changes two rows and reports one left');

SELECT is((SELECT count(*)::int FROM public.creatives c, wanted w
            WHERE c.account_id = 'act_pgtap_step'
              AND c.cluster_id IS DISTINCT FROM (SELECT (e->>'cluster_id')::uuid FROM jsonb_array_elements(w.stamps) e WHERE e->>'ad_id' = c.ad_id)),
  1, 'exactly one row still differs after the first step');

SELECT is(public.restamp_creative_clusters_step('act_pgtap_step', (SELECT stamps FROM wanted), 2), 0,
  'second step finishes');

SELECT results_eq(
  $$ SELECT ad_id, cluster_id::text, cluster_confidence FROM public.creatives
       WHERE account_id = 'act_pgtap_step' ORDER BY ad_id $$,
  $$ VALUES ('st_1', '00000000-0000-0000-0000-0000000000b1', 'exact'),
            ('st_2', '00000000-0000-0000-0000-0000000000b1', 'exact'),
            ('st_3', NULL, NULL),
            ('st_4', '00000000-0000-0000-0000-0000000000b1', 'exact'),
            ('st_5', NULL, NULL) $$,
  'members get the new stamp and creatives not in any group are cleared');

SELECT results_eq(
  $$ SELECT cluster_id::text FROM public.creatives WHERE ad_id = 'st_x' $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000000f1') $$,
  'another account is untouched, even if its ad id is passed in');

-- Rows that already match are not rewritten. Every UPDATE writes a new row version,
-- which moves the row's ctid, so an unchanged ctid means the row was left alone.
CREATE TEMP TABLE before_ctid AS
  SELECT ad_id, ctid::text AS t FROM public.creatives WHERE account_id = 'act_pgtap_step';
SELECT is(public.restamp_creative_clusters_step('act_pgtap_step', (SELECT stamps FROM wanted), 2), 0,
  'a step with nothing to change reports 0');
SELECT is((SELECT count(*)::int FROM public.creatives c JOIN before_ctid b USING (ad_id)
            WHERE c.ctid::text <> b.t), 0,
  'rows whose stamp already matches are not updated');

-- A bad stamp (confidence the check constraint rejects) fails the whole step, and the
-- stamps stay as they were.
SELECT throws_ok(
  $$ SELECT public.restamp_creative_clusters_step('act_pgtap_step', '[
       {"ad_id":"st_1","cluster_id":"00000000-0000-0000-0000-0000000000c1","confidence":"bogus"}
     ]'::jsonb, 10) $$,
  '23514', NULL, 'an invalid stamp raises');

SELECT results_eq(
  $$ SELECT ad_id, cluster_id::text FROM public.creatives
       WHERE account_id = 'act_pgtap_step' AND cluster_id IS NOT NULL ORDER BY ad_id $$,
  $$ VALUES ('st_1', '00000000-0000-0000-0000-0000000000b1'),
            ('st_2', '00000000-0000-0000-0000-0000000000b1'),
            ('st_4', '00000000-0000-0000-0000-0000000000b1') $$,
  'after a failed step the previous stamps are still there');

SELECT throws_ok(
  $$ SELECT public.restamp_creative_clusters_step('act_pgtap_step', '[]'::jsonb, 0) $$,
  '22023', NULL, 'a limit below 1 is rejected');

SELECT * FROM finish();
ROLLBACK;
