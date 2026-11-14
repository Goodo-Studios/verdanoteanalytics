-- The http extension (schema extensions): who owns its functions, what the ACLs are, and that the
-- only public wrapper around it is closed to the browser roles. Diagnostic by design.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Background: an earlier migration revoked EXECUTE on the extension's functions from PUBLIC, anon and
-- authenticated. In CI the revoke had no effect (has_function_privilege stayed true), most likely
-- because the migration role does not own the extension's functions. Revoking from PUBLIC can also
-- take away the only access a SECURITY DEFINER function owned by another role has to them
-- (storage_admin_request), and that cannot be tested without the real owners, so no revoke ships.
--
-- Why the exposure is nil today: the API only serves the schemas in the project's PostgREST setting,
-- which is `public,graphql_public` on both the production and the staging project (read through the
-- management API on 2026-11-14), and supabase/config.toml sets no [api] schemas. A caller of
-- /rest/v1/rpc/<name> therefore reaches functions in `public` only, never in `extensions`. A browser
-- session cannot run SQL. The route that remains is a function in `public` that calls http() and is
-- executable by a browser role, which is what the last two checks pin for storage_admin_request.
--
-- The diag() lines print the owner and ACL of every function the extension owns, so the CI log shows
-- the real state. They are not assertions. If a later run shows that the migration role owns them,
-- a revoke can be added with a has_function_privilege check on storage_admin_request's owner.

BEGIN;
SELECT plan(5);

SELECT has_extension('extensions', 'http', 'the http extension is installed in schema extensions');

CREATE TEMP TABLE http_functions AS
SELECT p.oid AS fn_oid, p.proname, p.proowner, p.proacl,
       format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature
FROM pg_extension e
JOIN pg_depend d
  ON d.refclassid = 'pg_extension'::regclass
 AND d.refobjid = e.oid
 AND d.classid = 'pg_proc'::regclass
 AND d.deptype = 'e'
JOIN pg_proc p ON p.oid = d.objid
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE e.extname = 'http';

SELECT cmp_ok((SELECT count(*)::int FROM http_functions), '>', 0, 'the http extension owns functions');

-- Ground truth for the CI log.
SELECT diag(format('migration role: current_user=%s session_user=%s superuser=%s',
  current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)));
SELECT diag(format('extension owner: %s', (SELECT pg_get_userbyid(extowner) FROM pg_extension WHERE extname = 'http')));
SELECT diag(format('http fn %s | owner=%s | acl=%s | anon=%s authenticated=%s public=%s',
  signature, pg_get_userbyid(proowner), coalesce(proacl::text, 'NULL (default: PUBLIC can execute)'),
  has_function_privilege('anon', fn_oid, 'EXECUTE'),
  has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
  has_function_privilege('public', fn_oid, 'EXECUTE')))
FROM http_functions ORDER BY signature;
SELECT diag(format('storage_admin_request owner=%s acl=%s',
  pg_get_userbyid(proowner), coalesce(proacl::text, 'NULL')))
FROM pg_proc WHERE oid = 'public.storage_admin_request(text,text,jsonb)'::regprocedure;
SELECT diag(format('migration role is a member of the extension owner: %s',
  pg_has_role(current_user, (SELECT extowner FROM pg_extension WHERE extname = 'http'), 'MEMBER')));

-- The wrapper that uses http() is closed to every browser role.
SELECT ok(NOT has_function_privilege('anon', 'public.storage_admin_request(text,text,jsonb)', 'EXECUTE'),
  'anon cannot call storage_admin_request');
SELECT ok(NOT has_function_privilege('authenticated', 'public.storage_admin_request(text,text,jsonb)', 'EXECUTE'),
  'signed-in users cannot call storage_admin_request');
SELECT ok(NOT has_function_privilege('public', 'public.storage_admin_request(text,text,jsonb)', 'EXECUTE'),
  'PUBLIC cannot call storage_admin_request');

SELECT * FROM finish();
ROLLBACK;
