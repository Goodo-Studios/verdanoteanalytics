-- =============================================================================
-- Creative Intelligence (WS1 / US-012 rollout) — per-account opt-in flag
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- Mirrors ad_accounts.media_backfill_enabled (migration 20260717000004): a
-- controlled, widening rollout gate for the analyze-creative pipeline. Defaults
-- FALSE, so after this migration the flag-driven cron enqueues NOTHING until an
-- account is explicitly opted in — no surprise LLM spend across all ~30 accounts.
--
-- DEPENDENCY: only flag an account here once it is media_backfill_enabled AND its
-- media is actually cached — analyze-creative reads CACHED media (never Meta), so
-- an account without cached video degrades to thumbnail-only analysis (no
-- transcript / script embedding). Enable per account as its media lands:
--   UPDATE public.ad_accounts SET creative_analysis_enabled = true WHERE id = 'act_...';
-- =============================================================================

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS creative_analysis_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ad_accounts.creative_analysis_enabled IS
  'Opt-in gate for the analyze-creative pipeline (Creative Intelligence WS1). Only flagged accounts are drained by the flag-driven cron. Enable per account once media_backfill_enabled + media is cached, so video creatives have cached bytes to transcribe (analyze-creative never hits Meta).';

-- Pick the next flagged account with pending analysis work that is not already at
-- its budget cap. Drives the cron's flag-gated, one-account-at-a-time drain
-- (single-flight across accounts is enforced in the edge function). NULL = nothing
-- to do.
CREATE OR REPLACE FUNCTION public.next_creative_analysis_account()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
  FROM public.ad_accounts a
  WHERE a.creative_analysis_enabled
    -- has un-analyzed work
    AND EXISTS (
      SELECT 1 FROM public.creatives c
      WHERE c.account_id = a.id AND c.analysis_status = 'pending'
    )
    -- not already at/over its budget cap
    AND NOT EXISTS (
      SELECT 1 FROM public.creative_analysis_spend s
      WHERE s.account_id = a.id AND s.spent_usd >= s.cap_usd
    )
  ORDER BY a.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.next_creative_analysis_account() IS
  'Flag-driven selector for the analyze-creative cron: the next creative_analysis_enabled account with pending creatives that is under its creative_analysis_spend cap. NULL when nothing is eligible.';
