-- =============================================================================
-- Scope the self-heal feeder to accounts flagged media_backfill_enabled
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- Why: re-enabling the crons flooded media_cache_queue with the backlog of ALL ~30
-- ad accounts, but page-owned video only resolves for accounts whose Facebook Page
-- is assigned to our system user (currently ~2). The drain then burned Meta rate
-- budget on unresolvable ads and throttled. This adds a per-account opt-in flag so
-- the feeder ONLY enqueues accounts we can actually resolve today. Flip the flag on
-- per client as their Page assignment lands — a controlled, widening rollout.
--
-- Defaults false: after this migration the feeder enqueues NOTHING until an account
-- is explicitly flagged (safe — no flood). Enable per account with:
--   UPDATE public.ad_accounts SET media_backfill_enabled = true WHERE id = 'act_...';
-- =============================================================================

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS media_backfill_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ad_accounts.media_backfill_enabled IS
  'Opt-in gate for the media self-heal feeder (enqueue_media_refresh_candidates). Only flagged accounts are enqueued for backlog re-caching, so the drain is not flooded with accounts whose Facebook Page is not yet assigned to us (unresolvable page-owned video). Flip true per account as its Page assignment lands.';

-- Redefine the feeder to additionally require media_backfill_enabled. Only change vs
-- 20260717000001 is the new EXISTS(ad_accounts … media_backfill_enabled) predicate.
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
      -- Only RE-CACHEABLE rot; never terminal (video_deleted) or a frames gap.
      -- video_permission is recoverable via Page tokens (20260717000001).
      AND mc.failure_reason IN (
        'video_uncached', 'image_low_res', 'image_missing', 'video_unresolved', 'video_permission'
      )
      -- Scope: only accounts opted into media backfill (Page assigned / resolvable).
      AND EXISTS (
        SELECT 1 FROM public.ad_accounts a
        WHERE a.id = c.account_id AND a.media_backfill_enabled
      )
      -- Respect the existing exponential backoff: skip an ad still inside its image
      -- OR video backoff window. NULL retry_after = due now (never/last cleared).
      AND (c.thumb_retry_after IS NULL OR c.thumb_retry_after <= v_now)
      AND (c.video_retry_after IS NULL OR c.video_retry_after <= v_now)
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
      WHERE public.media_cache_queue.status IN ('done', 'failed')
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
  'Bounded, prioritized self-healing feeder for media_cache_queue. Enqueues eligible-but-not-covered ads with a RE-CACHEABLE failure_reason (video_uncached / image_low_res / image_missing / video_unresolved / video_permission), SCOPED to accounts with ad_accounts.media_backfill_enabled = true (20260717000004), OLDEST-UNVERIFIED FIRST, honoring exponential backoff. Re-arms only settled (done/failed) queue rows; never disturbs an in-flight claim.';
