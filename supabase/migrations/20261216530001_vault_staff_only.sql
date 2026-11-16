-- The Vault is staff only, and its protected fields are set by functions only
-- (audit plan 1.6 steps 2 and 3, including the inspiration-media bucket).
--
-- Matthew's rule: staff read and manage every Vault item; non-staff have no Vault access.
-- Step 1 (20261216220001, live 2026-11-16) gave staff full access. Checked before this step,
-- production read-only: no Vault item and no Vault board is owned by a non-staff login, and the
-- live pages update only status, error_message, is_featured, ad_body_text, the two analysis
-- fields and the three hook flags. Rows, file paths, thumbnails and share fields are written by
-- functions with the service role, which these rules do not affect.

-- 1. The helper behind the child tables (transcripts, frameworks, tags, embeddings): staff only.
CREATE OR REPLACE FUNCTION public.vault_visible_item_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.id FROM public.inspiration_items i
   WHERE (SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role))
$$;

-- 2. Items: no owner rules; the staff update and delete rules stay. The read rule loses its
--    "OR saved_by = auth.uid()" branch (from 20260808000001) and becomes staff only.
DROP POLICY IF EXISTS inspiration_items_select ON public.inspiration_items;
CREATE POLICY inspiration_items_select ON public.inspiration_items
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
    OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role))
  );
DROP POLICY IF EXISTS inspiration_items_insert ON public.inspiration_items;
DROP POLICY IF EXISTS inspiration_items_update ON public.inspiration_items;
DROP POLICY IF EXISTS inspiration_items_delete ON public.inspiration_items;

-- 3. Protected item fields are written by functions only (2.2: file_path is signed later).
REVOKE INSERT, UPDATE ON public.inspiration_items FROM authenticated, anon;
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'inspiration_items'
     AND column_name NOT IN ('id', 'user_id', 'file_path', 'thumbnail_url', 'thumbnail_path',
                             'video_url', 'saved_by', 'share_token', 'shared_at', 'created_at');
  EXECUTE format('GRANT UPDATE (%s) ON public.inspiration_items TO authenticated', v_cols);
END $$;

-- 4. Vault boards: creating one needs staff.
DROP POLICY IF EXISTS boards_insert ON public.boards;
CREATE POLICY boards_insert ON public.boards
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

-- 5. inspiration-media: the folder rules also require staff.
DROP POLICY IF EXISTS "Users access own vault media" ON storage.objects;
DROP POLICY IF EXISTS inspiration_media_user_select ON storage.objects;
DROP POLICY IF EXISTS inspiration_media_user_insert ON storage.objects;
DROP POLICY IF EXISTS inspiration_media_user_delete ON storage.objects;

CREATE POLICY inspiration_media_staff_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'inspiration-media'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

CREATE POLICY inspiration_media_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inspiration-media'
    AND (storage.foldername(name))[1] IN ('uploads', 'thumbnails')
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

CREATE POLICY inspiration_media_staff_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'inspiration-media'
    AND (storage.foldername(name))[1] = 'thumbnails'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  )
  WITH CHECK (
    bucket_id = 'inspiration-media'
    AND (storage.foldername(name))[1] = 'thumbnails'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

CREATE POLICY inspiration_media_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'inspiration-media'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );
