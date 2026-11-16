-- Audit Batch 9, storage write holes, ground rule 4 step (c).
--
-- These six storage policies let any signed-in user (clients included) write to buckets that only
-- edge functions should write:
--   * "Service role can upload/update thumbnails/videos" were created TO public with only a
--     bucket check, despite their names. The service role bypasses row rules and never needed them.
--   * "Auth users can upload annotations" / "Auth users can delete own annotations" had no owner
--     check.
-- Step (a): nothing to replace, only edge functions (service role) write these buckets.
-- Step (b): confirmed 2026-11-16, no app code or live bundle writes them; storage logs show no
-- writes. Reads are unchanged: public read of ad thumbnails and videos, staff or linked-client
-- read of annotations.

DROP POLICY IF EXISTS "Service role can upload thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload videos" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update videos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can upload annotations" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete own annotations" ON storage.objects;
