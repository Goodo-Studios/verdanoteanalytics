-- Remove the last Coda pieces from the database.
--
-- Coda was retired on 2026-10-09 and ClickUp is the task system. The /pipeline
-- board reads pipeline_tasks (migration 20261109000001); nothing reads or writes
-- coda_tasks any more, and the sync-coda-tasks, sync-coda-names and
-- create-coda-brief functions are removed in the same change.
--
-- 1. Unschedule every Coda cron job by name. sync-coda-tasks-4h was already
--    unscheduled by 20261109000002; sync-coda-names-daily was still scheduled.
--    Both are removed here (idempotent).
-- 2. Drop coda_tasks, but only if nothing else in the database uses it: no
--    function body, no view, no foreign key. Otherwise stop with an error.
--
-- Kept on purpose: name_mappings (read by the tag resolver in sync, creatives
-- and backfill functions), sync_logs (shared by every sync), and
-- clients.origin = 'coda' (the dashboard client list, still read by the
-- dashboard staff functions).

do $$
declare
  r record;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    for r in
      select jobid from cron.job
       where jobname in ('sync-coda-tasks-4h', 'sync-coda-names-daily')
    loop
      perform cron.unschedule(r.jobid);
    end loop;
  end if;
end
$$;

do $$
declare
  n_refs integer;
begin
  if to_regclass('public.coda_tasks') is null then
    return;
  end if;

  select count(*) into n_refs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ilike '%coda_tasks%';
  select n_refs + count(*) into n_refs
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
   where d.refobjid = 'public.coda_tasks'::regclass
     and r.ev_class <> 'public.coda_tasks'::regclass;
  select n_refs + count(*) into n_refs
    from pg_constraint c
   where c.confrelid = 'public.coda_tasks'::regclass;
  if n_refs > 0 then
    raise exception 'coda_tasks is still referenced (% object(s)); not dropping it.', n_refs;
  end if;

  drop table public.coda_tasks;
end
$$;
