-- Goodo OS: each task may take exactly the statuses of its own ClickUp list.
--
-- Before this, os_tasks.status could only be a status already in os_task_statuses, which the sync
-- filled from the statuses tasks happened to have. A status that exists on a ClickUp list but that
-- no task had yet (for example "filming" on the OS write-back test list) was refused.
--
--   os_clickup_list_statuses   every status of every ClickUp list the sync walks: list id, the
--                              status key (lower-cased, as in os_tasks.status), ClickUp's exact
--                              name, its order, colour and type (open, custom, done, closed).
--                              ClickUp's "stuck" is not stored: in the app it is a flag
--                              (is_stuck), not a status. Written by clickup-os-sync only, which
--                              replaces a list's rows each walk. Every status also has an
--                              os_task_statuses row (foreign key), so the existing stage mapping
--                              (phase dots, columns, client stages) keeps working. A status the
--                              app did not know takes the stage of the closest earlier known status
--                              on its list, a done or closed status with none takes Ready to
--                              Launch, anything else Other (see _shared/os-clickup-sync.ts).
--   os_tasks_check_list_status  an app change (a signed-in user, not the sync) to a ClickUp task's
--                              status must be one of the statuses of that task's list. Until the
--                              sync has stored a list's statuses, the old rule (any known status)
--                              still applies. Tasks made in the app have no list and keep the old
--                              rule. Errcode 23514.
--   os_task_status_options(task)  the statuses the side panel offers for one task, in ClickUp order,
--                              with ClickUp's name, colour, type and the app stage. Runs as the
--                              caller: staff only, a client gets no rows.
--
-- Access: staff read os_clickup_list_statuses; only the service role writes it. Clients and anon
-- get nothing.

-- ------------------------------------------------------------------ list statuses

create table public.os_clickup_list_statuses (
  list_id text not null,
  status text not null references public.os_task_statuses(status) on update cascade,
  name text not null check (length(btrim(name)) > 0),
  order_index integer not null,
  color text,
  type text,
  synced_at timestamptz not null default now(),
  primary key (list_id, status),
  constraint os_clickup_list_statuses_key check (status = lower(btrim(status)) and status <> 'stuck')
);

comment on table public.os_clickup_list_statuses is 'The statuses of each ClickUp list, as clickup-os-sync last read them. Staff read; service role writes.';

alter table public.os_clickup_list_statuses enable row level security;

revoke all on table public.os_clickup_list_statuses from public, anon, authenticated;
grant select on table public.os_clickup_list_statuses to authenticated;
grant all on table public.os_clickup_list_statuses to service_role;

create policy "Staff can read os_clickup_list_statuses" on public.os_clickup_list_statuses
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ app changes: only the list's statuses

create or replace function public.os_tasks_check_list_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.os_clickup_is_app_change() or new.clickup_list_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.clickup_list_id is not distinct from old.clickup_list_id then
    return new;
  end if;
  if not exists (select 1 from public.os_clickup_list_statuses where list_id = new.clickup_list_id) then
    return new; -- this list's statuses have not been synced yet: the os_task_statuses rule applies
  end if;
  if not exists (select 1 from public.os_clickup_list_statuses
                  where list_id = new.clickup_list_id and status = new.status) then
    raise exception 'the status "%" is not a status of this task''s ClickUp list', new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.os_tasks_check_list_status() from public, anon, authenticated;

create trigger os_tasks_check_list_status before insert or update of status, clickup_list_id on public.os_tasks
  for each row execute function public.os_tasks_check_list_status();

-- ------------------------------------------------------------------ the picker

-- The task's list statuses when the sync has stored them; otherwise (an app-made task, or a list
-- not synced yet) the app's own asset workflow statuses, without the stage Other ones.
create or replace function public.os_task_status_options(p_task_id uuid)
returns table (status text, name text, color text, type text, stage text, order_index integer)
language sql
stable
set search_path = public
as $$
  with t as (
    select clickup_list_id from public.os_tasks where id = p_task_id
  ),
  l as (
    select ls.status, ls.name, ls.color, ls.type, s.stage, ls.order_index
      from public.os_clickup_list_statuses ls
      join t on ls.list_id = t.clickup_list_id
      join public.os_task_statuses s on s.status = ls.status
  )
  select * from (
    select * from l
    union all
    select s.status, s.status, null::text, null::text, s.stage, s.position
      from public.os_task_statuses s
     where exists (select 1 from t)
       and not exists (select 1 from l)
       and s.stage <> 'Other'
  ) o
  order by o.order_index, o.status;
$$;

revoke all on function public.os_task_status_options(uuid) from public, anon;
grant execute on function public.os_task_status_options(uuid) to authenticated, service_role;
