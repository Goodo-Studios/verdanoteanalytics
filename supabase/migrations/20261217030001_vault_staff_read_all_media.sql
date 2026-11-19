-- Staff can read every file in the inspiration-media bucket (Vault videos that would not play).
--
-- Step 3 of the Vault staff-only change (20261216530001) limited reading a Vault file to the
-- folder that carries the reader's own user id: (storage.foldername(name))[2] = auth.uid().
-- The app signs file URLs in the browser with the reader's own login, so any file in someone
-- else's folder could not be signed and its video would not play. That covers files that
-- teammates saved, the imported library (atria/{uid}/) and 38 production items whose folder user
-- is not the item's user_id (see supabase/functions/_shared/vault-paths.ts).
--
-- The rule is "staff read and manage every Vault item", so this adds a staff-wide read rule for
-- the bucket. It is additive: the folder rule stays, and a non-staff login still reads nothing.
-- Writes and deletes are unchanged.

DROP POLICY IF EXISTS inspiration_media_staff_select_all ON storage.objects;
CREATE POLICY inspiration_media_staff_select_all ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'inspiration-media'
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );
