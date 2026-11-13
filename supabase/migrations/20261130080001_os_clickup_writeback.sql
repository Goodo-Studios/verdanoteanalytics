-- Goodo OS story OS-017: write app changes back to ClickUp.
--
-- Status, strategist/producer/editor, due date, comments and client decisions made in the app are
-- queued in os_clickup_outbox. The clickup-writeback function (service role, every minute in
-- production) sends them to ClickUp, or holds them.
--
-- WRITE-BACK IS OFF BY DEFAULT. The function writes only when both are set on the functions:
--   CLICKUP_WRITEBACK_ENABLED=true
--   CLICKUP_WRITEBACK_LIST_IDS=<ClickUp list id>[,<list id>]
-- and the list is also allowed by _shared/clickup-write-guard.ts (staging needs
-- CLICKUP_WRITE_ALLOWED_LIST_IDS too). Anything else is marked held and ClickUp is never called.
-- Nothing in this repo sets either value.
--
-- Who queues what:
--   os_tasks          after an update of status, strategist_id, producer_id, editor_id or due_date
--                     made by a signed-in app user (JWT role authenticated) on a ClickUp task that is
--                     not read-only. Writes by the ClickUp sync and webhook use the service role
--                     and are never queued, so a ClickUp change copied into the app does not go back
--                     to ClickUp. A session that sets app.sync_source = 'clickup' is skipped too.
--                     One queued row per task and field: a second change before sending updates
--                     the row; changing it back to the original value marks it skipped.
--   os_task_comments  after insert of an app comment (no clickup_comment_id) on a ClickUp task that
--                     is not read-only. Both threads; the thread is kept in the payload.
--   client_task_decisions  after insert (record_client_decision runs as the service role but is
--                     only ever called for an app decision). A superseded decision that was not
--                     sent yet is marked skipped.
--
-- States: queued (waiting or retrying, last_error set while retrying), sent, failed (gave up after
-- the retries), held (write-back off, or the list is not allowed), clash (ClickUp changed the same
-- field later, ClickUp kept), skipped (nothing to send).
--
-- os_clickup_clashes     every change made in both places: both values, both times, which won.
-- os_clickup_writeback_state  one row the worker updates each run: whether write-back is on and
--                        which lists are allowed, so Integration health can say so.
-- clickup_writeback_overview()  builder only, for Integration health.
--
-- Row rules: builders read the three tables; nobody else reads them; only the service role writes.
-- The old durable job kind clickup.decision_writeback (migration 20261117000001) is left as it is;
-- nothing claims it and this outbox replaces it.

-- ------------------------------------------------------------------ outbox

create table public.os_clickup_outbox (
  id bigint generated always as identity primary key,
  task_id uuid references public.os_tasks(id) on delete cascade,
  clickup_task_id text not null,
  clickup_list_id text,
  kind text not null check (kind in ('status', 'assignees', 'due_date', 'comment', 'decision')),
  field text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source_id text,
  changed_by uuid,
  app_changed_at timestamptz not null default clock_timestamp(),
  state text not null default 'queued' check (state in ('queued', 'sent', 'failed', 'held', 'clash', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  -- ClickUp comment id of a sent comment or decision; the sync skips importing it again.
  clickup_ref text,
  -- ClickUp's date_updated right after our write; a webhook event no newer than this is our echo.
  clickup_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint os_clickup_outbox_field_fits_kind check (
    (kind = 'assignees' and field in ('strategist', 'producer', 'editor'))
    or (kind <> 'assignees' and field = kind))
);

create index os_clickup_outbox_due_idx on public.os_clickup_outbox (next_attempt_at, id) where state = 'queued';
create index os_clickup_outbox_task_idx on public.os_clickup_outbox (clickup_task_id, state);
create index os_clickup_outbox_ref_idx on public.os_clickup_outbox (clickup_ref) where clickup_ref is not null;
create index os_clickup_outbox_state_idx on public.os_clickup_outbox (state, updated_at desc);
-- At most one waiting field change per task and field (comments and decisions are each their own row).
create unique index os_clickup_outbox_one_queued_field_idx on public.os_clickup_outbox (task_id, field)
  where state = 'queued' and kind in ('status', 'assignees', 'due_date');

create trigger update_os_clickup_outbox_updated_at before update on public.os_clickup_outbox
  for each row execute function public.update_updated_at_column();

comment on table public.os_clickup_outbox is
  'OS-017: app changes waiting to be written to ClickUp. Filled by triggers, sent or held by clickup-writeback. Builders read.';

-- ------------------------------------------------------------------ clashes

create table public.os_clickup_clashes (
  id bigint generated always as identity primary key,
  outbox_id bigint references public.os_clickup_outbox(id) on delete cascade,
  task_id uuid references public.os_tasks(id) on delete cascade,
  clickup_task_id text not null,
  kind text not null,
  field text not null,
  app_value text,
  clickup_value text,
  winner text not null check (winner in ('app', 'clickup')),
  app_changed_at timestamptz,
  clickup_changed_at timestamptz,
  created_at timestamptz not null default now()
);

create index os_clickup_clashes_created_idx on public.os_clickup_clashes (created_at desc);

comment on table public.os_clickup_clashes is
  'OS-017: a field changed in the app and in ClickUp at about the same time. The later change is kept. Builders read.';

-- ------------------------------------------------------------------ worker state

create table public.os_clickup_writeback_state (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  allowed_list_ids text[] not null default '{}',
  blocked_reason text,
  last_run_at timestamptz,
  last_counts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.os_clickup_writeback_state is
  'OS-017: one row. What the last clickup-writeback run saw: on or off, allowed lists, counts. Builders read.';

-- ------------------------------------------------------------------ queue helpers (internal)

-- True when the current statement comes from a signed-in app user, not the ClickUp sync.
create or replace function public.os_clickup_is_app_change()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('app.sync_source', true), '') <> 'clickup';
$$;

revoke all on function public.os_clickup_is_app_change() from public, anon, authenticated;

-- Queues one field change, folding it into a waiting row of the same task and field.
create or replace function public.os_clickup_queue_field(
  p_task public.os_tasks,
  p_kind text,
  p_field text,
  p_from text,
  p_to text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.os_clickup_outbox;
begin
  select * into v_row from public.os_clickup_outbox
   where task_id = p_task.id and field = p_field and state = 'queued'
   for update;
  if v_row.id is not null then
    if (v_row.payload ->> 'from') is not distinct from p_to then
      update public.os_clickup_outbox
         set state = 'skipped', last_error = 'changed back before it was sent',
             payload = v_row.payload || jsonb_build_object('to', p_to)
       where id = v_row.id;
    else
      update public.os_clickup_outbox
         set payload = v_row.payload || jsonb_build_object('to', p_to),
             app_changed_at = clock_timestamp(), changed_by = auth.uid(),
             clickup_list_id = p_task.clickup_list_id, attempts = 0, last_error = null, next_attempt_at = now()
       where id = v_row.id;
    end if;
    return;
  end if;
  insert into public.os_clickup_outbox (task_id, clickup_task_id, clickup_list_id, kind, field, payload, changed_by)
  values (p_task.id, p_task.clickup_task_id, p_task.clickup_list_id, p_kind, p_field,
          jsonb_build_object('from', p_from, 'to', p_to), auth.uid());
end;
$$;

revoke all on function public.os_clickup_queue_field(public.os_tasks, text, text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ triggers

create or replace function public.os_clickup_queue_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.os_clickup_is_app_change() or new.clickup_task_id is null or new.read_only or old.read_only then
    return null;
  end if;
  if new.status is distinct from old.status then
    perform public.os_clickup_queue_field(new, 'status', 'status', old.status, new.status);
  end if;
  if new.due_date is distinct from old.due_date then
    perform public.os_clickup_queue_field(new, 'due_date', 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.strategist_id is distinct from old.strategist_id then
    perform public.os_clickup_queue_field(new, 'assignees', 'strategist', old.strategist_id::text, new.strategist_id::text);
  end if;
  if new.producer_id is distinct from old.producer_id then
    perform public.os_clickup_queue_field(new, 'assignees', 'producer', old.producer_id::text, new.producer_id::text);
  end if;
  if new.editor_id is distinct from old.editor_id then
    perform public.os_clickup_queue_field(new, 'assignees', 'editor', old.editor_id::text, new.editor_id::text);
  end if;
  return null;
end;
$$;

revoke all on function public.os_clickup_queue_task_change() from public, anon, authenticated;

create trigger os_clickup_queue_task_change
  after update of status, due_date, strategist_id, producer_id, editor_id on public.os_tasks
  for each row execute function public.os_clickup_queue_task_change();

create or replace function public.os_clickup_queue_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.os_tasks;
  v_label text;
begin
  if new.clickup_comment_id is not null or not public.os_clickup_is_app_change() then
    return null;
  end if;
  select * into v_task from public.os_tasks where id = new.task_id;
  if v_task.id is null or v_task.clickup_task_id is null or v_task.read_only then
    return null;
  end if;
  select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), 'Someone')
    into v_label
    from auth.users u where u.id = new.author_user_id;
  insert into public.os_clickup_outbox (task_id, clickup_task_id, clickup_list_id, kind, field, payload, source_id, changed_by, app_changed_at)
  values (v_task.id, v_task.clickup_task_id, v_task.clickup_list_id, 'comment', 'comment',
          jsonb_build_object('thread', new.thread, 'body', new.body, 'author', coalesce(v_label, 'Someone')),
          new.id::text, new.author_user_id, coalesce(new.created_at, clock_timestamp()));
  return null;
end;
$$;

revoke all on function public.os_clickup_queue_comment() from public, anon, authenticated;

create trigger os_clickup_queue_comment after insert on public.os_task_comments
  for each row execute function public.os_clickup_queue_comment();

create or replace function public.os_clickup_queue_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.os_tasks;
begin
  if tg_op = 'UPDATE' then
    if old.superseded_at is null and new.superseded_at is not null then
      update public.os_clickup_outbox
         set state = 'skipped', last_error = 'superseded by a newer client decision'
       where kind = 'decision' and source_id = new.id::text and state in ('queued', 'held');
    end if;
    return null;
  end if;
  select * into v_task from public.os_tasks where clickup_task_id = new.clickup_task_id;
  if v_task.read_only then
    return null;
  end if;
  insert into public.os_clickup_outbox (task_id, clickup_task_id, clickup_list_id, kind, field, payload, source_id, changed_by, app_changed_at)
  values (v_task.id, new.clickup_task_id, v_task.clickup_list_id, 'decision', 'decision',
          jsonb_build_object('decision', new.decision, 'note', new.note, 'author', new.decided_by_label),
          new.id::text, new.decided_by, new.decided_at);
  return null;
end;
$$;

revoke all on function public.os_clickup_queue_decision() from public, anon, authenticated;

create trigger os_clickup_queue_decision after insert or update on public.client_task_decisions
  for each row execute function public.os_clickup_queue_decision();

-- ------------------------------------------------------------------ worker helpers

-- Login id -> email, service role only (the worker maps people to ClickUp members by email).
create or replace function public.os_user_emails_by_id(p_ids uuid[])
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, lower(u.email)::text from auth.users u where u.id = any (p_ids) and u.email is not null;
$$;

revoke all on function public.os_user_emails_by_id(uuid[]) from public, anon, authenticated;
grant execute on function public.os_user_emails_by_id(uuid[]) to service_role;

-- ------------------------------------------------------------------ Integration health

create or replace function public.clickup_writeback_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_state public.os_clickup_writeback_state;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'builders only' using errcode = '42501';
  end if;
  select * into v_state from public.os_clickup_writeback_state where id;
  return jsonb_build_object(
    'enabled', coalesce(v_state.enabled, false),
    'allowedListIds', to_jsonb(coalesce(v_state.allowed_list_ids, '{}'::text[])),
    'blockedReason', v_state.blocked_reason,
    'lastRunAt', v_state.last_run_at,
    'counts', (
      select jsonb_build_object(
        'queued', count(*) filter (where state = 'queued' and last_error is null),
        'retrying', count(*) filter (where state = 'queued' and last_error is not null),
        'sent', count(*) filter (where state = 'sent'),
        'failed', count(*) filter (where state = 'failed'),
        'held', count(*) filter (where state = 'held'),
        'clash', count(*) filter (where state = 'clash'),
        'skipped', count(*) filter (where state = 'skipped'))
        from public.os_clickup_outbox),
    'failures', coalesce((
      select jsonb_agg(f order by f."updatedAt" desc) from (
        select o.id, o.clickup_task_id as "clickupTaskId", o.kind, o.field, o.state, o.attempts,
               o.last_error as "lastError", o.next_attempt_at as "nextAttemptAt", o.updated_at as "updatedAt"
          from public.os_clickup_outbox o
         where o.state = 'failed' or (o.state = 'queued' and o.last_error is not null)
         order by o.updated_at desc limit 20) f), '[]'::jsonb),
    'clashes', coalesce((
      select jsonb_agg(c order by c."createdAt" desc) from (
        select x.id, x.clickup_task_id as "clickupTaskId", x.kind, x.field, x.app_value as "appValue",
               x.clickup_value as "clickupValue", x.winner, x.created_at as "createdAt"
          from public.os_clickup_clashes x
         order by x.created_at desc limit 20) c), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.clickup_writeback_overview() from public, anon;
grant execute on function public.clickup_writeback_overview() to authenticated, service_role;

-- ------------------------------------------------------------------ grants and row rules

alter table public.os_clickup_outbox enable row level security;
alter table public.os_clickup_clashes enable row level security;
alter table public.os_clickup_writeback_state enable row level security;

revoke all on table public.os_clickup_outbox, public.os_clickup_clashes, public.os_clickup_writeback_state
  from public, anon, authenticated;
grant select on table public.os_clickup_outbox, public.os_clickup_clashes, public.os_clickup_writeback_state to authenticated;
grant all on table public.os_clickup_outbox, public.os_clickup_clashes, public.os_clickup_writeback_state to service_role;

create policy "Builders can read os_clickup_outbox" on public.os_clickup_outbox
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builders can read os_clickup_clashes" on public.os_clickup_clashes
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builders can read os_clickup_writeback_state" on public.os_clickup_writeback_state
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));

-- ------------------------------------------------------------------ every minute

-- Production only: scripts/staging-lockdown.sql removes every pg_cron job after each staging push.
-- With write-back off (the default) each run only marks queued rows held; ClickUp is not called.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'clickup-writeback-every-minute' loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'clickup-writeback-every-minute',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/clickup-writeback',
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
      body    := '{}'::jsonb,
      timeout_milliseconds := 55000
    )
  $$
);
