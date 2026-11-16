-- Audit 8.1: the media refresh feeder stops re-enqueueing ads the drain gave up on.
--
-- Before: enqueue_media_refresh_candidates reset attempts = 0 on every re-enqueue of a
-- 'done' or 'failed' queue row and ignored p_max_attempts. An ad the drain marked
-- 'failed' after MAX_ATTEMPTS was back in the queue on the next 15-minute tick, forever.
--
-- After:
--   * a 'done' row (the last drain finished normally) is re-enqueued from zero, as before;
--   * a 'failed' row is re-enqueued only when it has fewer than p_max_attempts attempts,
--     or when it gave up more than 7 days ago (one fresh round per week, matching the
--     longest per-path backoff, so a permission-blocked video still heals once the Page
--     is assigned);
--   * ads that are not eligible are left out of the candidate list, so they no longer
--     take batch slots or get their media_last_refresh_at stamped.
-- The drain now writes thumb_/video_retry_after (same release), which the feeder
-- already honours.
--
-- Same signature, so existing grants are kept.

CREATE OR REPLACE FUNCTION public.enqueue_media_refresh_candidates(
  p_limit         integer DEFAULT 100,
  p_max_attempts  integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now       timestamptz := now();
  v_retry_gap interval    := interval '7 days';
  v_enqueued  integer := 0;
BEGIN
  WITH candidates AS (
    SELECT c.ad_id, c.account_id
    FROM public.media_coverage mc
    JOIN public.creatives c ON c.ad_id = mc.ad_id
    LEFT JOIN public.media_cache_queue q ON q.ad_id = c.ad_id
    WHERE NOT mc.covered
      AND mc.failure_reason IN (
        'video_uncached', 'image_low_res', 'image_missing', 'video_unresolved',
        'video_permission', 'frames_incomplete'
      )
      AND EXISTS (
        SELECT 1 FROM public.ad_accounts a
        WHERE a.id = c.account_id AND a.media_backfill_enabled
      )
      AND (c.thumb_retry_after  IS NULL OR c.thumb_retry_after  <= v_now)
      AND (c.video_retry_after  IS NULL OR c.video_retry_after  <= v_now)
      AND (c.frames_retry_after IS NULL OR c.frames_retry_after <= v_now)
      AND (
        q.ad_id IS NULL
        OR q.status = 'done'
        OR (q.status = 'failed'
            AND (q.attempts < p_max_attempts OR q.updated_at <= v_now - v_retry_gap))
      )
    ORDER BY c.media_last_refresh_at ASC NULLS FIRST, c.ad_id ASC
    LIMIT GREATEST(p_limit, 0)
  ),
  enqueue AS (
    INSERT INTO public.media_cache_queue (ad_id, account_id, status, attempts, enqueued_at, updated_at)
    SELECT cand.ad_id, cand.account_id, 'pending', 0, v_now, v_now
    FROM candidates cand
    ON CONFLICT (ad_id) DO UPDATE
      SET status = 'pending',
          -- A finished row, or a failed one past the weekly retry gap, starts a fresh
          -- round. A failed row still under its limit keeps its attempts.
          attempts = CASE
            WHEN public.media_cache_queue.status = 'done' THEN 0
            WHEN public.media_cache_queue.attempts >= p_max_attempts THEN 0
            ELSE public.media_cache_queue.attempts
          END,
          enqueued_at = v_now, updated_at = v_now, last_error = NULL
      WHERE public.media_cache_queue.status = 'done'
         OR (public.media_cache_queue.status = 'failed'
             AND (public.media_cache_queue.attempts < p_max_attempts
                  OR public.media_cache_queue.updated_at <= v_now - v_retry_gap))
    RETURNING ad_id
  ),
  stamp AS (
    UPDATE public.creatives c
    SET media_last_refresh_at = v_now
    FROM candidates cand
    WHERE c.ad_id = cand.ad_id
    RETURNING c.ad_id
  )
  SELECT COUNT(*) INTO v_enqueued FROM stamp;
  RETURN COALESCE(v_enqueued, 0);
END;
$$;

COMMENT ON FUNCTION public.enqueue_media_refresh_candidates(integer, integer) IS
  'Bounded, prioritized self-healing feeder for media_cache_queue. Enqueues not-covered ads with a RE-CACHEABLE failure_reason, scoped to ad_accounts.media_backfill_enabled, oldest-unverified first, honoring thumb_/video_/frames_retry_after backoff. Audit 8.1 (20261216380001): a failed queue row is re-enqueued only under p_max_attempts or after a 7-day gap; attempts are no longer reset on every tick.';
