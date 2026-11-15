-- ad-thumbnails and ad-videos: only the service role writes (audit plan item 1.1).
--
-- These four policies (20260213155236, 20260213162420) were meant for edge functions but had no
-- TO clause. The service role bypasses row rules, so they never helped it; their only effect was
-- to let anon and every signed-in user upload or overwrite files in both public buckets (videos
-- up to the bucket's 2 GB limit).
--
-- Every uploader is an edge function using the service-role key: sync, enrich-thumbnails,
-- cache-creative-image, drain-media-queue, refresh-thumbnails, preview-capture,
-- backfill-thumbnail-storage-path and clear-media-cache. The app never uploads to these buckets.
-- Public read ("Public can view ad thumbnails/videos") is unchanged.

DROP POLICY IF EXISTS "Service role can upload thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload videos" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update videos" ON storage.objects;
