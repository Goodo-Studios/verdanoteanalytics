-- Goodo OS story OS-023: an export checklist that can stand in for the four export statuses, and
-- scorecard numbers calculated from status history.
--
-- No status is removed. The editors have not agreed yet, so the setting
-- export_checklist_replaces_statuses is false and the app keeps showing the four statuses as now.
--
--   os_settings                     key -> jsonb value. Staff read; builder changes. Seeded with
--                                   export_checklist_replaces_statuses = false.
--   os_export_checklist_template    the four export statuses and the checklist item that stands in
--                                   for each, in order. Staff read.
--   os_task_checklist_items         checklist items per task. Staff read, add, tick and remove.
--                                   Clients and anon see nothing (row rules and no grants).
--   os_task_checklist_start(task)   staff: adds the template items to a task that has none.
--   os_scorecard(month)             staff: scorecard numbers for one month, per client and a total
--                                   row (is_total true), calculated from os_task_status_history.
--                                   Anyone else gets no rows.
--
-- Tests: supabase/tests/os_export_checklist_scorecard_test.sql.

-- ------------------------------------------------------------------ settings

create table public.os_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,80}$'),
  value jsonb not null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.os_settings is 'Goodo OS switches (OS-023). Staff read; builder changes.';

create trigger update_os_settings_updated_at before update on public.os_settings
  for each row execute function public.update_updated_at_column();

insert into public.os_settings (key, value) values ('export_checklist_replaces_statuses', 'false'::jsonb);

alter table public.os_settings enable row level security;
revoke all on table public.os_settings from public, anon, authenticated;
grant select, update on table public.os_settings to authenticated;
grant all on table public.os_settings to service_role;

create policy "Staff can read os_settings" on public.os_settings
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder can change os_settings" on public.os_settings
  for update to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

-- ------------------------------------------------------------------ checklist template

create table public.os_export_checklist_template (
  status text primary key references public.os_task_statuses(status) on update cascade,
  label text not null check (length(btrim(label)) between 1 and 120),
  position integer not null unique
);

comment on table public.os_export_checklist_template is
  'The four export statuses and the checklist item that stands in for each (OS-023).';

insert into public.os_export_checklist_template (status, label, position) values
  ('export versions', 'Export every version and size', 10),
  ('versions exported', 'Check and upload the exports', 20),
  ('ready to send to client', 'Send the cut to the client', 30),
  ('ready to transfer', 'Transfer the files to the ad account', 40);

alter table public.os_export_checklist_template enable row level security;
revoke all on table public.os_export_checklist_template from public, anon, authenticated;
grant select on table public.os_export_checklist_template to authenticated;
grant all on table public.os_export_checklist_template to service_role;

create policy "Staff can read os_export_checklist_template" on public.os_export_checklist_template
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ checklist items

create table public.os_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.os_tasks(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 120),
  position integer not null default 0,
  done boolean not null default false,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index os_task_checklist_items_task_idx on public.os_task_checklist_items (task_id, position);

comment on table public.os_task_checklist_items is
  'Checklist items per task (OS-023). Staff only; clients never see them.';

-- Who ticked it and when follow the done flag.
create or replace function public.os_task_checklist_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not new.done then
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.os_task_checklist_stamp() from public, anon, authenticated;

create trigger os_task_checklist_stamp before insert or update on public.os_task_checklist_items
  for each row execute function public.os_task_checklist_stamp();

alter table public.os_task_checklist_items enable row level security;
revoke all on table public.os_task_checklist_items from public, anon, authenticated;
grant select, insert, update, delete on table public.os_task_checklist_items to authenticated;
grant all on table public.os_task_checklist_items to service_role;

create policy "Staff can read os_task_checklist_items" on public.os_task_checklist_items
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can add os_task_checklist_items" on public.os_task_checklist_items
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can update os_task_checklist_items" on public.os_task_checklist_items
  for update to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can remove os_task_checklist_items" on public.os_task_checklist_items
  for delete to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- Adds the template items to a task with no checklist yet. Returns how many were added.
-- Runs as the caller, so the row rules decide (a client adds nothing and gets an error).
create or replace function public.os_task_checklist_start(p_task_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_added integer;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if exists (select 1 from public.os_task_checklist_items where task_id = p_task_id) then
    return 0;
  end if;
  insert into public.os_task_checklist_items (task_id, label, position)
  select p_task_id, t.label, t.position from public.os_export_checklist_template t order by t.position;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function public.os_task_checklist_start(uuid) from public, anon;
grant execute on function public.os_task_checklist_start(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ scorecard

-- One month of scorecard numbers from status history, per client and a total row (is_total
-- true; client_slug null on a client row means tasks with no client). A milestone counts in the month its first arrival falls in (UTC); on time means that
-- arrival date is on or before the task's ClickUp date for it (tasks with no date are not timed).
--   briefs_done            first reach of client brief review
--   briefs_on_time         ... on or before brief_due_date
--   cuts_to_strategist     first reach of internal review
--   cuts_to_strategist_on_time  ... on or before cut_to_strategist_date
--   cuts_to_client         first reach of ready to send to client or client review
--   cuts_to_client_on_time ... on or before cut_to_client_date
--   internal_revisions     moves into internal review edits in the month
--   client_revisions       moves into client revisions in the month
--   completed              moves into complete in the month
-- Runs as the caller: the row rules on os_tasks and the history apply, and non-staff get nothing.
create or replace function public.os_scorecard(p_month date)
returns table (
  is_total boolean,
  client_slug text,
  briefs_done integer,
  briefs_on_time integer,
  cuts_to_strategist integer,
  cuts_to_strategist_on_time integer,
  cuts_to_client integer,
  cuts_to_client_on_time integer,
  internal_revisions integer,
  client_revisions integer,
  completed integer
)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date as m0,
           (date_trunc('month', p_month) + interval '1 month')::date as m1
  ),
  staff as (
    select public.has_role(auth.uid(), 'builder'::public.app_role)
        or public.has_role(auth.uid(), 'employee'::public.app_role)
        or coalesce(auth.role(), '') = 'service_role'
        or current_user in ('service_role', 'postgres') as ok
  ),
  firsts as (
    select h.task_id, m.milestone, min(h.changed_at) as first_at
      from public.os_task_status_history h
      join public.os_task_milestone_statuses m on m.status = h.to_status
     group by h.task_id, m.milestone
  ),
  ms as (
    select t.client_slug, f.milestone, (f.first_at at time zone 'UTC')::date as d,
           case f.milestone when 'brief_due' then t.brief_due_date
                            when 'cut_to_strategist' then t.cut_to_strategist_date
                            else t.cut_to_client_date end as target
      from firsts f
      join public.os_tasks t on t.id = f.task_id, bounds b
     where f.first_at >= b.m0 and f.first_at < b.m1
  ),
  moves as (
    select t.client_slug, h.to_status
      from public.os_task_status_history h
      join public.os_tasks t on t.id = h.task_id, bounds b
     where h.changed_at >= b.m0 and h.changed_at < b.m1
       and h.from_status is distinct from h.to_status
       and h.to_status in ('internal review edits', 'client revisions', 'complete')
  ),
  agg as (
    select client_slug,
           count(*) filter (where milestone = 'brief_due') as bd,
           count(*) filter (where milestone = 'brief_due' and target is not null and d <= target) as bdo,
           count(*) filter (where milestone = 'cut_to_strategist') as cs,
           count(*) filter (where milestone = 'cut_to_strategist' and target is not null and d <= target) as cso,
           count(*) filter (where milestone = 'cut_to_client') as cc,
           count(*) filter (where milestone = 'cut_to_client' and target is not null and d <= target) as cco,
           0::bigint as ir, 0::bigint as cr, 0::bigint as done
      from ms group by client_slug
    union all
    select client_slug, 0, 0, 0, 0, 0, 0,
           count(*) filter (where to_status = 'internal review edits'),
           count(*) filter (where to_status = 'client revisions'),
           count(*) filter (where to_status = 'complete')
      from moves group by client_slug
  )
  select grouping(r.client_slug) = 1, case when grouping(r.client_slug) = 1 then null else r.client_slug end,
         sum(bd)::int, sum(bdo)::int, sum(cs)::int, sum(cso)::int, sum(cc)::int, sum(cco)::int,
         sum(ir)::int, sum(cr)::int, sum(done)::int
    from agg r, staff s
   where s.ok
   group by grouping sets ((r.client_slug), ())
   order by grouping(r.client_slug), r.client_slug nulls last;
$$;

revoke all on function public.os_scorecard(date) from public, anon;
grant execute on function public.os_scorecard(date) to authenticated, service_role;
