-- Backup table for reports corrected in place (audit 6.3): exists, has row security on, and no
-- signed-in or anonymous user can read or write it.

BEGIN;
SELECT plan(5);

SELECT has_table('public', 'report_corrections', 'report_corrections exists');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.report_corrections'::regclass),
  true,
  'row security is on'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.report_corrections', 'SELECT'),
  'signed-in users cannot read it'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.report_corrections', 'INSERT'),
  'signed-in users cannot write it'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.report_corrections', 'SELECT'),
  'anonymous users cannot read it'
);

SELECT * FROM finish();
ROLLBACK;
