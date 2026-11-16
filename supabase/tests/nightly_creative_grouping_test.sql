-- Nightly creative grouping (audit 7.3): the queue function exists, only the service role can run
-- it, it calls cluster-creatives through edge_function_url, and a nightly job runs it.

BEGIN;
SELECT plan(6);

SELECT has_function('public', 'queue_creative_grouping', ARRAY[]::text[], 'queue_creative_grouping() exists');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.queue_creative_grouping()', 'EXECUTE'),
  'signed-in users cannot run it'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.queue_creative_grouping()', 'EXECUTE'),
  'anonymous users cannot run it'
);
SELECT ok(
  pg_get_functiondef('public.queue_creative_grouping()'::regprocedure) ~ 'edge_function_url\(''cluster-creatives''\)',
  'it calls cluster-creatives through edge_function_url'
);
SELECT ok(
  pg_get_functiondef('public.queue_creative_grouping()'::regprocedure) !~ 'supabase\.co',
  'no hard-coded project address'
);
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'creative-grouping-nightly'
      AND command ~ 'queue_creative_grouping\(\)' AND active),
  1,
  'one active nightly job runs it'
);

SELECT * FROM finish();
ROLLBACK;
