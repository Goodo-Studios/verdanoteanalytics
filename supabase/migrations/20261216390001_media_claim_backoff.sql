-- Audit 8.3: the media drain stops retrying failures instantly.
--
-- claim_media_cache_queue took pending rows oldest-first by enqueued_at with no "not
-- before" time. A failed row went back to 'pending' and was reclaimed by the very next
-- chain link (up to 100 links per run), and a rate-limited row had its attempt refunded,
-- so it could retry forever.
--
-- This adds media_cache_queue.next_attempt_at. drain-media-queue sets it on a failure
-- (5m, 15m, 1h, 4h) and on a rate limit (10m); the claim function skips a pending row
-- whose next_attempt_at is in the future. NULL means "due now", so existing rows and
-- rows inserted by sync are unaffected.

ALTER TABLE public.media_cache_queue
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

COMMENT ON COLUMN public.media_cache_queue.next_attempt_at IS
  'Audit 8.3: a pending row is not claimed before this time. Set by drain-media-queue after a failure or a rate limit; NULL means due now.';

CREATE OR REPLACE FUNCTION public.claim_media_cache_queue(p_limit INTEGER DEFAULT 5)
RETURNS SETOF public.media_cache_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT q.ad_id
    FROM public.media_cache_queue q
    WHERE (q.status = 'pending' AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= now()))
       OR (q.status = 'processing' AND q.updated_at < now() - INTERVAL '5 minutes')
    ORDER BY q.enqueued_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.media_cache_queue mq
  SET status = 'processing',
      attempts = mq.attempts + 1,
      updated_at = now()
  FROM claimable c
  WHERE mq.ad_id = c.ad_id
  RETURNING mq.*;
END;
$$;

COMMENT ON FUNCTION public.claim_media_cache_queue(INTEGER) IS
  'Atomically claim up to p_limit media_cache_queue rows for drain-media-queue. Picks pending rows that are due (next_attempt_at NULL or past, audit 8.3) OR processing rows stale > 5 min. FOR UPDATE SKIP LOCKED lets concurrent workers claim disjoint batches. Marks claimed rows processing, bumps attempts, returns them.';

-- CREATE OR REPLACE keeps grants; restated so the service-role-only rule is explicit.
REVOKE ALL ON FUNCTION public.claim_media_cache_queue(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_media_cache_queue(INTEGER) TO service_role;
