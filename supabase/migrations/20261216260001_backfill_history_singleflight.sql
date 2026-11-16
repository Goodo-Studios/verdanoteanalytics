-- One history backfill run at a time (audit plan item 8.2, shipped with 5.3).
--
-- backfill-daily-history self-chained after every unfinished run with no depth limit, and the
-- 20-minute cron (backfill-daily-history-20min) started new chains while one was still running,
-- so chains stacked up against the Meta rate limit. The function now claims this single-row
-- lock on a fresh run (chain 0) and skips when it is held; chain links are the same flight and
-- do not claim; the last link releases it. A lock older than the stale window (900 seconds in
-- the function) is reclaimed, so a crashed run cannot block the backfill.
--
-- Mirrors apify_drain_state (20260722000006).
--
-- Rollback: drop function public.release_backfill_history_singleflight();
--           drop function public.claim_backfill_history_singleflight(integer);
--           drop table public.backfill_history_state;

create table if not exists public.backfill_history_state (
  id            boolean primary key default true check (id),
  running_since timestamptz
);
insert into public.backfill_history_state (id, running_since)
  values (true, null)
  on conflict (id) do nothing;

alter table public.backfill_history_state enable row level security;
-- Service role only (bypasses RLS); no policies.

create or replace function public.claim_backfill_history_singleflight(p_stale_seconds integer default 900)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.backfill_history_state
     set running_since = now()
   where id = true
     and (running_since is null or running_since < now() - make_interval(secs => p_stale_seconds))
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.release_backfill_history_singleflight()
returns void
language sql
security definer
set search_path = public
as $$
  update public.backfill_history_state set running_since = null where id = true;
$$;

revoke execute on function public.claim_backfill_history_singleflight(integer) from public, anon, authenticated;
revoke execute on function public.release_backfill_history_singleflight() from public, anon, authenticated;
grant execute on function public.claim_backfill_history_singleflight(integer) to service_role;
grant execute on function public.release_backfill_history_singleflight() to service_role;
