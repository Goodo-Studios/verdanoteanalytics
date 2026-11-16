-- Shared reports, briefs and Ad Library boards can no longer be listed (audit 1.3 step 3, 3.3 part 3).
--
-- "Public can view shared reports", "Public can view briefs explicitly marked shared",
-- boards_select_public and board_ads_select_public had no owner or link check, so anon and every
-- signed-in user could list every shared row. Step 1 (live since 2026-11-16) moved the report and
-- brief links to one-row lookups, and old shared ad board links read nothing (3.3 part 2). These
-- tests check the open policies are gone, nobody outside staff can list the rows, and the lookups
-- still open a link.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(10);

INSERT INTO auth.users (id, email) VALUES
  ('c1330000-0000-4000-8000-000000000001', 'sl-staff@example.test'),
  ('c1330000-0000-4000-8000-000000000002', 'sl-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1330000-0000-4000-8000-000000000001', 'employee'),
  ('c1330000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.reports (id, report_name, report_type, is_public) VALUES
  ('c1330000-0000-4000-8000-0000000000a1', 'Shared report', 'standard', true);
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c133', 'C133');
INSERT INTO public.briefs (id, account_id, name, share_token, is_shared) VALUES
  ('c1330000-0000-4000-8000-0000000000b1', 'act_c133', 'Shared brief', 'c133-shared-token-000000000000001', true);
INSERT INTO public.ad_library_boards (id, user_id, name, is_public, share_token) VALUES
  ('c1330000-0000-4000-8000-0000000000d1', 'c1330000-0000-4000-8000-000000000001', 'Public board', true, 'c133-board-token-0000000000000001');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public'
      AND (tablename, policyname) IN (
        ('reports', 'Public can view shared reports'),
        ('briefs', 'Public can view briefs explicitly marked shared'),
        ('ad_library_boards', 'boards_select_public'),
        ('ad_library_board_ads', 'board_ads_select_public'))),
  0, 'the four open share policies are gone');

-- anon outcomes are recorded as anon and asserted as the test owner.
CREATE TEMP TABLE sl_anon (tbl text, n int);
GRANT ALL ON sl_anon TO anon;
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  BEGIN SELECT count(*) INTO n FROM public.reports WHERE is_public; EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  INSERT INTO sl_anon VALUES ('reports', n);
  BEGIN SELECT count(*) INTO n FROM public.briefs WHERE is_shared; EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  INSERT INTO sl_anon VALUES ('briefs', n);
  BEGIN SELECT count(*) INTO n FROM public.ad_library_boards WHERE is_public; EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  INSERT INTO sl_anon VALUES ('ad_library_boards', n);
  SELECT count(*) INTO n FROM public.get_public_report('c1330000-0000-4000-8000-0000000000a1');
  INSERT INTO sl_anon VALUES ('report_lookup', n);
  SELECT count(*) INTO n FROM public.get_shared_brief('c133-shared-token-000000000000001');
  INSERT INTO sl_anon VALUES ('brief_lookup', n);
END $$;
RESET ROLE;
SELECT is((SELECT n FROM sl_anon WHERE tbl = 'reports'), 0, 'anon cannot list shared reports');
SELECT is((SELECT n FROM sl_anon WHERE tbl = 'briefs'), 0, 'anon cannot list shared briefs');
SELECT is((SELECT n FROM sl_anon WHERE tbl = 'ad_library_boards'), 0, 'anon cannot list public ad boards');
SELECT is((SELECT n FROM sl_anon WHERE tbl = 'report_lookup'), 1, 'anon still opens a shared report link');
SELECT is((SELECT n FROM sl_anon WHERE tbl = 'brief_lookup'), 1, 'anon still opens a shared brief link');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1330000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1330000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.reports WHERE is_public), 0, 'a client cannot list other shared reports');
SELECT is((SELECT count(*)::int FROM public.ad_library_boards WHERE is_public), 0, 'a client cannot list public ad boards');
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1330000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1330000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.reports WHERE id = 'c1330000-0000-4000-8000-0000000000a1'), 1, 'staff still see the report');
SELECT is((SELECT count(*)::int FROM public.ad_library_boards WHERE id = 'c1330000-0000-4000-8000-0000000000d1'), 1, 'staff still see the board');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
