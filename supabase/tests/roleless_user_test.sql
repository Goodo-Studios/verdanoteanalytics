-- A signed-in login with no role can write nothing (audit plan item 0.5).
--
-- Public sign-up is on in production, so anyone can make a login. A new login has no row in
-- user_roles. This file covers the Ad Library writes fixed in 20261216140001. The other open
-- write paths are fixed and tested in their own items: slack_connections (0.3), api_keys and
-- create_api_key (1.5), Vault tables and inspiration-media (1.6), annotations (1.2),
-- ad-thumbnails and ad-videos (1.1).
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(9);

INSERT INTO auth.users (id, email) VALUES
  ('c0500000-0000-4000-8000-000000000001', 'roleless@example.test'),
  ('c0500000-0000-4000-8000-000000000002', 'roleless-client@example.test'),
  ('c0500000-0000-4000-8000-000000000003', 'roleless-employee@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c0500000-0000-4000-8000-000000000002', 'client'),
  ('c0500000-0000-4000-8000-000000000003', 'employee');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- no role (1-4)
SELECT pg_temp.as_user('c0500000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.ad_library_boards (user_id, name) VALUES ('c0500000-0000-4000-8000-000000000001', 'b')$$,
  '42501', NULL, 'a login with no role cannot create an Ad Library board');
SELECT throws_ok(
  $$INSERT INTO public.ad_library_folders (user_id, name) VALUES ('c0500000-0000-4000-8000-000000000001', 'f')$$,
  '42501', NULL, 'a login with no role cannot create an Ad Library folder');
SELECT throws_ok(
  $$INSERT INTO public.ad_library_saved_ads (user_id, source_url) VALUES ('c0500000-0000-4000-8000-000000000001', 'https://example.test/ad')$$,
  '42501', NULL, 'a login with no role cannot save an ad');
SELECT throws_ok(
  $$INSERT INTO public.ad_library_tags (user_id, name) VALUES ('c0500000-0000-4000-8000-000000000001', 't')$$,
  '42501', NULL, 'a login with no role cannot create an Ad Library tag');
RESET ROLE;

-- ---------------------------------------------------------------- client (5-6)
SELECT pg_temp.as_user('c0500000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.ad_library_boards (user_id, name) VALUES ('c0500000-0000-4000-8000-000000000002', 'b')$$,
  '42501', NULL, 'a client cannot create an Ad Library board');
SELECT throws_ok(
  $$INSERT INTO public.ad_library_saved_ads (user_id, source_url) VALUES ('c0500000-0000-4000-8000-000000000002', 'https://example.test/ad')$$,
  '42501', NULL, 'a client cannot save an ad');
RESET ROLE;

-- ---------------------------------------------------------------- staff still can (7-8)
SELECT pg_temp.as_user('c0500000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.ad_library_saved_ads (user_id, source_url) VALUES ('c0500000-0000-4000-8000-000000000003', 'https://example.test/ad')$$,
  'an employee can still save an ad (bookmarklet receiver)');
SELECT lives_ok(
  $$INSERT INTO public.ad_library_boards (user_id, name) VALUES ('c0500000-0000-4000-8000-000000000003', 'b')$$,
  'an employee can still create an Ad Library board');
RESET ROLE;

-- ---------------------------------------------------------------- anon (9)
SELECT ok(
  (SELECT 'authenticated' = ALL (roles::text[]) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_library_board_ads' AND policyname = 'board_ads_update'),
  'board_ads_update applies to signed-in users only, not anon');

SELECT * FROM finish();
ROLLBACK;
