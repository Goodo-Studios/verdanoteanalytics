-- =============================================================================
-- Make video_permission RE-CACHEABLE (self-heal the page-owned-video backlog)
-- =============================================================================
-- Idempotent + additive (CREATE OR REPLACE only). Manual `supabase db push --linked`.
--
-- Context: page-owned video (organic Page posts boosted into ads) used to be
-- unresolvable on our account/system-user token, so it was stamped the TERMINAL
-- 'no-video-permission' sentinel and EXCLUDED from the self-heal feeder
-- (enqueue_media_refresh_candidates, migration 20260714000028) — it was never
-- re-enqueued. With Page access tokens (resolve source via the owning Page's token
-- once that Page is assigned to us in Business Manager), that media is now
-- resolvable. So 'video_permission' is reclassified from terminal → RE-CACHEABLE:
-- the feeder re-enqueues it, the drain re-discovers it (page-token path), and the
-- pre-existing backlog self-heals as pages get assigned. Accounts whose Page is
-- still unassigned simply re-fail and back off (bounded by retry_after) — never
-- nulling stored media. TS mirror: _shared/media-refresh-logic.ts.
--
-- The ONLY change vs 20260714000028 is adding 'video_permission' to the
-- re-cacheable failure_reason IN-list; everything else is byte-identical.
-- =============================================================================

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
  v_enqueued  integer := 0;
BEGIN
  WITH candidates AS (
    SELECT c.ad_id, c.account_id
    FROM public.media_coverage mc
    JOIN public.creatives c ON c.ad_id = mc.ad_id
    WHERE NOT mc.covered
      -- Only RE-CACHEABLE rot; never the terminal residual (video_deleted) or a
      -- frames gap. video_permission is now recoverable via Page tokens (self-heals
      -- when the owning Page is assigned to us), so it is included here.
      AND mc.failure_reason IN (
        'video_uncached', 'image_low_res', 'image_missing', 'video_unresolved', 'video_permission'
      )
      -- Respect the existing exponential backoff (AC#3): skip an ad still inside its
      -- image OR video backoff window. NULL retry_after = due now (never/last cleared).
      AND (c.thumb_retry_after IS NULL OR c.thumb_retry_after <= v_now)
      AND (c.video_retry_after IS NULL OR c.video_retry_after <= v_now)
    -- OLDEST-UNVERIFIED FIRST (AC#1): never-checked (NULL) ahead of least-recently
    -- checked. Deterministic tiebreak on ad_id so paging is stable across polls.
    ORDER BY c.media_last_refresh_at ASC NULLS FIRST, c.ad_id ASC
    LIMIT GREATEST(p_limit, 0)
  ),
  enqueue AS (
    INSERT INTO public.media_cache_queue (ad_id, account_id, status, attempts, enqueued_at, updated_at)
    SELECT cand.ad_id, cand.account_id, 'pending', 0, v_now, v_now
    FROM candidates cand
    ON CONFLICT (ad_id) DO UPDATE
      SET status      = 'pending',
          attempts    = 0,
          enqueued_at  = v_now,
          updated_at   = v_now,
          last_error   = NULL
      -- Re-arm ONLY a settled row (done/failed) — never disturb an in-flight
      -- pending/processing claim. This is what makes failed items retried (AC#3)
      -- without double-processing an ad the drain worker already holds.
      WHERE public.media_cache_queue.status IN ('done', 'failed')
    RETURNING ad_id
  ),
  stamp AS (
    -- Stamp the verification clock on EVERY candidate we considered enqueuing (even
    -- one whose queue row was left in-flight), so the poller advances past them and
    -- pages to the next oldest batch on the following poll rather than re-picking.
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
  'Bounded, prioritized self-healing feeder for media_cache_queue. Picks up to p_limit eligible-but-not-covered ads with a RE-CACHEABLE failure_reason (video_uncached / image_low_res / image_missing / video_unresolved / video_permission — NOT terminal video_deleted nor frames_incomplete), OLDEST-UNVERIFIED FIRST (creatives.media_last_refresh_at ASC NULLS FIRST), honoring exponential backoff (thumb_retry_after/video_retry_after), and (re-)enqueues them for the drain-media-queue worker. video_permission is re-cacheable as of 20260717000001 (Page-token resolution of page-owned video). Re-arms only settled (done/failed) queue rows; never disturbs an in-flight claim. Stamps media_last_refresh_at so paging advances.';
