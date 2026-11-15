-- sync_logs.sync_state must not be readable by anon or authenticated (migration 20261215140001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- sync_state used to hold Meta Graph URLs with access_token=. Client roles keep SELECT on the other
-- sync_logs columns; service_role keeps everything. All rows are made up.

BEGIN;
SELECT plan(7);

INSERT INTO public.ad_accounts (id, name) VALUES ('act_ssh_a', 'SSH A');
INSERT INTO public.sync_logs (account_id, sync_state)
VALUES ('act_ssh_a', '{"campaign_cursor": "https://example.test/x?after=A"}'::jsonb);

SELECT ok(NOT has_column_privilege('anon', 'public.sync_logs', 'sync_state', 'SELECT'),
  'anon cannot select sync_state');
SELECT ok(NOT has_column_privilege('authenticated', 'public.sync_logs', 'sync_state', 'SELECT'),
  'authenticated cannot select sync_state');
SELECT ok(has_column_privilege('authenticated', 'public.sync_logs', 'status', 'SELECT'),
  'authenticated can still select other columns');
SELECT ok(has_column_privilege('service_role', 'public.sync_logs', 'sync_state', 'SELECT'),
  'service_role can still select sync_state');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT sync_state FROM public.sync_logs$$, '42501', NULL,
  'authenticated SELECT sync_state is permission denied');
SELECT throws_ok($$SELECT * FROM public.sync_logs$$, '42501', NULL,
  'authenticated SELECT * is permission denied');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT sync_state FROM public.sync_logs$$, '42501', NULL,
  'anon SELECT sync_state is permission denied');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
