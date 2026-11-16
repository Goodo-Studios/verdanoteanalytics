-- slack_connections is closed to anon and authenticated (migration 20261216130001,
-- audit plan item 0.3). service_role keeps access.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(7);

SELECT ok(NOT has_table_privilege('authenticated', 'public.slack_connections', 'INSERT'),
  'authenticated cannot insert slack_connections');
SELECT ok(NOT has_table_privilege('authenticated', 'public.slack_connections', 'UPDATE'),
  'authenticated cannot update slack_connections');
SELECT ok(NOT has_table_privilege('authenticated', 'public.slack_connections', 'SELECT'),
  'authenticated cannot select slack_connections (bot tokens, signing secrets)');
SELECT ok(NOT has_table_privilege('anon', 'public.slack_connections', 'SELECT'),
  'anon cannot select slack_connections');
SELECT ok(has_table_privilege('service_role', 'public.slack_connections', 'SELECT'),
  'service_role keeps access');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'slack_connections'), 0,
  'no client policies remain on slack_connections');

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.slack_connections (user_id, team_id, bot_token) VALUES (gen_random_uuid(), 'T1', 'not-a-real-token')$$,
  '42501', NULL, 'authenticated insert is permission denied');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
