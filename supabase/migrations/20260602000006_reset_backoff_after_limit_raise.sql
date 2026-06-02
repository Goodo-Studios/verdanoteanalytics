-- Global storage upload limit raised 50MB→200MB. Clear the video-cache backoff on the
-- remaining un-cached CDN videos (they 413'd against the old 50MB cap and backed off)
-- so the maintenance cron streams them in immediately. Idempotent.
UPDATE creatives
SET video_retry_after = NULL, video_retry_count = 0
WHERE video_url IS NOT NULL
  AND video_url <> 'no-video'
  AND video_url NOT LIKE '%/storage/v1/object/public/%';
