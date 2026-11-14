-- Goodo OS wave D: support inbox, staff only (consolidation step 4d). Port of Goodo OS
-- migrations 017_support.sql and 018_support_fallback.sql, backend/services/support.ts and
-- the staff page src/pages/staff/SupportInbox.tsx (US-083, scoped client questions with an
-- accountable owner and immutable history).
--
--   support_requests            one client question: client, optional engagement, subject,
--                               question, the channel it came in on, open or resolved, the
--                               date of the next update owed, the accountable staff member and
--                               an optional backup, and a revision. Changed only by the
--                               functions below.
--   support_history             the question and every staff update, resolution and reopen,
--                               with the status and revision after it. Immutable.
--   support_assignment_history  every assignment of the accountable owner or the backup.
--                               Immutable.
--
-- Differences from Goodo OS (conservative, see "Needs the owner" in the plan): the Goodo OS
-- client portal is dropped, so clients do not ask or read here; staff record the question
-- with the channel it came through (call, Slack, email, meeting, other). Nothing is sent to
-- the client from Verdanote: a "staff update" records what staff told the client through
-- their normal channel. Goodo OS picked the owner from the engagement's strategist binding or
-- a configured fallback and checked per-engagement capability grants; here the creator names
-- the accountable staff member (themself by default) and any builder or employee may act.
--
-- Staff read every table; clients read nothing. Writes go only through the checked functions
-- (SECURITY DEFINER, each refuses non-staff in its own body).
-- Tests: supabase/tests/support_inbox_test.sql.

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete restrict,
  engagement_id uuid,
  subject text not null check (length(btrim(subject)) between 1 and 240),
  question text not null check (length(btrim(question)) between 1 and 4000),
  channel text not null check (channel in ('call', 'slack', 'email', 'meeting', 'other')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  next_update_target date not null,
  revision integer not null default 1 check (revision > 0),
  accountable_user_id uuid not null,
  backup_user_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_slug, subject, question),
  constraint support_requests_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict
);
create index support_requests_status_idx on public.support_requests (status, next_update_target);
create index support_requests_client_idx on public.support_requests (client_slug, updated_at desc);

create table public.support_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete restrict,
  event_kind text not null check (event_kind in ('question', 'response', 'resolution', 'reopen')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  status text not null check (status in ('open', 'resolved')),
  revision integer not null check (revision > 0),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (request_id, revision)
);

create table public.support_assignment_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete restrict,
  assignment_kind text not null check (assignment_kind in ('accountable', 'backup')),
  assigned_to uuid not null,
  revision integer not null check (revision > 0),
  assigned_by uuid not null,
  created_at timestamptz not null default now()
);
create index support_assignment_history_request_idx on public.support_assignment_history (request_id, created_at);

comment on table public.support_requests is 'Client questions recorded by staff (port of Goodo OS support_requests). Staff only; written by the support functions.';
comment on table public.support_history is 'The question and every staff update, resolution and reopen of a support request. Staff only. Immutable.';
comment on table public.support_assignment_history is 'Every accountable owner and backup assignment of a support request. Staff only. Immutable.';

create trigger update_support_requests_updated_at before update on public.support_requests
  for each row execute function public.update_updated_at_column();

create or replace function public.prevent_support_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'support history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_support_history_rewrite() from public, anon, authenticated;

create trigger support_history_immutable before update or delete on public.support_history
  for each row execute function public.prevent_support_history_rewrite();
create trigger support_history_no_truncate before truncate on public.support_history
  for each statement execute function public.prevent_support_history_rewrite();
create trigger support_assignment_history_immutable before update or delete on public.support_assignment_history
  for each row execute function public.prevent_support_history_rewrite();
create trigger support_assignment_history_no_truncate before truncate on public.support_assignment_history
  for each statement execute function public.prevent_support_history_rewrite();
create trigger support_requests_no_delete before delete on public.support_requests
  for each row execute function public.prevent_support_history_rewrite();
create trigger support_requests_no_truncate before truncate on public.support_requests
  for each statement execute function public.prevent_support_history_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.support_requests enable row level security;
alter table public.support_history enable row level security;
alter table public.support_assignment_history enable row level security;

revoke all on table public.support_requests, public.support_history, public.support_assignment_history from public, anon, authenticated;
grant select on table public.support_requests, public.support_history, public.support_assignment_history to authenticated;
grant all on table public.support_requests, public.support_history, public.support_assignment_history to service_role;

create policy "Builder/employee can read support_requests" on public.support_requests
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read support_history" on public.support_history
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read support_assignment_history" on public.support_assignment_history
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ helpers (internal)

-- True when the login is a builder or employee. Called only inside the checked functions.
create or replace function public.support_is_staff(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1 from public.user_roles where user_id = p_user_id and role in ('builder', 'employee'));
$$;
revoke all on function public.support_is_staff(uuid) from public, anon, authenticated;
grant execute on function public.support_is_staff(uuid) to service_role;

-- ------------------------------------------------------------------ checked functions

-- Builder or employee: record a client question. The same subject and question for the same
-- client returns the existing request instead of a duplicate.
create or replace function public.create_support_request(
  p_client_slug text,
  p_engagement_id uuid,
  p_subject text,
  p_question text,
  p_channel text,
  p_next_update_target date,
  p_accountable_user_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_owner uuid := coalesce(p_accountable_user_id, auth.uid());
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can record a support request' using errcode = 'insufficient_privilege';
  end if;
  if p_subject is null or length(btrim(p_subject)) not between 1 and 240
     or p_question is null or length(btrim(p_question)) not between 1 and 4000
     or p_channel is null or p_channel not in ('call', 'slack', 'email', 'meeting', 'other')
     or p_next_update_target is null then
    raise exception 'check the support request fields' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients where slug = p_client_slug) then
    raise exception 'client not found' using errcode = 'P0002';
  end if;
  if p_engagement_id is not null and not exists (select 1 from public.engagements where id = p_engagement_id and client_slug = p_client_slug) then
    raise exception 'the engagement is not one of this client''s' using errcode = '22023';
  end if;
  if not public.support_is_staff(v_owner) then
    raise exception 'the accountable owner must be a builder or employee' using errcode = '22023';
  end if;
  select id into v_id from public.support_requests
   where client_slug = p_client_slug and subject = btrim(p_subject) and question = btrim(p_question);
  if v_id is not null then
    return v_id;
  end if;
  insert into public.support_requests (client_slug, engagement_id, subject, question, channel, next_update_target, accountable_user_id, created_by)
  values (p_client_slug, p_engagement_id, btrim(p_subject), btrim(p_question), p_channel, p_next_update_target, v_owner, auth.uid())
  on conflict (client_slug, subject, question) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.support_requests
     where client_slug = p_client_slug and subject = btrim(p_subject) and question = btrim(p_question);
    return v_id;
  end if;
  insert into public.support_history (request_id, event_kind, body, status, revision, actor_id)
  values (v_id, 'question', btrim(p_question), 'open', 1, auth.uid());
  insert into public.support_assignment_history (request_id, assignment_kind, assigned_to, revision, assigned_by)
  values (v_id, 'accountable', v_owner, 1, auth.uid());
  return v_id;
end;
$$;

-- Builder or employee: a staff update (what was told to the client, status unchanged), a
-- resolution (open only) or a reopen (resolved only), against the revision on screen.
-- Optionally moves the next update date. Returns the new revision.
create or replace function public.record_support_event(
  p_request_id uuid,
  p_expected_revision integer,
  p_event_kind text,
  p_body text,
  p_next_update_target date default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_request public.support_requests;
  v_status text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can update a support request' using errcode = 'insufficient_privilege';
  end if;
  if p_event_kind is null or p_event_kind not in ('response', 'resolution', 'reopen')
     or p_body is null or length(btrim(p_body)) not between 1 and 4000 then
    raise exception 'check the update fields' using errcode = '22023';
  end if;
  select * into v_request from public.support_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'support request not found' using errcode = 'P0002';
  end if;
  if v_request.revision <> p_expected_revision then
    raise exception 'the request changed since it was opened' using errcode = '40001';
  end if;
  if (p_event_kind = 'resolution' and v_request.status <> 'open') or (p_event_kind = 'reopen' and v_request.status <> 'resolved') then
    raise exception 'only an open request can be resolved and only a resolved one reopened' using errcode = '22023';
  end if;
  v_status := case p_event_kind when 'resolution' then 'resolved' when 'reopen' then 'open' else v_request.status end;
  update public.support_requests
     set status = v_status, revision = v_request.revision + 1,
         next_update_target = coalesce(p_next_update_target, next_update_target)
   where id = v_request.id;
  insert into public.support_history (request_id, event_kind, body, status, revision, actor_id)
  values (v_request.id, p_event_kind, btrim(p_body), v_status, v_request.revision + 1, auth.uid());
  return v_request.revision + 1;
end;
$$;

-- Builder or employee: name the accountable owner or the backup, against the revision on
-- screen. The person must be a builder or employee. Returns the new revision.
create or replace function public.assign_support_request(
  p_request_id uuid,
  p_expected_revision integer,
  p_assigned_to uuid,
  p_assignment_kind text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_request public.support_requests;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can assign a support request' using errcode = 'insufficient_privilege';
  end if;
  if p_assignment_kind is null or p_assignment_kind not in ('accountable', 'backup') then
    raise exception 'assignment kind must be accountable or backup' using errcode = '22023';
  end if;
  if not public.support_is_staff(p_assigned_to) then
    raise exception 'the person must be a builder or employee' using errcode = '22023';
  end if;
  select * into v_request from public.support_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'support request not found' using errcode = 'P0002';
  end if;
  if v_request.revision <> p_expected_revision then
    raise exception 'the request changed since it was opened' using errcode = '40001';
  end if;
  update public.support_requests
     set accountable_user_id = case when p_assignment_kind = 'accountable' then p_assigned_to else accountable_user_id end,
         backup_user_id = case when p_assignment_kind = 'backup' then p_assigned_to else backup_user_id end,
         revision = v_request.revision + 1
   where id = v_request.id;
  insert into public.support_assignment_history (request_id, assignment_kind, assigned_to, revision, assigned_by)
  values (v_request.id, p_assignment_kind, p_assigned_to, v_request.revision + 1, auth.uid());
  return v_request.revision + 1;
end;
$$;

revoke all on function public.create_support_request(text, uuid, text, text, text, date, uuid),
  public.record_support_event(uuid, integer, text, text, date),
  public.assign_support_request(uuid, integer, uuid, text)
  from public, anon;
grant execute on function public.create_support_request(text, uuid, text, text, text, date, uuid),
  public.record_support_event(uuid, integer, text, text, date),
  public.assign_support_request(uuid, integer, uuid, text)
  to authenticated, service_role;
