-- Final one-off backoff clear. Videos that failed to cache during the transition
-- (before streaming upload + the spend-cap lift) backed off for up to 7h. Streaming
-- now caches them up to 200MB, so clear the backoff once more to let the maintenance
-- cron stream them in immediately. Idempotent: cached (storage url) / sentinel rows
-- don't match.
UPDATE creatives
SET video_retry_after = NULL, video_retry_count = 0
WHERE video_url IS NOT NULL
  AND video_url <> 'no-video'
  AND video_url NOT LIKE '%/storage/v1/object/public/%';
