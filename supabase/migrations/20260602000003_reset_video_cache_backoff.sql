-- One-off: clear the video-cache retry backoff for all not-yet-cached CDN videos.
-- The project storage upload limit (spend cap) was rejecting 50-64MB videos, which
-- got backed off (video_retry_after up to 7d out). The cap is now lifted, so make
-- them immediately eligible for the fan-out cache cron instead of waiting out the
-- backoff. Idempotent: rows already cached (storage url) or sentineled don't match.
UPDATE creatives
SET video_retry_after = NULL
WHERE video_url IS NOT NULL
  AND video_url <> 'no-video'
  AND video_url NOT LIKE '%/storage/v1/object/public/%';
