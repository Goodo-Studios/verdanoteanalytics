-- sync_logs is staff and service_role only, and api_errors is hidden from client roles
-- (migration 20261216120001, audit plan item 0.1).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- All data is made up. The token string below is fake.

BEGIN;
SELECT plan(6);

INSERT INTO public.ad_accounts (id, name) VALUES ('act_scw_a', 'SCW A');
INSERT INTO public.sync_logs (account_id, status, api_errors)
VALUES ('act_scw_a', 'failed', '[{"message":"x?access_token=EAABfakefakefake&after=1"}]');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'sync_logs' AND policyname = 'Client can view linked sync_logs'),
  'client read policy on sync_logs is gone');

SELECT ok(NOT has_column_privilege('authenticated', 'public.sync_logs', 'api_errors', 'SELECT'),
  'authenticated cannot select api_errors');
SELECT ok(NOT has_column_privilege('anon', 'public.sync_logs', 'api_errors', 'SELECT'),
  'anon cannot select api_errors');
SELECT ok(has_column_privilege('authenticated', 'public.sync_logs', 'status', 'SELECT'),
  'authenticated keeps status (staff Data Health screen)');
SELECT ok(has_column_privilege('service_role', 'public.sync_logs', 'api_errors', 'SELECT'),
  'service_role keeps api_errors');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT api_errors FROM public.sync_logs$$, '42501', NULL,
  'authenticated SELECT api_errors is permission denied');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
