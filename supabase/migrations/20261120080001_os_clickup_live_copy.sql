-- Goodo OS story OS-007: copy every ClickUp task into os_tasks and keep it current.
--
-- Read-only against ClickUp. Two edge functions write here with the service role:
--   clickup-os-sync    full or nightly walk of the three ClickUp spaces (Client Operations,
--                      Production Team, Social Media Plan).
--   clickup-webhook    one task at a time, when ClickUp posts an event.
--
-- Changes:
--   os_tasks              client_slug may be empty (creator and social tasks have no client;
--                         clients never see those rows). New ClickUp columns: space, list,
--                         parent, description, exact ClickUp status, assignees, reviewed by,
--                         brief type, the six workflow dates, is_asset, read_only, link, and
--                         ClickUp's last update and our last sync time.
--   os_task_statuses      stage 'Other' for statuses from the other spaces. The sync adds an
--                         unknown status (stage Other, after the rest) before it writes tasks.
--   os_task_status_history.source   'app' or 'clickup'. A service-role write is 'clickup' and has
--                         no changed_by.
--   read_only             tasks of ending clients. Only the service role may change or delete
--                         them (errcode 42501 for anyone else).
--   os_task_comments      ClickUp comments, staff read only.
--   os_sync_runs, os_sync_discrepancies   one row per sync run, and every field where the app
--                         differed from ClickUp before a nightly run overwrote it. Staff read only.
--   os_task_counts_by_client   staff view: task counts per client (row rules of os_tasks apply).
--   os_user_ids_by_email(text[])  ClickUp email -> login id, service role only. The sync never
--                         creates or changes a login, role or member row.
--   os_client_tasks()     unchanged columns; now also leaves out ClickUp tasks that are not
--                         asset tasks (meeting calls, guidelines), and rows with no client.
--
-- Stuck: ClickUp "stuck" is a flag, not a workflow step. The row keeps its last real status,
-- is_stuck is true and stuck_reason is 'Stuck in ClickUp'; raw_status always holds the ClickUp
-- value. That rule lives in supabase/functions/_shared/os-task-map.ts.

-- ------------------------------------------------------------------ statuses: stage Other

alter table public.os_task_statuses drop constraint os_task_statuses_stage_check;
alter table public.os_task_statuses add constraint os_task_statuses_stage_check
  check (stage in ('Preparing Content', 'Production', 'Editing', 'Client Review', 'Ready to Launch', 'Other'));

-- ------------------------------------------------------------------ tasks: ClickUp columns

alter table public.os_tasks alter column client_slug drop not null;

alter table public.os_tasks
  add column clickup_space_id text,
  add column clickup_list_id text,
  add column clickup_list_name text,
  add column clickup_parent_id text,
  add column description text,
  add column raw_status text,
  add column assignees jsonb not null default '[]'::jsonb check (jsonb_typeof(assignees) = 'array'),
  add column reviewed_by jsonb not null default '[]'::jsonb check (jsonb_typeof(reviewed_by) = 'array'),
  add column brief_type text,
  add column brief_due_date date,
  add column cut_to_strategist_date date,
  add column cut_to_client_date date,
  add column edit_due_date date,
  add column production_date date,
  add column brief_handed_off_date date,
  add column is_asset boolean not null default false,
  add column read_only boolean not null default false,
  add column clickup_url text,
  add column clickup_updated_at timestamptz,
  add column last_synced_at timestamptz;

create index os_tasks_clickup_list_idx on public.os_tasks (clickup_list_id);
create index os_tasks_last_synced_idx on public.os_tasks (last_synced_at);

-- ------------------------------------------------------------------ who may write

-- Ending clients' tasks are history: only the sync may change or remove them.
-- Runs as the caller (not security definer), so current_user is the real role.
create or replace function public.os_tasks_guard_read_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.read_only and not (coalesce(auth.role(), '') = 'service_role' or current_user = 'service_role') then
    raise exception 'this task is read-only history from ClickUp' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.os_tasks_guard_read_only() from public, anon, authenticated;

create trigger os_tasks_guard_read_only before update or delete on public.os_tasks
  for each row execute function public.os_tasks_guard_read_only();

-- ------------------------------------------------------------------ history source

alter table public.os_task_status_history
  add column source text not null default 'app' check (source in ('app', 'clickup'));

create or replace function public.os_tasks_record_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sync boolean := coalesce(auth.role(), '') = 'service_role';
  v_source text := case when v_sync then 'clickup' else 'app' end;
  v_by uuid := case when v_sync then null else auth.uid() end;
begin
  if tg_op = 'INSERT' then
    insert into public.os_task_status_history (task_id, from_status, to_status, changed_by, source)
    values (new.id, null, new.status, v_by, v_source);
  elsif new.status is distinct from old.status then
    insert into public.os_task_status_history (task_id, from_status, to_status, changed_by, source)
    values (new.id, old.status, new.status, v_by, v_source);
  end if;
  return null;
end;
$$;

revoke all on function public.os_tasks_record_status() from public, anon, authenticated;

-- ------------------------------------------------------------------ comments

create table public.os_task_comments (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.os_tasks(id) on delete cascade,
  clickup_comment_id text not null unique,
  author jsonb not null default '{}'::jsonb,
  body text not null default '',
  created_at timestamptz,
  synced_at timestamptz not null default now()
);

create index os_task_comments_task_idx on public.os_task_comments (task_id, created_at);

comment on table public.os_task_comments is 'ClickUp comments of os_tasks rows (OS-007). Written by the ClickUp sync only; staff read.';

-- ------------------------------------------------------------------ sync runs and discrepancies

create table public.os_sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('full', 'nightly', 'webhook')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  counts jsonb not null default '{}'::jsonb,
  discrepancy_count integer not null default 0,
  error text
);

create index os_sync_runs_kind_started_idx on public.os_sync_runs (kind, started_at desc);

create table public.os_sync_discrepancies (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.os_sync_runs(id) on delete cascade,
  clickup_task_id text not null,
  field text not null,
  app_value text,
  clickup_value text,
  created_at timestamptz not null default now()
);

create index os_sync_discrepancies_run_idx on public.os_sync_discrepancies (run_id);

comment on table public.os_sync_runs is 'One row per ClickUp -> os_tasks run (full, nightly or webhook). Staff read.';
comment on table public.os_sync_discrepancies is 'Fields where the app differed from ClickUp before a nightly run overwrote them. Staff read.';

-- ------------------------------------------------------------------ counts per client

-- security_invoker: the row rules of os_tasks decide what the caller counts, so only staff see
-- numbers; a client or a login with no role gets no rows.
create view public.os_task_counts_by_client with (security_invoker = true) as
  select t.client_slug,
         count(*)::int as total,
         count(*) filter (where t.status <> 'complete')::int as open,
         count(*) filter (where t.is_stuck)::int as stuck,
         count(*) filter (where t.is_asset)::int as assets,
         count(*) filter (where t.read_only)::int as read_only
    from public.os_tasks t
   group by t.client_slug;

comment on view public.os_task_counts_by_client is 'Task counts per client (null = internal tasks). Staff only through os_tasks row rules.';

-- ------------------------------------------------------------------ ClickUp email -> login

-- Service role only. Reads auth.users to map a ClickUp person to a login; never writes.
create or replace function public.os_user_ids_by_email(p_emails text[])
returns table (email text, user_id uuid)
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(u.email)::text, u.id
    from auth.users u
   where u.email is not null
     and lower(u.email) in (select lower(btrim(e)) from unnest(p_emails) e where e is not null);
$$;

revoke all on function public.os_user_ids_by_email(text[]) from public, anon, authenticated;
grant execute on function public.os_user_ids_by_email(text[]) to service_role;

-- ------------------------------------------------------------------ client read

-- Same columns as OS-006. ClickUp tasks reach a client only when they are asset tasks
-- (Project View lists); tasks made in the app have no ClickUp list and are shown as before.
-- A row with no client never matches get_user_client_slugs().
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
     and t.client_slug is not null
     and t.client_slug in (select public.get_user_client_slugs())
     and (t.clickup_list_id is null or t.is_asset)
   order by t.due_date nulls last, t.title;
$$;

revoke all on function public.os_client_tasks() from public, anon;
grant execute on function public.os_client_tasks() to authenticated, service_role;

-- ------------------------------------------------------------------ grants and row rules

alter table public.os_task_comments enable row level security;
alter table public.os_sync_runs enable row level security;
alter table public.os_sync_discrepancies enable row level security;

revoke all on table public.os_task_comments, public.os_sync_runs, public.os_sync_discrepancies,
  public.os_task_counts_by_client from public, anon, authenticated;

grant select on table public.os_task_comments, public.os_sync_runs, public.os_sync_discrepancies,
  public.os_task_counts_by_client to authenticated;
grant all on table public.os_task_comments, public.os_sync_runs, public.os_sync_discrepancies,
  public.os_task_counts_by_client to service_role;

create policy "Staff can read os_task_comments" on public.os_task_comments
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can read os_sync_runs" on public.os_sync_runs
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff can read os_sync_discrepancies" on public.os_sync_discrepancies
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ nightly schedule

-- Production only: scripts/staging-lockdown.sql removes every pg_cron job after each staging
-- push. 07:30 UTC, after US working hours. The service role key comes from the Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'clickup-os-sync-nightly' loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'clickup-os-sync-nightly',
  '30 7 * * *',
  $$
    select net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/clickup-os-sync',
      headers := json_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
          limit 1
        ),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{"mode":"nightly"}'::jsonb,
      timeout_milliseconds := 300000
    )
  $$
);
