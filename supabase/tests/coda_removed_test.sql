-- Coda is gone from the database (migration 20261110000001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: coda_tasks is dropped, no Coda cron job is scheduled, and the tables
-- the ClickUp board and the tag resolver still read are kept.

BEGIN;
SELECT plan(5);

SELECT hasnt_table('public', 'coda_tasks', 'coda_tasks is dropped');
SELECT is((SELECT count(*)::int FROM cron.job WHERE jobname ILIKE '%coda%' OR command ILIKE '%sync-coda-%'), 0,
  'no Coda cron job is scheduled');
SELECT has_table('public', 'pipeline_tasks', 'pipeline_tasks (the ClickUp board) is kept');
SELECT has_table('public', 'name_mappings', 'name_mappings (read by the tag resolver) is kept');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosrc ILIKE '%coda_tasks%'), 0,
  'no database function refers to coda_tasks');

SELECT * FROM finish();
ROLLBACK;
