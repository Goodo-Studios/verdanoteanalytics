-- ============================================================================
-- SECURITY: scope the `annotations` storage bucket to the owning tenant.
--
-- The bucket was `public = true` with a `TO public USING (bucket_id=...)` SELECT
-- policy, so any annotation image was readable by anyone who could guess/obtain
-- its object path — cross-tenant + anonymous disclosure. The `public.annotations`
-- table is already account-scoped (staff see all, clients see linked accounts);
-- this brings the storage objects in line by joining on image_path, mirroring the
-- pattern already used for the company-docs bucket (20260212170359).
--
-- Safe to privatize: the annotations feature has no public-URL render path in the
-- app today. If it is built out, use signed URLs (as the vault does), not a public
-- bucket.
-- ============================================================================

-- Make the bucket private so public URLs no longer bypass RLS.
UPDATE storage.buckets SET public = false WHERE id = 'annotations';

-- Replace the world-readable SELECT policy with an account-scoped one.
DROP POLICY IF EXISTS "Anyone can view annotations" ON storage.objects;

CREATE POLICY "Staff or linked clients can view annotations"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'annotations'
  AND EXISTS (
    SELECT 1 FROM public.annotations an
    WHERE an.image_path = storage.objects.name
      AND (
        public.has_role(auth.uid(), 'builder'::public.app_role)
        OR public.has_role(auth.uid(), 'employee'::public.app_role)
        OR an.account_id IN (SELECT public.get_user_account_ids(auth.uid()))
      )
  )
);
