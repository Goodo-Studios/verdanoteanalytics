-- Shared report and brief links resolve one row at a time (audit plan item 1.3, step 1).
--
-- get_public_report(id) and get_shared_brief(token) return only the row the link names, and only
-- when it is shared. The open listing policies are dropped in a later release; until then this
-- file checks the lookups themselves.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(9);

INSERT INTO public.reports (id, report_name, report_type, is_public) VALUES
  ('c1300000-0000-4000-8000-000000000001', 'Shared report', 'standard', true),
  ('c1300000-0000-4000-8000-000000000002', 'Private report', 'standard', false);
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c13', 'C13');
INSERT INTO public.briefs (id, account_id, name, share_token, is_shared) VALUES
  ('c1300000-0000-4000-8000-0000000000b1', 'act_c13', 'Shared brief', 'c13-shared-token-0000000000000001', true),
  ('c1300000-0000-4000-8000-0000000000b2', 'act_c13', 'Unshared brief', 'c13-unshared-token-00000000000002', false);

SELECT has_function('public', 'get_public_report', ARRAY['uuid'], 'get_public_report(uuid) exists');
SELECT has_function('public', 'get_shared_brief', ARRAY['text'], 'get_shared_brief(text) exists');

SET LOCAL ROLE anon;
SELECT is((SELECT report_name FROM public.get_public_report('c1300000-0000-4000-8000-000000000001')),
  'Shared report', 'anon opens a shared report by id');
SELECT is((SELECT count(*)::int FROM public.get_public_report('c1300000-0000-4000-8000-000000000002')),
  0, 'anon gets nothing for a private report id');
SELECT is((SELECT name FROM public.get_shared_brief('c13-shared-token-0000000000000001')),
  'Shared brief', 'anon opens a shared brief by token');
SELECT is((SELECT count(*)::int FROM public.get_shared_brief('c13-unshared-token-00000000000002')),
  0, 'anon gets nothing for a brief that is not shared');
SELECT is((SELECT count(*)::int FROM public.get_shared_brief('')),
  0, 'an empty token matches nothing');
SELECT is((SELECT count(*)::int FROM public.get_shared_brief(NULL)),
  0, 'a null token matches nothing');
RESET ROLE;

SELECT ok(
  has_function_privilege('anon', 'public.get_public_report(uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.get_shared_brief(text)', 'EXECUTE'),
  'anon may execute both lookups');

SELECT * FROM finish();
ROLLBACK;
