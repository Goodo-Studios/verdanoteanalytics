-- Client wall, check 2 of 3: no policy hands a table to every signed-in user.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Flagged as "open":
--   * USING (true) or WITH CHECK (true), for any role except service_role
--   * USING (auth.uid() IS NOT NULL), i.e. any signed-in user
--   * USING (auth.role() = 'authenticated'), the same thing written another way
-- Client accounts are signed-in users, so an open policy on a staff table lets a
-- client read it. Policies that only name service_role are fine (that role skips
-- row rules anyway).
--
-- ALLOW-LIST. A table goes here only when every signed-in user may read it and it
-- holds no client or staff data. Add a reason next to the name.
--   creative_type_menu: the list of creative type names (Static, UGC, ...) that the
--   tagging dropdowns use. Reference data. Writes stay staff only.
-- (viral_feed_items was on the earlier list. Its table was dropped by migration
-- 20260609000001, so it is not here.)

BEGIN;
SELECT plan(3);

CREATE FUNCTION pg_temp.open_policies(p_allow text[]) RETURNS text AS $$
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
    FROM (
      SELECT p.tablename, p.policyname,
             lower(regexp_replace(coalesce(p.qual, ''), '\s', '', 'g'))       AS q,
             lower(regexp_replace(coalesce(p.with_check, ''), '\s', '', 'g')) AS w
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.roles <> ARRAY['service_role']::name[]
         AND NOT (p.tablename = ANY (p_allow))
    ) s
   WHERE q IN ('true', '(true)')
      OR w IN ('true', '(true)')
      OR q LIKE '%auth.uid()isnotnull%'
      OR w LIKE '%auth.uid()isnotnull%'
      OR q LIKE '%auth.role()=''authenticated''%'
      OR w LIKE '%auth.role()=''authenticated''%'
$$ LANGUAGE sql;

SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'),
  '>', 100,
  'found the public policies (sanity: more than 100)'
);

-- The real assertion. A failure lists table.policy for every open policy.
SELECT is(
  pg_temp.open_policies(ARRAY['creative_type_menu']),
  NULL,
  'no policy in public gives signed-in users open access outside the allow-list'
);

-- The check itself works: an open policy on a new table is reported, for each way
-- of writing it.
CREATE TABLE public.__wall_probe_open (id int);
ALTER TABLE public.__wall_probe_open ENABLE ROW LEVEL SECURITY;
CREATE POLICY probe_true ON public.__wall_probe_open FOR SELECT TO authenticated USING (true);
CREATE POLICY probe_uid  ON public.__wall_probe_open FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY probe_role ON public.__wall_probe_open FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY probe_chk  ON public.__wall_probe_open FOR INSERT TO authenticated WITH CHECK (true);
SELECT is(
  pg_temp.open_policies(ARRAY['creative_type_menu']),
  '__wall_probe_open.probe_chk, __wall_probe_open.probe_role, __wall_probe_open.probe_true, __wall_probe_open.probe_uid',
  'self-test: all four open-policy shapes are detected'
);

SELECT * FROM finish();
ROLLBACK;
