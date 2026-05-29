-- Media self-healing: per-creative retry/backoff bookkeeping.
--
-- Why: the media pipeline (enrich-thumbnails + refresh-thumbnails) marks a creative
-- with a sentinel (`no-thumbnail` / `no-video`) the first time discovery fails. Before
-- this migration, a sentinel was only ever re-attempted on a first sync or after a
-- 7-day staleness window, and only for creatives above hard spend/impression thresholds.
-- A transient Meta hiccup on a low-spend creative therefore became a PERMANENT broken
-- card, and a genuinely dead creative got re-hammered every rotation (wasting Meta budget).
--
-- These columns let the pipeline retry EVERY transient failure with exponential backoff
-- (1h → 4h → 12h → 24h → 3d → 7d cap) and stop hammering rows that are still in their
-- backoff window — true "no permanent failure point" without re-discovering the world.

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS thumb_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS thumb_retry_after timestamptz,
  ADD COLUMN IF NOT EXISTS video_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_retry_after timestamptz;

-- Partial indexes: the rotation only ever scans sentinel rows whose backoff window is
-- due, so index exactly those hot subsets (keeps the index tiny vs. the full table).
CREATE INDEX IF NOT EXISTS idx_creatives_thumb_retry_due
  ON public.creatives (thumb_retry_after)
  WHERE thumbnail_url = 'no-thumbnail';

CREATE INDEX IF NOT EXISTS idx_creatives_video_retry_due
  ON public.creatives (video_retry_after)
  WHERE video_url = 'no-video';
