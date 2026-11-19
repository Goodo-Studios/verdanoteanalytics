-- Close the last public read path into the retired Ad Library (audit 3.3 part 3; ground rule 4
-- step (c)).
--
-- 20261216500001 dropped the open listing policies on ad_library_boards and
-- ad_library_board_ads. saved_ads_select_public on ad_library_saved_ads was left: it let any
-- role, anon included, read a saved ad on a board marked is_public through the security definer
-- helper ad_is_on_public_board. Both public-board helpers were also still callable by anon and
-- every signed-in user.
--
-- Step (b): shared ad board links read nothing since 3.3 part 2 (live 2026-11-16), no front-end
-- or edge function code calls these helpers, and production API logs show no request to the
-- Ad Library tables or helpers in the 7 days before this change. The service role keeps access
-- (transcribe-ad reads ad_library_saved_ads with it).

DROP POLICY IF EXISTS saved_ads_select_public ON public.ad_library_saved_ads;

REVOKE EXECUTE ON FUNCTION public.board_is_public(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ad_is_on_public_board(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_is_public(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_is_on_public_board(uuid) TO service_role;
