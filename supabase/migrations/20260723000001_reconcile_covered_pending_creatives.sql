-- Reconcile covered-but-still-'pending' creatives → 'captured'.
--
-- A cluster of creatives had a storage-owned video_url (media already landed via the
-- API/media tier) yet capture_status='pending'. isCaptureCovered treats an owned
-- video OR full-res static as done, so these rows are drainable-covered: the preview
-- drain's selectDrainBatch drops them, but they were never transitioned out of
-- 'pending'. Sitting at the head of the drain's fetch ordering (never-attempted →
-- capture_last_attempt_at NULL, so NULLS-FIRST puts them first) they filled the entire
-- limited candidate window, starving the untried backlog and stalling the drain at
-- zero captures (fix/preview-drain-stall-2 excludes covered rows in the SQL fetch).
--
-- These rows are genuinely complete (owned media present) so their terminal status is
-- 'captured'. Idempotent: the WHERE self-limits, so re-running is a no-op once clean.
UPDATE public.creatives
SET capture_status = 'captured'
WHERE capture_status = 'pending'
  AND (
    COALESCE(video_url, '')    LIKE '%/storage/v1/object/public/%'
    OR COALESCE(full_res_url, '') LIKE '%/storage/v1/object/public/%'
  );
