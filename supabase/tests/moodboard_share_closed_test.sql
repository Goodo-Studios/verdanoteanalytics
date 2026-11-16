-- Shared moodboards can no longer be listed by anyone (audit plan item 1.3).
--
-- "Public can view shared moodboards" and "Public can view shared moodboard items" had no TO
-- clause, so anon and every signed-in user could list every shared moodboard and its items.
-- Nothing in the app or the edge functions uses moodboards, so the two policies are dropped.
-- Staff keep access through the "Builder/employee can manage" policies.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(5);

INSERT INTO auth.users (id, email) VALUES
  ('c1320000-0000-4000-8000-000000000001', 'mb-staff@example.test'),
  ('c1320000-0000-4000-8000-000000000002', 'mb-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1320000-0000-4000-8000-000000000001', 'employee'),
  ('c1320000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.moodboards (id, name, created_by, is_shared) VALUES
  ('c1320000-0000-4000-8000-0000000000a1', 'Shared board', 'c1320000-0000-4000-8000-000000000001', true);
INSERT INTO public.moodboard_items (moodboard_id, type, caption) VALUES
  ('c1320000-0000-4000-8000-0000000000a1', 'image', 'item');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('moodboards', 'moodboard_items')
      AND policyname IN ('Public can view shared moodboards', 'Public can view shared moodboard items')),
  0, 'the two open share policies are gone');

-- anon outcomes are recorded as anon and asserted as the test owner.
CREATE TEMP TABLE mb_anon (tbl text, n int);
GRANT ALL ON mb_anon TO anon;
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.moodboards WHERE id = 'c1320000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  INSERT INTO mb_anon VALUES ('moodboards', n);
END $$;
RESET ROLE;
SELECT is((SELECT n FROM mb_anon WHERE tbl = 'moodboards'), 0, 'anon cannot list a shared moodboard');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1320000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1320000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.moodboards WHERE id = 'c1320000-0000-4000-8000-0000000000a1'),
  0, 'a client cannot list a shared moodboard');
SELECT is((SELECT count(*)::int FROM public.moodboard_items WHERE moodboard_id = 'c1320000-0000-4000-8000-0000000000a1'),
  0, 'a client cannot list a shared moodboard''s items');
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1320000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1320000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.moodboards WHERE id = 'c1320000-0000-4000-8000-0000000000a1'),
  1, 'staff still see the moodboard');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
