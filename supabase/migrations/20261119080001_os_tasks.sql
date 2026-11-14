-- Goodo OS story OS-006: the native task table with status history.
--
--   os_task_statuses          the allowed statuses, in workflow order. Seeded with the ClickUp
--                             statuses the sync already knows (_shared/clickup-pipeline.ts
--                             STAGE_MAP). This mirrors ClickUp; it does not change the workflow.
--   os_tasks                  one row per piece of work: title, client, type, status, due date,
--                             strategist, producer, editor, content type, cycle month, brief,
--                             asset link, hooks, QA checklist, stuck flag and reason, ClickUp id.
--   os_task_status_history    one row per status change (and the first status), with who and
--                             when. Written by a trigger, never by hand, and never edited.
--   os_task_milestone_statuses  which statuses mark brief due, cut to strategist and cut to
--                             client. os_task_milestones(task) reads the history with it.
--
-- Access:
--   builder and employee read and write tasks; only a builder deletes one.
--   a client reads no table directly. os_client_tasks() returns only their own clients' tasks
--   and only the client-visible fields (no brief, people, hooks, QA list or stuck reason).
--   anon and public get nothing.

-- ------------------------------------------------------------------ statuses

create table public.os_task_statuses (
  status text primary key,
  position integer not null unique,
  stage text not null check (stage in ('Preparing Content', 'Production', 'Editing', 'Client Review', 'Ready to Launch'))
);

insert into public.os_task_statuses (status, position, stage) values
  ('assigned', 10, 'Preparing Content'),
  ('brief creation', 20, 'Preparing Content'),
  ('client brief review', 30, 'Preparing Content'),
  ('ready to shoot', 40, 'Production'),
  ('ready for creator', 50, 'Production'),
  ('shooting client', 60, 'Production'),
  ('ready to edit', 70, 'Production'),
  ('ready for editing queue', 80, 'Editing'),
  ('editing', 90, 'Editing'),
  ('internal review', 100, 'Editing'),
  ('internal review edits', 110, 'Editing'),
  ('quality assurance review', 120, 'Editing'),
  ('export versions', 130, 'Editing'),
  ('versions exported', 140, 'Editing'),
  ('client revisions', 150, 'Editing'),
  ('ready to send to client', 160, 'Client Review'),
  ('client review', 170, 'Client Review'),
  ('ready to transfer', 180, 'Ready to Launch'),
  ('ready for launch', 190, 'Ready to Launch'),
  ('complete', 200, 'Ready to Launch');

-- ------------------------------------------------------------------ tasks

create table public.os_tasks (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on update cascade,
  title text not null check (length(btrim(title)) > 0),
  task_type text,
  status text not null default 'assigned' references public.os_task_statuses(status) on update cascade,
  due_date date,
  strategist_id uuid references auth.users(id) on delete set null,
  producer_id uuid references auth.users(id) on delete set null,
  editor_id uuid references auth.users(id) on delete set null,
  content_type text,
  cycle_month date check (cycle_month is null or cycle_month = date_trunc('month', cycle_month)::date),
  brief text,
  asset_url text check (asset_url is null or asset_url ~* '^https?://'),
  hooks text[] not null default '{}',
  qa_checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(qa_checklist) = 'array'),
  is_stuck boolean not null default false,
  stuck_reason text,
  clickup_task_id text unique,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_tasks_stuck_needs_reason check (not is_stuck or length(btrim(coalesce(stuck_reason, ''))) > 0)
);

create index os_tasks_client_slug_idx on public.os_tasks (client_slug);
create index os_tasks_status_idx on public.os_tasks (status);
create index os_tasks_cycle_month_idx on public.os_tasks (cycle_month);

create trigger update_os_tasks_updated_at before update on public.os_tasks
  for each row execute function public.update_updated_at_column();

comment on table public.os_tasks is 'Goodo OS tasks (OS-006). Staff read and write; clients use os_client_tasks().';

-- ------------------------------------------------------------------ status history

create table public.os_task_status_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.os_tasks(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default clock_timestamp()
);

create index os_task_status_history_task_idx on public.os_task_status_history (task_id, changed_at);

comment on table public.os_task_status_history is 'Every status change of an os_tasks row, with who and when. Written by trigger only; immutable.';

create or replace function public.os_tasks_record_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.os_task_status_history (task_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.os_task_status_history (task_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return null;
end;
$$;

create trigger os_tasks_record_status after insert or update of status on public.os_tasks
  for each row execute function public.os_tasks_record_status();

-- History is append-only: no edit, and no delete except through the task being deleted.
create or replace function public.os_task_history_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'status history cannot be edited' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and exists (select 1 from public.os_tasks where id = old.task_id) then
    raise exception 'status history cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger os_task_status_history_immutable before update or delete on public.os_task_status_history
  for each row execute function public.os_task_history_immutable();

revoke all on function public.os_tasks_record_status(), public.os_task_history_immutable() from public, anon, authenticated;

-- ------------------------------------------------------------------ milestones from history

create table public.os_task_milestone_statuses (
  milestone text not null check (milestone in ('brief_due', 'cut_to_strategist', 'cut_to_client')),
  status text not null references public.os_task_statuses(status) on update cascade,
  primary key (milestone, status)
);

-- The brief is done when it goes to the client for brief review; the first cut goes to the
-- strategist at internal review; the cut goes to the client when it is ready to send or in
-- client review, whichever comes first.
insert into public.os_task_milestone_statuses (milestone, status) values
  ('brief_due', 'client brief review'),
  ('cut_to_strategist', 'internal review'),
  ('cut_to_client', 'ready to send to client'),
  ('cut_to_client', 'client review');

-- First time the task reached each milestone. Null when it has not reached it yet.
create or replace function public.os_task_milestones(p_task_id uuid)
returns table (brief_due timestamptz, cut_to_strategist timestamptz, cut_to_client timestamptz)
language sql
stable
set search_path = public
as $$
  select
    min(h.changed_at) filter (where m.milestone = 'brief_due'),
    min(h.changed_at) filter (where m.milestone = 'cut_to_strategist'),
    min(h.changed_at) filter (where m.milestone = 'cut_to_client')
  from public.os_task_status_history h
  join public.os_task_milestone_statuses m on m.status = h.to_status
  where h.task_id = p_task_id;
$$;

-- Runs as the caller, so the row rules on the history decide what it can see.
revoke all on function public.os_task_milestones(uuid) from public, anon;
grant execute on function public.os_task_milestones(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ client read

create or replace function public.os_client_tasks()
returns table (
  id uuid,
  client_slug text,
  title text,
  task_type text,
  status text,
  stage text,
  due_date date,
  content_type text,
  cycle_month date,
  asset_url text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.client_slug, t.title, t.task_type, t.status, s.stage, t.due_date, t.content_type,
         t.cycle_month, t.asset_url, t.updated_at
    from public.os_tasks t
    join public.os_task_statuses s on s.status = t.status
   where public.has_role(auth.uid(), 'client'::public.app_role)
     and t.client_slug in (select public.get_user_client_slugs())
   order by t.due_date nulls last, t.title;
$$;

revoke all on function public.os_client_tasks() from public, anon;
grant execute on function public.os_client_tasks() to authenticated, service_role;

-- ------------------------------------------------------------------ grants and row rules

alter table public.os_task_statuses enable row level security;
alter table public.os_tasks enable row level security;
alter table public.os_task_status_history enable row level security;
alter table public.os_task_milestone_statuses enable row level security;

revoke all on table public.os_task_statuses, public.os_tasks, public.os_task_status_history,
  public.os_task_milestone_statuses from public, anon, authenticated;

grant select on table public.os_task_statuses, public.os_task_milestone_statuses, public.os_task_status_history
  to authenticated;
grant select, insert, update, delete on table public.os_tasks to authenticated;
grant all on table public.os_task_statuses, public.os_tasks, public.os_task_status_history,
  public.os_task_milestone_statuses to service_role;

create policy "Staff can read os_task_statuses" on public.os_task_statuses
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can read os_task_milestone_statuses" on public.os_task_milestone_statuses
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can read os_tasks" on public.os_tasks
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can add os_tasks" on public.os_tasks
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can update os_tasks" on public.os_tasks
  for update to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder can delete os_tasks" on public.os_tasks
  for delete to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Staff can read os_task_status_history" on public.os_task_status_history
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
