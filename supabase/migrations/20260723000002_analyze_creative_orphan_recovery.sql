-- =============================================================================
-- Creative Intelligence (WS1) — recover orphaned 'analyzing' rows fast
-- =============================================================================
-- Idempotent (CREATE OR REPLACE, identical signatures). Manual `supabase db push`.
-- Numbered off the remote frontier (last applied: 20260723000001).
--
-- SYMPTOM: on the video-heavy backlog remainder the drain slowed to ~200/hr with
-- ~50 rows piled in analysis_status='analyzing' while few completed. Evidence
-- (2026-07-23): of 49 'analyzing' rows only 1 was <3 min old, 45 sat in a 3–15
-- min blind spot, and 3 were >15 min; the oldest was 47 min old. Deepgram was
-- fast (~1.5s) — the rows were ORPHANS from invocations killed mid-batch (a slow
-- tail item pushed a run past the ~150s edge wall), NOT slow live work.
--
-- Two RPC bugs kept orphans from ever recovering:
--   1. next_creative_analysis_account only considered accounts with a 'pending'
--      row. An account drained to pending=0 but left with stuck 'analyzing'
--      orphans was NEVER selected, so claim_creatives_for_analysis never ran for
--      it and its orphans were reclaimed NEVER (the 47-/32-min rows sat on
--      pending=0 accounts).
--   2. claim_creatives_for_analysis used a 15-min stale window AND ordered the
--      reclaim candidates LAST (spend desc, created_at desc over thousands of
--      pending rows), so even on an active account orphans were starved out of
--      the limited claim window.
--
-- FIX (preserves FOR UPDATE SKIP LOCKED claim atomicity, single-flight, the
-- $/account cap, the model lock and Deepgram-first transcription — none touched):
--   • Shorten the stale-'analyzing' reclaim window 15 min → 4 min. The edge
--     function now bounds every item with a ~45s per-ITEM deadline (recycling a
--     slow item to 'pending'), so no LIVE item is ever 'analyzing' for >~1 min —
--     4 min safely reclaims only genuine orphans, never an in-flight row, so
--     there is no new double-analysis risk.
--   • Order reclaim-eligible ('analyzing') rows FIRST in the claim so orphans are
--     recovered ahead of fresh pending work instead of being starved.
--   • next_creative_analysis_account also selects accounts that have stale
--     'analyzing' orphans (>4 min), so a drained-but-orphaned account is
--     re-targeted and healed even with pending=0.
-- =============================================================================

-- ── Claim: reclaim orphans at 4 min, reclaim-first ordering ───────────────────
create or replace function public.claim_creatives_for_analysis(
  p_account_id text,
  p_limit      int default 25
) returns setof public.creatives
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.creatives c
     set analysis_status = 'analyzing',
         updated_at      = now()
   where c.ad_id in (
     select c2.ad_id
       from public.creatives c2
      where c2.account_id = p_account_id
        and (
          c2.analysis_status = 'pending'
          -- self-heal: a row stuck 'analyzing' past the (shortened) staleness
          -- window is an orphan from a dead invocation — eligible to re-claim.
          or (c2.analysis_status = 'analyzing' and c2.updated_at < now() - interval '4 minutes')
        )
      -- Recover orphans FIRST (reclaim-eligible 'analyzing' before fresh
      -- 'pending'), then spend-first within each group. Without this, orphans
      -- ranked below thousands of pending rows and never made the claim window.
      order by (case when c2.analysis_status = 'analyzing' then 0 else 1 end),
               coalesce(c2.spend, 0) desc,
               c2.created_at desc
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning c.*;
end;
$$;

-- ── Selector: also target accounts that have only stale orphans left ───────────
create or replace function public.next_creative_analysis_account()
returns text
language sql
stable
security definer
set search_path = public
as $$
  SELECT a.id
  FROM public.ad_accounts a
  WHERE a.creative_analysis_enabled
    -- has un-analyzed work: fresh pending OR a stale 'analyzing' orphan to heal.
    AND EXISTS (
      SELECT 1 FROM public.creatives c
      WHERE c.account_id = a.id
        AND (
          c.analysis_status = 'pending'
          OR (c.analysis_status = 'analyzing' AND c.updated_at < now() - interval '4 minutes')
        )
    )
    -- not already at/over its budget cap
    AND NOT EXISTS (
      SELECT 1 FROM public.creative_analysis_spend s
      WHERE s.account_id = a.id AND s.spent_usd >= s.cap_usd
    )
  ORDER BY a.id
  LIMIT 1;
$$;

-- ── Verify (run manually after push) ──────────────────────────────────────────
--   -- orphans older than the window should recycle within a couple of drain runs:
--   SELECT analysis_status, count(*),
--          count(*) FILTER (WHERE updated_at < now() - interval '4 minutes') AS stale
--   FROM public.creatives GROUP BY 1;
