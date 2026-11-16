-- No two indexes in public cover exactly the same thing (audit Batch 9).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- idx_daily_metrics_ad_date on creative_daily_metrics (ad_id, date) repeated the primary key and
-- took 65 MB in production; the production check (2026-11-16) found five more plain indexes that
-- repeat a unique or primary key index on the same columns. A duplicate costs storage and slows
-- every write while never being needed for a read.
--
-- Two indexes are duplicates when they are on the same table with the same key columns, operator
-- classes, expressions, predicate and number of key columns.

BEGIN;
SELECT plan(2);

SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relnamespace = 'public'::regnamespace),
  '>', 50,
  'the check looks at a real set of indexes'
);

SELECT is(
  (SELECT string_agg(table_name || ' (' || indexes || ')', '; ' ORDER BY table_name)
     FROM (
       SELECT t.relname AS table_name, string_agg(c.relname, ', ' ORDER BY c.relname) AS indexes
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
        WHERE t.relnamespace = 'public'::regnamespace
        GROUP BY t.relname, i.indkey::text, i.indclass::text, coalesce(i.indexprs::text, ''),
                 coalesce(i.indpred::text, ''), i.indnkeyatts
       HAVING count(*) > 1
     ) d),
  NULL,
  'no table in public has two indexes on exactly the same thing'
);

SELECT * FROM finish();
ROLLBACK;
