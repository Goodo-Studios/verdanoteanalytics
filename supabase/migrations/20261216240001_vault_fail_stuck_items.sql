-- Vault items stuck in a processing state are marked as errors (audit plan item 4.4).
--
-- When a hand-off between Vault functions was lost, an item stayed at pending / extracting /
-- transcribing / analyzing forever: a spinner with no way out. Production on 2026-11-15
-- (read-only check) had none stuck, but nothing stopped it happening.
--
-- 1. inspiration_items.status_changed_at, kept current by a trigger whenever status changes.
--    Existing rows start at created_at.
-- 2. fail_stuck_vault_items(older_than): moves items that have sat in a processing state past the
--    limit to 'error' with a message naming the step. The item page already shows errors and
--    offers Re-analyze, so the user retries by hand. It does not retry on its own: each retry
--    spends transcription and analysis budget, and a step that timed out once usually needs a
--    person to look. Returns the number of items it marked.
-- 3. A pg_cron job runs it every 10 minutes with a 60 minute limit. Pure SQL, no HTTP call, so it
--    is safe in any environment; scripts/staging-lockdown.sql removes it on staging like every job.
--
-- Rollback: select cron.unschedule('vault-fail-stuck-items');
--           drop function public.fail_stuck_vault_items(interval);
--           drop trigger inspiration_items_status_changed_at on public.inspiration_items;
--           drop function public.inspiration_items_touch_status_changed_at();
--           alter table public.inspiration_items drop column status_changed_at;

alter table public.inspiration_items
  add column if not exists status_changed_at timestamptz;

update public.inspiration_items set status_changed_at = created_at where status_changed_at is null;

alter table public.inspiration_items
  alter column status_changed_at set default now(),
  alter column status_changed_at set not null;

create or replace function public.inspiration_items_touch_status_changed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists inspiration_items_status_changed_at on public.inspiration_items;
create trigger inspiration_items_status_changed_at
  before insert or update of status on public.inspiration_items
  for each row execute function public.inspiration_items_touch_status_changed_at();

create index if not exists inspiration_items_processing_since_idx
  on public.inspiration_items (status_changed_at)
  where status in ('pending', 'extracting', 'transcribing', 'analyzing');

create or replace function public.fail_stuck_vault_items(p_older_than interval default interval '60 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.inspiration_items
     set status = 'error',
         error_message = 'Timed out while ' || status || ' (no progress for '
           || p_older_than::text || '). Use Re-analyze to try again.'
   where status in ('pending', 'extracting', 'transcribing', 'analyzing')
     and status_changed_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.fail_stuck_vault_items(interval) from public;
revoke execute on function public.fail_stuck_vault_items(interval) from anon;
revoke execute on function public.fail_stuck_vault_items(interval) from authenticated;
grant execute on function public.fail_stuck_vault_items(interval) to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'vault-fail-stuck-items' loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'vault-fail-stuck-items',
  '*/10 * * * *',
  $$ select public.fail_stuck_vault_items(interval '60 minutes') $$
);

-- Verify after applying:
--   select jobname, schedule, active from cron.job where jobname = 'vault-fail-stuck-items';
--   select status, count(*) from public.inspiration_items group by status;
