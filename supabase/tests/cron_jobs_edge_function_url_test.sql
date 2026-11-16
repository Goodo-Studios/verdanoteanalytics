-- Existing cron jobs move to public.edge_function_url (audit Batch 9, cron URL step 2).
--
-- public.move_cron_jobs_to_edge_function_url() rewrites each job whose command calls a quoted
-- https://<ref>.supabase.co/functions/v1/<name> address so it calls edge_function_url('<name>')
-- instead. It only moves a job when edge_function_url(name) gives the same address it had, so a
-- job never starts calling a different project; with no project URL in the vault it moves nothing.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(9);

SELECT has_function('public', 'move_cron_jobs_to_edge_function_url', ARRAY[]::text[], 'the mover exists');

SELECT cron.schedule('t-cron-same-host', '0 0 1 1 *',
  $c$SELECT net.http_post(url := 'https://hostaaaa.supabase.co/functions/v1/scheduled-sync', body := '{}'::jsonb)$c$);
SELECT cron.schedule('t-cron-other-host', '0 0 1 1 *',
  $c$SELECT net.http_post(url := 'https://hostbbbb.supabase.co/functions/v1/scheduled-sync', body := '{}'::jsonb)$c$);

DELETE FROM vault.secrets WHERE name IN ('project_url', 'storage_signing_project_url');
SELECT lives_ok($$SELECT public.move_cron_jobs_to_edge_function_url()$$, 'with no project URL in the vault it does not fail');
SELECT ok((SELECT command ~ 'hostaaaa' FROM cron.job WHERE jobname = 't-cron-same-host'), 'and moves nothing');

SELECT vault.create_secret('https://hostaaaa.supabase.co/', 'storage_signing_project_url');
SELECT ok(public.move_cron_jobs_to_edge_function_url() >= 1, 'with the project URL set it moves the matching job');
SELECT is((SELECT command FROM cron.job WHERE jobname = 't-cron-same-host'),
  $c$SELECT net.http_post(url := public.edge_function_url('scheduled-sync'), body := '{}'::jsonb)$c$,
  'the job now calls edge_function_url(name)');
SELECT ok((SELECT command ~ 'hostbbbb' FROM cron.job WHERE jobname = 't-cron-other-host'),
  'a job on another host is left alone');
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 't-cron-same-host' AND command ~ 'supabase\.co'),
  0, 'the moved job has no hard-coded host left');

SELECT ok(NOT has_function_privilege('anon', 'public.move_cron_jobs_to_edge_function_url()', 'EXECUTE'), 'anon cannot call it');
SELECT ok(NOT has_function_privilege('authenticated', 'public.move_cron_jobs_to_edge_function_url()', 'EXECUTE'), 'signed-in users cannot call it');

SELECT * FROM finish();
ROLLBACK;
