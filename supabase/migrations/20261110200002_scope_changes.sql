-- Goodo OS wave C: scope changes (consolidation step 4c). Port of Goodo OS migrations
-- 013_scope_lock.sql and 013a_scope_lock_delivery.sql and backend/services/scopeLock.ts,
-- on the shot list approvals of migration 20261110120002.
--
--   scope_locks                   the client's approval of one exact published shot list
--                                 version locks the engagement scope at that version.
--                                 Written by a trigger on approval_subject_decisions.
--                                 Immutable.
--   scope_change_requests         a client request to change a locked shot list, recorded
--                                 by staff against the locked version, with the channel it
--                                 came through (call, Slack, email). Immutable.
--   scope_change_evaluations      staff evaluations of a request: needs review, accepted or
--                                 declined, with a rationale. Accepted and declined are
--                                 final. Immutable.
--
-- Rules ported from Goodo OS: an approved shot list version is the locked scope; a change
-- request must name the version that is locked right now (40001 otherwise); a request is
-- evaluated until it is accepted or declined, and never after; history never changes. An
-- accepted change does not edit the shot list: staff publish a new shot list version on
-- the Deliverables page, and the client's approval of it locks the new scope.
--
-- Differences (conservative stand-ins, see "Needs the owner" in the plan): the Goodo OS
-- client portal is dropped, so staff record the client's request with its channel and a
-- source note. Goodo OS let staff with the approval publish capability evaluate; here any
-- builder or employee may mark a request "needs review", and only a builder accepts or
-- declines one, because it changes the agreed scope of a paid cycle.
--
-- Staff read every table; clients read nothing. Writes go only through the trigger and
-- the checked functions (SECURITY DEFINER, each refuses non-staff in its own body).
--
-- Not ported: the ClickUp scope lock effects, their delivery records and the ClickUp task
-- links (outward writes), approval sync events and command receipts.
-- Tests: supabase/tests/scope_changes_test.sql.

create table public.scope_locks (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.approval_subjects(id) on delete restrict,
  version integer not null,
  engagement_id uuid not null,
  client_slug text not null,
  decision_id uuid not null unique references public.approval_subject_decisions(id) on delete restrict,
  locked_by uuid not null,
  locked_at timestamptz not null default now(),
  unique (subject_id, version),
  foreign key (subject_id, version) references public.approval_subject_versions(subject_id, version) on delete restrict,
  constraint scope_locks_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict
);
create index scope_locks_engagement_idx on public.scope_locks (engagement_id);

create table public.scope_change_requests (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  base_version integer not null,
  engagement_id uuid not null,
  client_slug text not null,
  requested_change text not null check (length(btrim(requested_change)) between 1 and 4000),
  channel text not null check (channel in ('call', 'slack', 'email')),
  source_note text not null check (length(btrim(source_note)) between 1 and 4000),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (subject_id, base_version) references public.scope_locks(subject_id, version) on delete restrict,
  constraint scope_change_requests_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict
);
create index scope_change_requests_engagement_idx on public.scope_change_requests (engagement_id, created_at desc);

create table public.scope_change_evaluations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.scope_change_requests(id) on delete restrict,
  status text not null check (status in ('needs_review', 'accepted', 'declined')),
  rationale text not null check (length(btrim(rationale)) between 1 and 4000),
  evaluator_id uuid not null,
  created_at timestamptz not null default now()
);
create index scope_change_evaluations_request_idx on public.scope_change_evaluations (request_id, created_at desc);
create unique index scope_change_evaluations_one_final on public.scope_change_evaluations (request_id) where status in ('accepted', 'declined');

comment on table public.scope_locks is 'Shot list versions locked as the engagement scope by the client approval (port of Goodo OS scope_lock_history). Staff only. Immutable.';
comment on table public.scope_change_requests is 'Client requests to change a locked shot list, recorded by staff. Staff only. Immutable.';
comment on table public.scope_change_evaluations is 'Staff evaluations of scope change requests; accepted and declined are final. Staff only. Immutable.';

create or replace function public.prevent_scope_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'scope history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_scope_history_rewrite() from public, anon;

create trigger scope_locks_immutable before update or delete on public.scope_locks
  for each row execute function public.prevent_scope_history_rewrite();
create trigger scope_change_requests_immutable before update or delete on public.scope_change_requests
  for each row execute function public.prevent_scope_history_rewrite();
create trigger scope_change_evaluations_immutable before update or delete on public.scope_change_evaluations
  for each row execute function public.prevent_scope_history_rewrite();
create trigger scope_locks_no_truncate before truncate on public.scope_locks
  for each statement execute function public.prevent_scope_history_rewrite();
create trigger scope_change_requests_no_truncate before truncate on public.scope_change_requests
  for each statement execute function public.prevent_scope_history_rewrite();
create trigger scope_change_evaluations_no_truncate before truncate on public.scope_change_evaluations
  for each statement execute function public.prevent_scope_history_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.scope_locks enable row level security;
alter table public.scope_change_requests enable row level security;
alter table public.scope_change_evaluations enable row level security;

revoke all on table public.scope_locks, public.scope_change_requests, public.scope_change_evaluations
  from public, anon, authenticated;
grant select on table public.scope_locks, public.scope_change_requests, public.scope_change_evaluations to authenticated;
grant all on table public.scope_locks, public.scope_change_requests, public.scope_change_evaluations to service_role;

create policy "Builder/employee can read scope_locks" on public.scope_locks
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read scope_change_requests" on public.scope_change_requests
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read scope_change_evaluations" on public.scope_change_evaluations
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ the lock (trigger)

-- An approved decision on a shot list version locks that version as the scope, in the
-- same transaction as the decision (Goodo OS locked on the client approval itself).
create or replace function public.lock_scope_on_shot_list_approval()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_subject public.approval_subjects;
begin
  if new.decision <> 'approved' then
    return new;
  end if;
  select * into v_subject from public.approval_subjects where id = new.subject_id;
  if v_subject.subject_kind <> 'shot_list' then
    return new;
  end if;
  insert into public.scope_locks (subject_id, version, engagement_id, client_slug, decision_id, locked_by)
  values (new.subject_id, new.version, v_subject.engagement_id, v_subject.client_slug, new.id, new.recorded_by);
  return new;
end;
$$;
revoke all on function public.lock_scope_on_shot_list_approval() from public, anon, authenticated;

create trigger approval_subject_decisions_lock_scope after insert on public.approval_subject_decisions
  for each row execute function public.lock_scope_on_shot_list_approval();

-- Shot lists approved before this migration are locked too.
insert into public.scope_locks (subject_id, version, engagement_id, client_slug, decision_id, locked_by, locked_at)
select d.subject_id, d.version, s.engagement_id, s.client_slug, d.id, d.recorded_by, d.created_at
  from public.approval_subject_decisions d
  join public.approval_subjects s on s.id = d.subject_id
 where d.decision = 'approved' and s.subject_kind = 'shot_list';

-- ------------------------------------------------------------------ checked functions

-- Builder or employee: record a client's change request against the locked version.
create or replace function public.request_scope_change(
  p_subject_id uuid,
  p_base_version integer,
  p_requested_change text,
  p_channel text,
  p_source_note text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_subject public.approval_subjects;
  v_locked integer;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can record a scope change request' using errcode = 'insufficient_privilege';
  end if;
  select * into v_subject from public.approval_subjects where id = p_subject_id for update;
  if v_subject.id is null or v_subject.subject_kind <> 'shot_list' then
    raise exception 'shot list not found' using errcode = 'P0002';
  end if;
  select max(version) into v_locked from public.scope_locks where subject_id = p_subject_id;
  if v_locked is null then
    raise exception 'the shot list scope is not locked yet' using errcode = '22023';
  end if;
  if v_locked <> p_base_version then
    raise exception 'the locked version changed since it was shown' using errcode = '40001';
  end if;
  if exists (select 1 from public.engagements where id = v_subject.engagement_id and status in ('closed', 'cancelled')) then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  insert into public.scope_change_requests (subject_id, base_version, engagement_id, client_slug, requested_change, channel, source_note, recorded_by)
  values (p_subject_id, p_base_version, v_subject.engagement_id, v_subject.client_slug, btrim(p_requested_change), p_channel, btrim(p_source_note), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee marks "needs review"; only a builder accepts or declines, once.
create or replace function public.evaluate_scope_change(
  p_request_id uuid,
  p_status text,
  p_rationale text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_request public.scope_change_requests;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can evaluate a scope change' using errcode = 'insufficient_privilege';
  end if;
  select * into v_request from public.scope_change_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'scope change request not found' using errcode = 'P0002';
  end if;
  if p_status not in ('needs_review', 'accepted', 'declined') then
    raise exception 'needs review, accepted or declined' using errcode = '22023';
  end if;
  if p_status in ('accepted', 'declined') and not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder accepts or declines a scope change' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.scope_change_evaluations where request_id = p_request_id and status in ('accepted', 'declined')) then
    raise exception 'this request is already decided' using errcode = '22023';
  end if;
  insert into public.scope_change_evaluations (request_id, status, rationale, evaluator_id)
  values (p_request_id, p_status, btrim(p_rationale), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.request_scope_change(uuid, integer, text, text, text),
  public.evaluate_scope_change(uuid, text, text)
  from public, anon;
grant execute on function public.request_scope_change(uuid, integer, text, text, text),
  public.evaluate_scope_change(uuid, text, text)
  to authenticated, service_role;
