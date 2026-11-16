-- Edge function addresses for cron jobs come from a setting, not a hard-coded host (audit Batch 9).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- 34 cron migrations call https://<production ref>.supabase.co/functions/v1/... directly, so on
-- staging the jobs point at production until the lockdown script rewrites them. New jobs build the
-- address with public.edge_function_url(name), which reads the project URL from the vault
-- (project_url, else storage_signing_project_url, which production already has).
--
-- Checks: the function exists; with no URL in the vault it raises instead of guessing; it joins
-- the stored URL and the function name (a trailing slash is dropped); project_url wins over the
-- storage signing URL; a name that is not a plain function name is refused; only the service
-- role and the cron owner may call it.

BEGIN;
SELECT plan(9);

SELECT has_function('public', 'edge_function_url', ARRAY['text'], 'edge_function_url(text) exists');

DELETE FROM vault.secrets WHERE name IN ('project_url', 'storage_signing_project_url');
SELECT throws_ok($$SELECT public.edge_function_url('sync')$$, 'P0001', NULL,
  'with no project URL in the vault it raises instead of guessing a host');

SELECT lives_ok($$SELECT vault.create_secret('https://storage-url.example.test/', 'storage_signing_project_url')$$,
  'a test storage signing URL is put in the local test vault');
SELECT is(public.edge_function_url('sync'), 'https://storage-url.example.test/functions/v1/sync',
  'it joins the stored URL and the function name, dropping a trailing slash');

SELECT lives_ok($$SELECT vault.create_secret('https://project-url.example.test', 'project_url')$$,
  'a test project URL is put in the local test vault');
SELECT is(public.edge_function_url('refresh-media-queue'), 'https://project-url.example.test/functions/v1/refresh-media-queue',
  'project_url wins over the storage signing URL');

SELECT throws_ok($$SELECT public.edge_function_url('../admin')$$, '22023', NULL,
  'a name that is not a plain function name is refused');

SELECT ok(NOT has_function_privilege('anon', 'public.edge_function_url(text)', 'EXECUTE'), 'anon cannot call it');
SELECT ok(NOT has_function_privilege('authenticated', 'public.edge_function_url(text)', 'EXECUTE'), 'signed-in users cannot call it');

SELECT * FROM finish();
ROLLBACK;
