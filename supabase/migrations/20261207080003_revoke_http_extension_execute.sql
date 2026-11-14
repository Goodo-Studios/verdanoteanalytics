-- Close the http extension's functions to the public API roles.
--
-- Migration 20261101000002 created the `http` extension (schema extensions) for
-- storage_admin_request. Supabase grants EXECUTE on functions in the extensions schema to anon
-- and authenticated by default, so extensions.http(...) could be called by a browser session or
-- an anonymous request to make a server-side HTTP call from the database (an SSRF path).
--
-- This revokes EXECUTE on every function the http extension owns from PUBLIC, anon and
-- authenticated. storage_admin_request is SECURITY DEFINER and runs as its owner, which keeps
-- its own EXECUTE on those functions, so it keeps working. Nothing else in the repository calls
-- the http functions (checked across supabase/migrations and supabase/functions).
--
-- Safe to run again, and on a database where the extension is absent (it then does nothing).
-- If a revoke is refused for lack of privilege it raises a warning for that function and goes on;
-- supabase/tests/http_extension_locked_test.sql fails when any function is still open.

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_extension where extname = 'http') then
    raise notice 'The http extension is not installed, so there is nothing to revoke.';
    return;
  end if;

  for r in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as signature
    from pg_extension e
    join pg_depend d
      on d.refclassid = 'pg_extension'::regclass
     and d.refobjid = e.oid
     and d.classid = 'pg_proc'::regclass
     and d.deptype = 'e'
    join pg_proc p on p.oid = d.objid
    join pg_namespace n on n.oid = p.pronamespace
    where e.extname = 'http'
    order by 1
  loop
    begin
      execute format('revoke all on routine %s from public, anon, authenticated', r.signature);
    exception when insufficient_privilege then
      raise warning 'Could not revoke EXECUTE on % (insufficient privilege); revoke it as the owner.', r.signature;
    end;
  end loop;
end
$$;
