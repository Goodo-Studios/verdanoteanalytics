-- Ensure the ad-videos bucket accepts the larger ad videos.
--
-- Video caching fails with "The object exceeded the maximum allowed size" for
-- 50-64MB videos even though an earlier migration set file_size_limit=500MB — the
-- live value is evidently lower (reset, or never applied). Re-assert a generous
-- 200MB limit. If uploads still fail after this, the binding cap is the PROJECT-level
-- storage upload limit (Dashboard → Storage → Settings), which SQL cannot change.
UPDATE storage.buckets
SET file_size_limit = 209715200  -- 200 MB
WHERE id = 'ad-videos';
