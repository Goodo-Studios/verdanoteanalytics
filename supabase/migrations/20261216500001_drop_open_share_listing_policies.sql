-- Shared reports, briefs and Ad Library boards can no longer be listed
-- (audit plan 1.3 step 3 and 3.3 part 3; ground rule 4 step (c)).
--
-- These four policies let anon and every signed-in user list every shared row. Report and brief
-- links now open through get_public_report / get_shared_brief (one row per link, live since
-- 2026-11-16), and old shared ad board links read nothing (3.3 part 2). Staff rules, the linked
-- client rule on reports and the two lookups are unchanged.

DROP POLICY IF EXISTS "Public can view shared reports" ON public.reports;
DROP POLICY IF EXISTS "Public can view briefs explicitly marked shared" ON public.briefs;
DROP POLICY IF EXISTS boards_select_public ON public.ad_library_boards;
DROP POLICY IF EXISTS board_ads_select_public ON public.ad_library_board_ads;

-- The signed-in read rules on the Ad Library boards also ended in "OR is public", so any signed-in
-- user could list every public board and its ads. Recreate them without that clause.
DROP POLICY IF EXISTS boards_select ON public.ad_library_boards;
CREATE POLICY boards_select ON public.ad_library_boards
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
    OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role))
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS board_ads_select ON public.ad_library_board_ads;
CREATE POLICY board_ads_select ON public.ad_library_board_ads
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
    OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role))
    OR public.owns_ad_library_board(board_id)
  );
