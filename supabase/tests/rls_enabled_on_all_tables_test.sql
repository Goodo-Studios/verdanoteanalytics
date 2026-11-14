-- Client wall, check 1 of 3: every table in `public` has row level security on.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- A table with row rules switched off is readable (and writable) by any signed-in
-- user through the API, whatever its policies say. Staff data now sits next to
-- client logins, so a table added without `enable row level security` must fail CI.
--
-- Tables that belong to an extension (for example PostGIS reference tables) are not
-- ours to change and are left out.

BEGIN;
SELECT plan(3);

CREATE FUNCTION pg_temp.tables_without_rls() RETURNS text AS $$
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
     )
$$ LANGUAGE sql;

-- The check is not vacuous: it looks at a real set of tables.
SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
  '>', 50,
  'found the public tables (sanity: more than 50)'
);

-- The real assertion: no table is without row rules. A failure lists the table names.
SELECT is(
  pg_temp.tables_without_rls(),
  NULL,
  'every table in public has row level security on'
);

-- The check itself works: a table created without row rules is reported.
CREATE TABLE public.__wall_probe_no_rls (id int);
SELECT matches(
  pg_temp.tables_without_rls(),
  '__wall_probe_no_rls',
  'self-test: a table without row level security is detected'
);

SELECT * FROM finish();
ROLLBACK;
