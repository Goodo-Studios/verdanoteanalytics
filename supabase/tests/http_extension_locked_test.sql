-- The http extension's functions are not callable by the public API roles
-- (migration 20261207080003).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the extension is installed; no function it owns can be executed by PUBLIC, anon or
-- authenticated; and storage_admin_request (SECURITY DEFINER) keeps its own access to them.

BEGIN;
SELECT plan(6);

SELECT has_extension('extensions', 'http', 'the http extension is installed in schema extensions');

CREATE TEMP TABLE http_functions AS
SELECT p.oid AS fn_oid, p.proname
FROM pg_extension e
JOIN pg_depend d
  ON d.refclassid = 'pg_extension'::regclass
 AND d.refobjid = e.oid
 AND d.classid = 'pg_proc'::regclass
 AND d.deptype = 'e'
JOIN pg_proc p ON p.oid = d.objid
WHERE e.extname = 'http';

SELECT cmp_ok((SELECT count(*)::int FROM http_functions), '>', 0, 'the http extension owns functions');

SELECT is(
  (SELECT count(*)::int FROM http_functions WHERE has_function_privilege('anon', fn_oid, 'EXECUTE')),
  0, 'anon cannot execute any http function');

SELECT is(
  (SELECT count(*)::int FROM http_functions WHERE has_function_privilege('authenticated', fn_oid, 'EXECUTE')),
  0, 'authenticated cannot execute any http function');

SELECT is(
  (SELECT count(*)::int FROM http_functions WHERE has_function_privilege('public', fn_oid, 'EXECUTE')),
  0, 'PUBLIC cannot execute any http function');

-- storage_admin_request runs as its owner, so the owner must still be able to call extensions.http.
SELECT is(
  (SELECT count(*)::int
     FROM http_functions h, pg_proc s
    WHERE h.proname = 'http'
      AND s.oid = 'public.storage_admin_request(text,text,jsonb)'::regprocedure
      AND s.prosecdef
      AND has_function_privilege(s.proowner, h.fn_oid, 'EXECUTE')) > 0,
  true, 'storage_admin_request is SECURITY DEFINER and its owner can still call http()');

SELECT * FROM finish();
ROLLBACK;
