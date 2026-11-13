-- Goodo OS story OS-019: client home and the Briefs, Review and Assets pages.
--
--   os_client_visible_fields   the allow-list of task fields a client may see. Seeded with title,
--                              stage (the phase), due_date, brief and asset_url. A column added to
--                              os_tasks later is hidden from clients until a row is added here.
--   os_client_task_cards()     a client's own clients' tasks as JSON objects. Each object has the
--                              task id, the allow-listed fields and nothing else, plus "decision":
--                              the current client decision on the task (or null). The object is
--                              built from the allow-list at call time, so a new os_tasks column can
--                              never reach a client by accident.
--   os_task_client_decisions   client approvals and change requests on os_tasks rows. Append-only;
--                              the current one has superseded_at null.
--   os_client_decide(task, decision, note)
--                              a client approves or asks for changes on a task in Client Review.
--                              Records the decision, moves the task (approve: 'ready to transfer',
--                              the first Ready to Launch status; request changes: 'client revisions'),
--                              which writes status history through the existing trigger, and
--                              notifies the task's strategist, or every builder when it has none.
--
-- Why not record_client_decision: that one is keyed on ClickUp task ids in pipeline_tasks and runs as
-- the service role from an edge function. os_tasks rows have uuid ids and may have no ClickUp id. The
-- rules are the same: a note of 1 to 1000 characters for a change request, the same answer twice
-- changes nothing, at most 5 decisions per person per task in 10 minutes.
--
-- Why an allow-list table instead of a fixed column list plus a test: a fixed list is safe only as
-- long as someone runs the test. Building the output from the allow-list means the safe outcome (the
-- field is hidden) is what happens when nobody does anything.
--
-- os_client_tasks() (OS-006) is left as it is: nothing in the app calls it any more, and its own tests
-- still cover it. See the OS-019 notes for retiring it.
--
-- Clients still read and write no task table directly. The OS-017 write-back trigger queues the
-- status change (write-back is switched off).
--
-- Tests: supabase/tests/os_client_pages_test.sql.

-- ------------------------------------------------------------------ allow-list

create table public.os_client_visible_fields (
  field text primary key check (field ~ '^[a-z_]+$'),
  added_at timestamptz not null default now()
);

comment on table public.os_client_visible_fields is
  'Task fields a client may see (OS-019). os_client_task_cards() returns only these. A new os_tasks column stays hidden until it is added here.';

insert into public.os_client_visible_fields (field) values
  ('title'), ('stage'), ('due_date'), ('brief'), ('asset_url');

alter table public.os_client_visible_fields enable row level security;
revoke all on table public.os_client_visible_fields from public, anon, authenticated;
grant select on table public.os_client_visible_fields to authenticated;
grant all on table public.os_client_visible_fields to service_role;

-- The list itself is not secret: anyone signed in may read which fields are shown. Only the service
-- role (a migration) changes it.
create policy "Signed-in users can read os_client_visible_fields" on public.os_client_visible_fields
  for select to authenticated using (true);

-- ------------------------------------------------------------------ decisions

create table public.os_task_client_decisions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.os_tasks(id) on delete cascade,
  client_slug text not null references public.clients(slug) on update cascade on delete cascade,
  decision text not null check (decision in ('approved', 'changes_requested')),
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  decided_by uuid not null,
  decided_by_label text not null check (length(btrim(decided_by_label)) between 1 and 120),
  decided_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  constraint os_task_client_decisions_note_matches check ((decision = 'changes_requested') = (note is not null))
);

create unique index os_task_client_decisions_current_idx
  on public.os_task_client_decisions (task_id) where superseded_at is null;
create index os_task_client_decisions_rate_idx
  on public.os_task_client_decisions (decided_by, task_id, decided_at);

comment on table public.os_task_client_decisions is
  'Client approvals and change requests on os_tasks (OS-019). Append-only; written by os_client_decide only. Staff read; clients see their own through os_client_task_cards().';

create or replace function public.guard_os_task_client_decisions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.superseded_at is null and new.superseded_at is not null
     and (new.id, new.task_id, new.client_slug, new.decision, new.note, new.decided_by, new.decided_by_label, new.decided_at)
         is not distinct from
         (old.id, old.task_id, old.client_slug, old.decision, old.note, old.decided_by, old.decided_by_label, old.decided_at) then
    return new;
  end if;
  -- A delete that comes from the task being deleted is allowed.
  if tg_op = 'DELETE' and not exists (select 1 from public.os_tasks where id = old.task_id) then
    return old;
  end if;
  raise exception 'client decision history is append-only' using errcode = '23514';
end;
$$;
revoke all on function public.guard_os_task_client_decisions() from public, anon, authenticated;

create trigger os_task_client_decisions_guard before update or delete on public.os_task_client_decisions
  for each row execute function public.guard_os_task_client_decisions();

alter table public.os_task_client_decisions enable row level security;
revoke all on table public.os_task_client_decisions from public, anon, authenticated;
grant select on table public.os_task_client_decisions to authenticated;
grant all on table public.os_task_client_decisions to service_role;

create policy "Staff can read os_task_client_decisions" on public.os_task_client_decisions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ client read

-- One JSON object per task: id, the allow-listed fields, and the current decision. Only for a
-- client login, only their own clients' tasks, only app tasks or ClickUp asset tasks (the same
-- rule as os_client_tasks and list_task_comments).
create or replace function public.os_client_task_cards()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', t.id)
         || coalesce((
              select jsonb_object_agg(f.field, (to_jsonb(t) || jsonb_build_object('stage', s.stage)) -> f.field)
                from public.os_client_visible_fields f
               where f.field <> 'id'
            ), '{}'::jsonb)
         || jsonb_build_object('decision', (
              select jsonb_build_object('decision', d.decision, 'note', d.note,
                                        'decided_by_label', d.decided_by_label, 'decided_at', d.decided_at)
                from public.os_task_client_decisions d
               where d.task_id = t.id and d.superseded_at is null
            ))
    from public.os_tasks t
    join public.os_task_statuses s on s.status = t.status
   where public.has_role(auth.uid(), 'client'::public.app_role)
     and t.client_slug is not null
     and t.client_slug in (select public.get_user_client_slugs())
     and (t.clickup_list_id is null or t.is_asset)
   order by t.due_date nulls last, t.title, t.id;
$$;

revoke all on function public.os_client_task_cards() from public, anon;
grant execute on function public.os_client_task_cards() to authenticated, service_role;

-- ------------------------------------------------------------------ client decision

-- Errors: 42501 not a client, P0002 not found (also another client's task), P0409 not in Client
-- Review, P0429 too many, 22023 bad input. Returns {status, id, decision, task_status}; status is
-- 'recorded' or 'unchanged'.
create or replace function public.os_client_decide(p_task_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.os_tasks%rowtype;
  v_stage text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_label text;
  v_to text;
  v_cur public.os_task_client_decisions%rowtype;
  v_new public.os_task_client_decisions%rowtype;
  v_recent integer;
begin
  if v_uid is null or not public.has_role(v_uid, 'client'::public.app_role) then
    raise exception 'only a client can approve or ask for changes' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then
    raise exception 'decision must be approved or changes_requested' using errcode = '22023';
  end if;
  if p_decision = 'changes_requested' and (v_note is null or length(v_note) > 1000) then
    raise exception 'a change request needs a note of 1 to 1000 characters' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    v_note := null;
  end if;

  perform pg_advisory_xact_lock(hashtext('os_client_decide:' || coalesce(p_task_id::text, '')));

  select * into v_task from public.os_tasks where id = p_task_id for update;
  if not found
     or v_task.client_slug is null
     or v_task.client_slug not in (select public.get_user_client_slugs())
     or not (v_task.clickup_list_id is null or v_task.is_asset) then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select * into v_cur from public.os_task_client_decisions where task_id = p_task_id and superseded_at is null;
  if v_cur.id is not null and v_cur.decision = p_decision and v_cur.note is not distinct from v_note then
    return jsonb_build_object('status', 'unchanged', 'id', v_cur.id, 'decision', v_cur.decision, 'task_status', v_task.status);
  end if;

  select stage into v_stage from public.os_task_statuses where status = v_task.status;
  if v_task.read_only or v_stage is distinct from 'Client Review' then
    raise exception 'this task is not waiting for your review' using errcode = 'P0409';
  end if;

  select count(*) into v_recent from public.os_task_client_decisions
   where decided_by = v_uid and task_id = p_task_id and decided_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'too many decisions on this task, try again in a few minutes' using errcode = 'P0429';
  end if;

  -- A plain label for the person: their profile name, else the part of the email before the @.
  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Client')
    into v_label
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = v_uid;
  v_label := left(coalesce(nullif(btrim(v_label), ''), 'Client'), 120);

  if v_cur.id is not null then
    update public.os_task_client_decisions set superseded_at = clock_timestamp() where id = v_cur.id;
  end if;

  insert into public.os_task_client_decisions (task_id, client_slug, decision, note, decided_by, decided_by_label)
  values (p_task_id, v_task.client_slug, p_decision, v_note, v_uid, v_label)
  returning * into v_new;

  v_to := case when p_decision = 'approved' then 'ready to transfer' else 'client revisions' end;
  update public.os_tasks set status = v_to where id = p_task_id;

  insert into public.notifications (user_id, title, body, type, task_id)
  select r.uid,
         case when p_decision = 'approved' then v_label || ' approved ' || v_task.title
              else v_label || ' asked for changes on ' || v_task.title end,
         case when p_decision = 'approved' then 'Moved to ready to transfer.' else left(v_note, 280) end,
         'client_decision',
         p_task_id
    from (
      select v_task.strategist_id as uid where v_task.strategist_id is not null
      union
      select ur.user_id from public.user_roles ur
       where v_task.strategist_id is null and ur.role = 'builder'::public.app_role
    ) r;

  return jsonb_build_object('status', 'recorded', 'id', v_new.id, 'decision', v_new.decision, 'task_status', v_to);
end;
$$;

revoke all on function public.os_client_decide(uuid, text, text) from public, anon;
grant execute on function public.os_client_decide(uuid, text, text) to authenticated, service_role;
