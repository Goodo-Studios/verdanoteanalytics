-- inspiration-media storage RLS policies
--
-- The bucket was created manually (not via migration), so no policies exist yet.
-- Client-side uploads (user JWT) from CaptureModal hit the storage API directly
-- and are blocked without these policies. Edge functions use the service-role key
-- and bypass RLS, so they are unaffected.
--
-- Path structure in this bucket:
--   uploads/{user_id}/{timestamp}.{ext}       — video/image originals
--   thumbnails/{user_id}/{timestamp}.{ext}    — video thumbnails (client-generated)
--
-- storage.foldername(name) returns a 1-indexed text array of path segments,
-- so [2] is the user_id component for both path prefixes above.

-- INSERT: users can upload to their own uploads/ and thumbnails/ directories
CREATE POLICY "inspiration_media_user_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'inspiration-media'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- SELECT: users can read/list their own files (required for createSignedUrl)
CREATE POLICY "inspiration_media_user_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspiration-media'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- DELETE: users can remove their own files
CREATE POLICY "inspiration_media_user_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'inspiration-media'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
