-- Ad Library writes are staff only (audit plan item 0.5).
--
-- Public sign-up is on in production, so "any signed-in user" includes a stranger who just
-- made a login and has no role. The insert policies on the deprecated ad_library_* tables only
-- checked user_id = auth.uid(), so such a login (and any client) could create boards, folders,
-- tags and saved ads. The only app writers are staff: the bookmarklet receiver and the
-- service-role functions quick-save and transcribe-ad (the service role ignores policies).
--
-- ALTER POLICY keeps each policy's name and command and swaps the check in place, so there is
-- no moment without a policy. Calls are wrapped in (select ...) to match the initPlan rule
-- (20261216100001, guarded by rls_initplan_test).
--
-- board_ads_update had no TO clause (it applied to anon too); it now applies to authenticated
-- and gives staff the same reach as board_ads_insert and board_ads_delete.

ALTER POLICY "boards_insert" ON public.ad_library_boards
  WITH CHECK (
    user_id = (select auth.uid())
    AND ((select has_role((select auth.uid()), 'builder'::app_role))
         OR (select has_role((select auth.uid()), 'employee'::app_role)))
  );

ALTER POLICY "folders_insert" ON public.ad_library_folders
  WITH CHECK (
    user_id = (select auth.uid())
    AND ((select has_role((select auth.uid()), 'builder'::app_role))
         OR (select has_role((select auth.uid()), 'employee'::app_role)))
  );

ALTER POLICY "saved_ads_insert" ON public.ad_library_saved_ads
  WITH CHECK (
    user_id = (select auth.uid())
    AND ((select has_role((select auth.uid()), 'builder'::app_role))
         OR (select has_role((select auth.uid()), 'employee'::app_role)))
  );

ALTER POLICY "tags_insert" ON public.ad_library_tags
  WITH CHECK (
    user_id = (select auth.uid())
    AND ((select has_role((select auth.uid()), 'builder'::app_role))
         OR (select has_role((select auth.uid()), 'employee'::app_role)))
  );

ALTER POLICY "board_ads_update" ON public.ad_library_board_ads
  TO authenticated
  USING (
    (select has_role((select auth.uid()), 'builder'::app_role))
    OR (select has_role((select auth.uid()), 'employee'::app_role))
    OR owns_ad_library_board(board_id)
  );
