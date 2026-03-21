
-- Drop existing per-user RLS policies on ad_library_saved_ads
DROP POLICY IF EXISTS "saved_ads_delete" ON public.ad_library_saved_ads;
DROP POLICY IF EXISTS "saved_ads_insert" ON public.ad_library_saved_ads;
DROP POLICY IF EXISTS "saved_ads_select" ON public.ad_library_saved_ads;
DROP POLICY IF EXISTS "saved_ads_update" ON public.ad_library_saved_ads;

-- Shared policies: builder+employee can see/manage ALL saved ads
CREATE POLICY "saved_ads_select" ON public.ad_library_saved_ads
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

CREATE POLICY "saved_ads_insert" ON public.ad_library_saved_ads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "saved_ads_update" ON public.ad_library_saved_ads
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

CREATE POLICY "saved_ads_delete" ON public.ad_library_saved_ads
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

-- Drop existing per-user RLS policies on ad_library_boards
DROP POLICY IF EXISTS "boards_delete" ON public.ad_library_boards;
DROP POLICY IF EXISTS "boards_insert" ON public.ad_library_boards;
DROP POLICY IF EXISTS "boards_select_own" ON public.ad_library_boards;
DROP POLICY IF EXISTS "boards_update" ON public.ad_library_boards;

-- Shared policies for boards
CREATE POLICY "boards_select" ON public.ad_library_boards
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
    OR is_public = true
  );

CREATE POLICY "boards_insert" ON public.ad_library_boards
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "boards_update" ON public.ad_library_boards
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

CREATE POLICY "boards_delete" ON public.ad_library_boards
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

-- Drop existing per-user RLS policies on ad_library_folders
DROP POLICY IF EXISTS "folders_delete" ON public.ad_library_folders;
DROP POLICY IF EXISTS "folders_insert" ON public.ad_library_folders;
DROP POLICY IF EXISTS "folders_select" ON public.ad_library_folders;
DROP POLICY IF EXISTS "folders_update" ON public.ad_library_folders;

-- Shared policies for folders
CREATE POLICY "folders_select" ON public.ad_library_folders
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

CREATE POLICY "folders_insert" ON public.ad_library_folders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "folders_update" ON public.ad_library_folders
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

CREATE POLICY "folders_delete" ON public.ad_library_folders
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

-- Drop and recreate ad_library_tags policies
DROP POLICY IF EXISTS "tags_select" ON public.ad_library_tags;
DROP POLICY IF EXISTS "tags_insert" ON public.ad_library_tags;
DROP POLICY IF EXISTS "tags_update" ON public.ad_library_tags;
DROP POLICY IF EXISTS "tags_delete" ON public.ad_library_tags;
DROP POLICY IF EXISTS "Users can manage own tags" ON public.ad_library_tags;

CREATE POLICY "tags_select" ON public.ad_library_tags
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

CREATE POLICY "tags_insert" ON public.ad_library_tags
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tags_update" ON public.ad_library_tags
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

CREATE POLICY "tags_delete" ON public.ad_library_tags
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR user_id = auth.uid()
  );

-- Drop and recreate ad_library_board_ads policies
DROP POLICY IF EXISTS "board_ads_select" ON public.ad_library_board_ads;
DROP POLICY IF EXISTS "board_ads_insert" ON public.ad_library_board_ads;
DROP POLICY IF EXISTS "board_ads_delete" ON public.ad_library_board_ads;
DROP POLICY IF EXISTS "Users can manage own board ads" ON public.ad_library_board_ads;

CREATE POLICY "board_ads_select" ON public.ad_library_board_ads
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR owns_ad_library_board(board_id)
    OR board_is_public(board_id)
  );

CREATE POLICY "board_ads_insert" ON public.ad_library_board_ads
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR owns_ad_library_board(board_id)
  );

CREATE POLICY "board_ads_delete" ON public.ad_library_board_ads
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR owns_ad_library_board(board_id)
  );

-- Drop and recreate ad_library_ad_tags policies
DROP POLICY IF EXISTS "ad_tags_select" ON public.ad_library_ad_tags;
DROP POLICY IF EXISTS "ad_tags_insert" ON public.ad_library_ad_tags;
DROP POLICY IF EXISTS "ad_tags_delete" ON public.ad_library_ad_tags;
DROP POLICY IF EXISTS "Users can manage own ad tags" ON public.ad_library_ad_tags;

CREATE POLICY "ad_tags_select" ON public.ad_library_ad_tags
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR owns_ad_library_ad(ad_id)
  );

CREATE POLICY "ad_tags_insert" ON public.ad_library_ad_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR owns_ad_library_ad(ad_id)
  );

CREATE POLICY "ad_tags_delete" ON public.ad_library_ad_tags
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'builder'::app_role)
    OR has_role(auth.uid(), 'employee'::app_role)
    OR owns_ad_library_ad(ad_id)
  );
