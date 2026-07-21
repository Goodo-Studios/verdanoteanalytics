-- =============================================================================
-- Creative Intelligence (WS1 / US-002 hardening) — self-heal stuck 'analyzing'
-- =============================================================================
-- Placeholder prefix. Idempotent (CREATE OR REPLACE, same signature).
--
-- If an analyze-creative invocation dies mid-batch (edge timeout, OOM), the rows
-- it claimed stay analysis_status='analyzing' forever — the old claim only took
-- 'pending', so they were never retried (mirrors the media-queue stuck-row
-- problem cleanup-stuck-media solves). This replaces claim_creatives_for_analysis
-- so each claim ALSO reclaims rows stuck in 'analyzing' for >15 min, making the
-- drain self-healing without a separate cleanup function.
-- =============================================================================

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
          -- self-heal: a row stuck 'analyzing' past the staleness window (a dead
          -- prior invocation) is eligible to be re-claimed.
          or (c2.analysis_status = 'analyzing' and c2.updated_at < now() - interval '15 minutes')
        )
      order by coalesce(c2.spend, 0) desc, c2.created_at desc
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning c.*;
end;
$$;
