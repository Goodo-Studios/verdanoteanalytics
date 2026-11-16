-- Audit 8.6 (part 1): analysis retries are capped.
--
-- analyze-creative recycles a timed-out item to 'pending' with no attempt limit, and
-- claim_creatives_for_analysis reclaims an orphaned 'analyzing' row with no limit either.
-- A creative that always times out was therefore claimed, and paid for, forever.
--
-- This adds creatives.analysis_attempts. The claim counts one attempt per claim. A
-- creative that is claimable (pending, or a stale 'analyzing' orphan) and has already used
-- 3 attempts is marked 'failed' instead of claimed, so it stops counting as work for the
-- account selector and the self-chain. A live 'analyzing' row is never touched.
-- A trigger resets the count to 0 whenever a creative moves to 'pending' from anything
-- other than 'analyzing' (force re-queue, the re-analyze button, new media from
-- preview-capture), so a deliberate re-analysis starts fresh. The drain's own
-- analyzing-to-pending recycle keeps counting.
--
-- Signature, ordering, the 4-minute orphan window and SKIP LOCKED are unchanged
-- (20260723000002). CREATE OR REPLACE keeps grants.

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS analysis_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.creatives.analysis_attempts IS
  'Audit 8.6: analysis claims since the last success or forced re-queue. claim_creatives_for_analysis marks a creative failed once it reaches 3.';

CREATE OR REPLACE FUNCTION public.claim_creatives_for_analysis(
  p_account_id text,
  p_limit      int default 25
) RETURNS SETOF public.creatives
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_attempts constant int := 3;
BEGIN
  -- Give up on claimable creatives that have used every attempt.
  UPDATE public.creatives c
     SET analysis_status = 'failed'
   WHERE c.account_id = p_account_id
     AND c.analysis_attempts >= v_max_attempts
     AND (
       c.analysis_status = 'pending'
       OR (c.analysis_status = 'analyzing' AND c.updated_at < now() - interval '4 minutes')
     );

  RETURN QUERY
  UPDATE public.creatives c
     SET analysis_status   = 'analyzing',
         analysis_attempts = c.analysis_attempts + 1,
         updated_at        = now()
   WHERE c.ad_id IN (
     SELECT c2.ad_id
       FROM public.creatives c2
      WHERE c2.account_id = p_account_id
        AND c2.analysis_attempts < v_max_attempts
        AND (
          c2.analysis_status = 'pending'
          -- self-heal: a row stuck 'analyzing' past the staleness window is an orphan
          -- from a dead invocation, eligible to re-claim.
          OR (c2.analysis_status = 'analyzing' AND c2.updated_at < now() - interval '4 minutes')
        )
      -- Recover orphans first, then spend-first within each group.
      ORDER BY (CASE WHEN c2.analysis_status = 'analyzing' THEN 0 ELSE 1 END),
               COALESCE(c2.spend, 0) DESC,
               c2.created_at DESC
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
END;
$$;

-- Reset attempts on a deliberate re-queue. The WHEN clause keeps this off the hot path:
-- the function only runs for rows whose analysis_status actually changes to 'pending'.
CREATE OR REPLACE FUNCTION public.reset_analysis_attempts_on_requeue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.analysis_status IS DISTINCT FROM 'analyzing' THEN
    NEW.analysis_attempts := 0;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_analysis_attempts_on_requeue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reset_analysis_attempts_on_requeue ON public.creatives;
CREATE TRIGGER reset_analysis_attempts_on_requeue
  BEFORE UPDATE OF analysis_status ON public.creatives
  FOR EACH ROW
  WHEN (NEW.analysis_status = 'pending' AND OLD.analysis_status IS DISTINCT FROM NEW.analysis_status)
  EXECUTE FUNCTION public.reset_analysis_attempts_on_requeue();
