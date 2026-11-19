-- The last public read path into the retired Ad Library is closed (audit 3.3 part 3).
--
-- 20261216500001 dropped the open listing policies on ad_library_boards and
-- ad_library_board_ads. One more was left: saved_ads_select_public on ad_library_saved_ads let
-- any role, anon included, read a saved ad that sits on a board marked is_public, through the
-- security definer helper ad_is_on_public_board. board_is_public and ad_is_on_public_board were
-- also still callable by anon and every signed-in user. Shared ad board links read nothing since
-- 3.3 part 2, and production API logs show no call to these tables or functions in the 7 days
-- before this change (94_board_api_logs.json).
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(6);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_library_saved_ads' AND policyname = 'saved_ads_select_public'),
  0, 'saved_ads_select_public is gone');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
      AND (coalesce(qual, '') ~ '(board_is_public|ad_is_on_public_board)'
           OR coalesce(with_check, '') ~ '(board_is_public|ad_is_on_public_board)')),
  0, 'no row rule uses the public-board helpers any more');

SELECT ok(NOT has_function_privilege('anon', 'public.board_is_public(uuid)', 'EXECUTE'),
  'anon cannot call board_is_public');
SELECT ok(NOT has_function_privilege('anon', 'public.ad_is_on_public_board(uuid)', 'EXECUTE'),
  'anon cannot call ad_is_on_public_board');
SELECT ok(NOT has_function_privilege('authenticated', 'public.board_is_public(uuid)', 'EXECUTE'),
  'signed-in users cannot call board_is_public');
SELECT ok(NOT has_function_privilege('authenticated', 'public.ad_is_on_public_board(uuid)', 'EXECUTE'),
  'signed-in users cannot call ad_is_on_public_board');

SELECT * FROM finish();
ROLLBACK;
