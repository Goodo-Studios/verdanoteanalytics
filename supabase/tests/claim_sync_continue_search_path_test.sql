-- pgTAP regression test for 20261214100002_claim_sync_continue_search_path.sql.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(2);

SELECT ok(
  coalesce(
    (SELECT 'search_path=public' = ANY (p.proconfig)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'claim_sync_continue'),
    false
  ),
  'claim_sync_continue has a fixed search_path'
);

SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'
      )),
  0,
  'no SECURITY DEFINER function in public lacks a search_path'
);

SELECT * FROM finish();
ROLLBACK;
