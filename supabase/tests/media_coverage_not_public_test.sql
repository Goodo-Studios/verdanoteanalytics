-- pgTAP regression test for 20261208090001_media_coverage_not_public.sql.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- On 2026-11-14 the public anon key could read every row of public.media_coverage because the view
-- ran as its owner and anon held SELECT. This pins both halves of the fix.

BEGIN;
SELECT plan(3);

SELECT ok(
  coalesce(
    (SELECT 'security_invoker=true' = ANY (c.reloptions)
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'media_coverage'),
    false
  ),
  'media_coverage is a security_invoker view'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.media_coverage', 'SELECT'),
  'anon cannot select media_coverage'
);

SELECT ok(
  has_table_privilege('service_role', 'public.media_coverage', 'SELECT'),
  'service_role can still select media_coverage'
);

SELECT * FROM finish();
ROLLBACK;
