-- Goodo OS wave B: QA gates (consolidation step 4b). Port of Goodo OS migrations
-- 022_qa_release_gate.sql (QA returns to the strategist), 025_deliverable_release_
-- signoffs.sql (strategist congruency and QA release signoffs bound to an exact
-- revision) and the team confirmations of 021_deliverables.sql, with the release
-- rule of backend/services/qaGate.ts (releaseEligible), on the deliverables of
-- migration 20261110120002.
--
--   engagement_deliverable_confirmations  the team's confirmation that one exact
--                                         revision is ready for release checks. One
--                                         per revision. Immutable.
--   engagement_deliverable_qa_returns     a revision returned to the strategist with
--                                         feedback. Open until resolved once.
--   engagement_deliverable_signoffs       strategist congruency and QA release
--                                         signoffs on one exact revision. Append-only.
--
-- A deliverable is ready to send (the Goodo OS "Ready to Send" gate) when, for its
-- current revision: it is not withdrawn or already final; the client approved that
-- revision (added in Verdanote: Goodo OS left client approval to the portal, which is
-- dropped); the team confirmed it; no QA return on it is open; and a strategist
-- congruency signoff and a QA release signoff were recorded after the last resolved
-- return, by two different people. Goodo OS tied the strategist signoff to the
-- engagement's bound strategist and the QA signoff to a QA capability; Verdanote has
-- neither, so the conservative stand-in is two different staff members (see "Needs
-- the owner" in the plan). Marking a deliverable final needs every check to pass and
-- a final download link.
--
-- Staff read every table; clients read nothing. Writes go only through the checked
-- functions (SECURITY DEFINER, each refuses non-staff in its own body).
--
-- Not ported: ClickUp release contradictions and their resolutions, Air health
-- observation generations, the editor handoff queue of the QA inbox (it sends
-- outward) and command receipts. Tests: supabase/tests/qa_gates_test.sql.

create table public.engagement_deliverable_confirmations (
  deliverable_id uuid not null,
  revision integer not null,
  confirmed_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (deliverable_id, revision),
  foreign key (deliverable_id, revision) references public.engagement_deliverable_revisions(deliverable_id, revision) on delete restrict
);

create table public.engagement_deliverable_qa_returns (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null,
  revision integer not null,
  feedback text not null check (length(btrim(feedback)) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  returned_by uuid not null,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolution_note text check (resolution_note is null or length(btrim(resolution_note)) between 1 and 4000),
  resolved_at timestamptz,
  foreign key (deliverable_id, revision) references public.engagement_deliverable_revisions(deliverable_id, revision) on delete restrict,
  check ((status = 'open') = (resolved_at is null and resolved_by is null and resolution_note is null))
);
create index engagement_deliverable_qa_returns_current on public.engagement_deliverable_qa_returns (deliverable_id, revision, status);

create table public.engagement_deliverable_signoffs (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null,
  revision integer not null,
  signoff_kind text not null check (signoff_kind in ('strategist_congruency', 'qa_release')),
  signed_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (deliverable_id, revision) references public.engagement_deliverable_revisions(deliverable_id, revision) on delete restrict
);
create index engagement_deliverable_signoffs_current on public.engagement_deliverable_signoffs (deliverable_id, revision, signoff_kind, created_at desc);

comment on table public.engagement_deliverable_confirmations is 'Team confirmation of one exact deliverable revision. Staff only. Immutable.';
comment on table public.engagement_deliverable_qa_returns is 'Revisions returned to the strategist with QA feedback; resolved once. Staff only.';
comment on table public.engagement_deliverable_signoffs is 'Strategist congruency and QA release signoffs on one exact revision. Staff only. Append-only.';

-- ------------------------------------------------------------------ history rules

create or replace function public.prevent_qa_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'QA gate history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_qa_history_rewrite() from public, anon;

create trigger engagement_deliverable_confirmations_immutable before update or delete on public.engagement_deliverable_confirmations
  for each row execute function public.prevent_qa_history_rewrite();
create trigger engagement_deliverable_signoffs_immutable before update or delete on public.engagement_deliverable_signoffs
  for each row execute function public.prevent_qa_history_rewrite();
create trigger engagement_deliverable_qa_returns_no_delete before delete on public.engagement_deliverable_qa_returns
  for each row execute function public.prevent_qa_history_rewrite();
create trigger engagement_deliverable_confirmations_no_truncate before truncate on public.engagement_deliverable_confirmations
  for each statement execute function public.prevent_qa_history_rewrite();
create trigger engagement_deliverable_signoffs_no_truncate before truncate on public.engagement_deliverable_signoffs
  for each statement execute function public.prevent_qa_history_rewrite();
create trigger engagement_deliverable_qa_returns_no_truncate before truncate on public.engagement_deliverable_qa_returns
  for each statement execute function public.prevent_qa_history_rewrite();

-- A QA return is resolved once; nothing else about it changes.
create or replace function public.guard_qa_return_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'open' or new.status <> 'resolved' or new.deliverable_id is distinct from old.deliverable_id
     or new.revision is distinct from old.revision or new.feedback is distinct from old.feedback
     or new.returned_by is distinct from old.returned_by or new.created_at is distinct from old.created_at then
    raise exception 'a QA return is resolved once' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_qa_return_update() from public, anon;
create trigger engagement_deliverable_qa_returns_guard before update on public.engagement_deliverable_qa_returns
  for each row execute function public.guard_qa_return_update();

-- ------------------------------------------------------------------ grants and row rules

alter table public.engagement_deliverable_confirmations enable row level security;
alter table public.engagement_deliverable_qa_returns enable row level security;
alter table public.engagement_deliverable_signoffs enable row level security;

revoke all on table public.engagement_deliverable_confirmations, public.engagement_deliverable_qa_returns,
  public.engagement_deliverable_signoffs from public, anon, authenticated;
grant select on table public.engagement_deliverable_confirmations, public.engagement_deliverable_qa_returns,
  public.engagement_deliverable_signoffs to authenticated;
grant all on table public.engagement_deliverable_confirmations, public.engagement_deliverable_qa_returns,
  public.engagement_deliverable_signoffs to service_role;

create policy "Builder/employee can read engagement_deliverable_confirmations" on public.engagement_deliverable_confirmations
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_deliverable_qa_returns" on public.engagement_deliverable_qa_returns
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_deliverable_signoffs" on public.engagement_deliverable_signoffs
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ release rule

-- What still stands between the current revision and release, as short codes; an
-- empty list means ready to send. Internal: called by the functions below.
create or replace function public.deliverable_release_blockers(p_deliverable_id uuid)
returns text[]
language plpgsql
stable
set search_path = public
as $$
declare
  v_deliverable public.engagement_deliverables;
  v_since timestamptz;
  v_strategist uuid[];
  v_qa uuid[];
  v_out text[] := '{}';
begin
  select * into v_deliverable from public.engagement_deliverables where id = p_deliverable_id;
  if v_deliverable.id is null then
    return array['not_found'];
  end if;
  if v_deliverable.current_revision = 0 then
    return array['no_revision'];
  end if;
  if v_deliverable.stage = 'withdrawn' then
    return array['withdrawn'];
  end if;
  if v_deliverable.stage = 'final_ready' then
    return array['already_final'];
  end if;
  if not exists (select 1 from public.engagement_deliverable_decisions
                  where deliverable_id = p_deliverable_id and revision = v_deliverable.current_revision and decision = 'approved') then
    v_out := v_out || 'client_not_approved'::text;
  end if;
  if not exists (select 1 from public.engagement_deliverable_confirmations
                  where deliverable_id = p_deliverable_id and revision = v_deliverable.current_revision) then
    v_out := v_out || 'team_not_confirmed'::text;
  end if;
  if exists (select 1 from public.engagement_deliverable_qa_returns
              where deliverable_id = p_deliverable_id and revision = v_deliverable.current_revision and status = 'open') then
    v_out := v_out || 'qa_return_open'::text;
  end if;
  select max(resolved_at) into v_since from public.engagement_deliverable_qa_returns
   where deliverable_id = p_deliverable_id and revision = v_deliverable.current_revision and status = 'resolved';
  select array_agg(distinct signed_by) into v_strategist from public.engagement_deliverable_signoffs
   where deliverable_id = p_deliverable_id and revision = v_deliverable.current_revision and signoff_kind = 'strategist_congruency'
     and (v_since is null or created_at > v_since);
  select array_agg(distinct signed_by) into v_qa from public.engagement_deliverable_signoffs
   where deliverable_id = p_deliverable_id and revision = v_deliverable.current_revision and signoff_kind = 'qa_release'
     and (v_since is null or created_at > v_since);
  if v_strategist is null then
    v_out := v_out || 'strategist_signoff_missing'::text;
  end if;
  if v_qa is null then
    v_out := v_out || 'qa_signoff_missing'::text;
  end if;
  if v_strategist is not null and v_qa is not null
     and not exists (select 1 from unnest(v_strategist) s cross join unnest(v_qa) q where s <> q) then
    v_out := v_out || 'same_person_signed_both'::text;
  end if;
  return v_out;
end;
$$;
revoke all on function public.deliverable_release_blockers(uuid) from public, anon, authenticated;
grant execute on function public.deliverable_release_blockers(uuid) to service_role;

-- ------------------------------------------------------------------ checked functions

-- Builder or employee: the release checks of one deliverable for the gate page.
create or replace function public.deliverable_release_status(p_deliverable_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_blockers text[];
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can read the release gate' using errcode = 'insufficient_privilege';
  end if;
  v_blockers := public.deliverable_release_blockers(p_deliverable_id);
  if v_blockers = array['not_found'] then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ready', cardinality(v_blockers) = 0, 'blockers', to_jsonb(v_blockers));
end;
$$;

-- Builder or employee: confirm the current revision for release checks, once.
create or replace function public.confirm_deliverable_revision(
  p_deliverable_id uuid,
  p_revision integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deliverable public.engagement_deliverables;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can confirm a revision' using errcode = 'insufficient_privilege';
  end if;
  select * into v_deliverable from public.engagement_deliverables where id = p_deliverable_id for update;
  if v_deliverable.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_deliverable.current_revision <> p_revision then
    raise exception 'only the current revision is confirmed' using errcode = '40001';
  end if;
  if v_deliverable.stage in ('final_ready', 'withdrawn') then
    raise exception 'a final or withdrawn deliverable is not confirmed again' using errcode = '22023';
  end if;
  insert into public.engagement_deliverable_confirmations (deliverable_id, revision, confirmed_by)
  values (p_deliverable_id, p_revision, auth.uid());
  return p_revision;
end;
$$;

-- Builder or employee: return the current revision to the strategist with feedback.
-- The deliverable goes to internal QA until a new revision is added.
create or replace function public.return_deliverable_to_strategist(
  p_deliverable_id uuid,
  p_revision integer,
  p_feedback text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deliverable public.engagement_deliverables;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can return a revision' using errcode = 'insufficient_privilege';
  end if;
  select * into v_deliverable from public.engagement_deliverables where id = p_deliverable_id for update;
  if v_deliverable.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_deliverable.current_revision <> p_revision then
    raise exception 'only the current revision is returned' using errcode = '40001';
  end if;
  if v_deliverable.stage in ('not_started', 'final_ready', 'withdrawn') then
    raise exception 'this deliverable cannot be returned now' using errcode = '22023';
  end if;
  insert into public.engagement_deliverable_qa_returns (deliverable_id, revision, feedback, returned_by)
  values (p_deliverable_id, p_revision, btrim(p_feedback), auth.uid())
  returning id into v_id;
  update public.engagement_deliverables set stage = 'internal_qa' where id = p_deliverable_id;
  return v_id;
end;
$$;

-- Builder or employee: resolve an open QA return with a note. Signoffs made before
-- the resolution no longer count; the revision needs fresh signoffs. When it was the
-- last open return on the current revision, the deliverable goes back to where the
-- client left it (approved, changes requested, or waiting for the client).
create or replace function public.resolve_deliverable_qa_return(
  p_return_id uuid,
  p_note text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_return public.engagement_deliverable_qa_returns;
  v_deliverable public.engagement_deliverables;
  v_decision text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can resolve a QA return' using errcode = 'insufficient_privilege';
  end if;
  select * into v_return from public.engagement_deliverable_qa_returns where id = p_return_id;
  if v_return.id is null then
    raise exception 'QA return not found' using errcode = 'P0002';
  end if;
  select * into v_deliverable from public.engagement_deliverables where id = v_return.deliverable_id for update;
  perform 1 from public.engagement_deliverable_qa_returns where id = p_return_id for update;
  if v_return.status <> 'open' then
    raise exception 'this QA return is already resolved' using errcode = '40001';
  end if;
  update public.engagement_deliverable_qa_returns
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = clock_timestamp(), resolution_note = btrim(p_note)
   where id = p_return_id and status = 'open';
  if not found then
    raise exception 'this QA return is already resolved' using errcode = '40001';
  end if;
  if v_deliverable.stage = 'internal_qa' and v_deliverable.current_revision = v_return.revision
     and not exists (select 1 from public.engagement_deliverable_qa_returns
                      where deliverable_id = v_return.deliverable_id and revision = v_return.revision and status = 'open') then
    select decision into v_decision from public.engagement_deliverable_decisions
     where deliverable_id = v_return.deliverable_id and revision = v_return.revision;
    update public.engagement_deliverables
       set stage = case v_decision when 'approved' then 'client_approved' when 'changes_requested' then 'changes_requested' else 'client_review' end
     where id = v_return.deliverable_id;
  end if;
  return p_return_id;
end;
$$;

-- Builder or employee: sign off the current revision as strategist (congruency with
-- the brief) or as QA reviewer (release quality). Not while a QA return is open, and
-- not both kinds by the same person.
create or replace function public.record_deliverable_signoff(
  p_deliverable_id uuid,
  p_revision integer,
  p_signoff_kind text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deliverable public.engagement_deliverables;
  v_since timestamptz;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can sign off a revision' using errcode = 'insufficient_privilege';
  end if;
  select * into v_deliverable from public.engagement_deliverables where id = p_deliverable_id for update;
  if v_deliverable.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_deliverable.current_revision <> p_revision then
    raise exception 'only the current revision is signed off' using errcode = '40001';
  end if;
  if v_deliverable.stage in ('not_started', 'final_ready', 'withdrawn') then
    raise exception 'this deliverable cannot be signed off now' using errcode = '22023';
  end if;
  if exists (select 1 from public.engagement_deliverable_qa_returns
              where deliverable_id = p_deliverable_id and revision = p_revision and status = 'open') then
    raise exception 'resolve the open QA return first' using errcode = '22023';
  end if;
  select max(resolved_at) into v_since from public.engagement_deliverable_qa_returns
   where deliverable_id = p_deliverable_id and revision = p_revision and status = 'resolved';
  if exists (select 1 from public.engagement_deliverable_signoffs
              where deliverable_id = p_deliverable_id and revision = p_revision and signed_by = auth.uid()
                and signoff_kind <> p_signoff_kind and (v_since is null or created_at > v_since)) then
    raise exception 'the strategist and QA signoffs come from two different people' using errcode = '22023';
  end if;
  insert into public.engagement_deliverable_signoffs (deliverable_id, revision, signoff_kind, signed_by, created_at)
  values (p_deliverable_id, p_revision, p_signoff_kind, auth.uid(), clock_timestamp())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: mark the current revision final with its download link, only
-- when every release check passes.
create or replace function public.mark_deliverable_final_ready(
  p_deliverable_id uuid,
  p_revision integer,
  p_final_download_url text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deliverable public.engagement_deliverables;
  v_blockers text[];
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can release a deliverable' using errcode = 'insufficient_privilege';
  end if;
  select * into v_deliverable from public.engagement_deliverables where id = p_deliverable_id for update;
  if v_deliverable.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_deliverable.current_revision <> p_revision then
    raise exception 'only the current revision is released' using errcode = '40001';
  end if;
  v_blockers := public.deliverable_release_blockers(p_deliverable_id);
  if cardinality(v_blockers) > 0 then
    raise exception 'not ready to send: %', array_to_string(v_blockers, ', ') using errcode = '22023';
  end if;
  update public.engagement_deliverables
     set stage = 'final_ready', final_download_url = btrim(p_final_download_url)
   where id = p_deliverable_id;
  return 'final_ready';
end;
$$;

revoke all on function public.deliverable_release_status(uuid),
  public.confirm_deliverable_revision(uuid, integer),
  public.return_deliverable_to_strategist(uuid, integer, text),
  public.resolve_deliverable_qa_return(uuid, text),
  public.record_deliverable_signoff(uuid, integer, text),
  public.mark_deliverable_final_ready(uuid, integer, text)
  from public, anon;
grant execute on function public.deliverable_release_status(uuid),
  public.confirm_deliverable_revision(uuid, integer),
  public.return_deliverable_to_strategist(uuid, integer, text),
  public.resolve_deliverable_qa_return(uuid, text),
  public.record_deliverable_signoff(uuid, integer, text),
  public.mark_deliverable_final_ready(uuid, integer, text)
  to authenticated, service_role;
