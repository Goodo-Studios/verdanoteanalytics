-- Goodo OS wave C: strategy proposals (consolidation step 4c). Port of Goodo OS
-- migrations 029_strategy_proposals.sql and 030_strategy_proposal_publications.sql
-- and backend/services/strategyProposals.ts, on the engagements of migration
-- 20261109000004 and the idea and shot list approvals of migration 20261110120002.
--
--   strategy_proposals               one proposal per engagement strategy: current
--                                    version. Changed only by the functions below.
--   strategy_proposal_versions       every version: the published idea or shot list
--                                    version it is based on, title, summary, brief,
--                                    angle, goal and required inputs. Immutable.
--   strategy_proposal_reviews        a staff review of one exact version (reviewed or
--                                    changes requested, with a note). Immutable.
--   strategy_proposal_acceptances    acceptance of one exact reviewed version. Immutable.
--   strategy_proposal_publications   the accepted version published as the strategy of
--                                    the engagement. Immutable. Internal only: clients
--                                    read nothing here (client publication is phase 2).
--
-- Rules ported from Goodo OS: a version names the exact published version of an idea
-- or shot list of the same engagement, and every review, acceptance and publication
-- re-checks that this source is still the published version (40001 when it moved on);
-- acceptance needs the latest review of that exact version to be "reviewed";
-- publication needs an acceptance of that exact version. History never changes.
--
-- Differences (conservative stand-ins, see "Needs the owner" in the plan): Goodo OS
-- let agents author proposals and bound review and acceptance to the engagement's
-- strategist capability. Here any builder or employee writes a proposal, and the
-- reviewer and the person accepting must not be the author of that version. Goodo OS
-- publication went to the client portal; here it is internal and feeds the handoff
-- brief (create_handoff_packet below takes the published version as its source).
--
-- Handoffs: create_handoff_packet gains two optional arguments naming the published
-- strategy proposal version the brief started from. The packet keeps that reference on
-- every revision; staff can still edit the brief, angle, goal and inputs before saving.
--
-- Staff read every table; clients read nothing. Writes go only through the checked
-- functions (SECURITY DEFINER, each refuses non-staff in its own body).
--
-- Not ported: command receipts, the strategy selection state (US-021 client idea
-- selection belongs to the client portal), the client publication and the client
-- strategy page. Tests: supabase/tests/strategy_proposals_test.sql.

create table public.strategy_proposals (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,
  client_slug text not null,
  current_version integer not null default 1 check (current_version >= 1),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint strategy_proposals_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict
);
create index strategy_proposals_engagement_idx on public.strategy_proposals (engagement_id);

create table public.strategy_proposal_versions (
  proposal_id uuid not null references public.strategy_proposals(id) on delete restrict,
  version integer not null check (version >= 1),
  source_subject_id uuid not null,
  source_version integer not null check (source_version >= 1),
  title text not null check (length(btrim(title)) between 1 and 200),
  summary text not null check (length(btrim(summary)) between 1 and 2000),
  brief text not null check (length(btrim(brief)) between 1 and 100000),
  angle text not null check (length(btrim(angle)) between 1 and 10000),
  goal text not null check (length(btrim(goal)) between 1 and 10000),
  required_inputs text[] not null check (cardinality(required_inputs) between 1 and 50),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (proposal_id, version),
  foreign key (source_subject_id, source_version) references public.approval_subject_versions(subject_id, version) on delete restrict
);

create table public.strategy_proposal_reviews (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null,
  version integer not null,
  decision text not null check (decision in ('reviewed', 'changes_requested')),
  note text not null check (length(btrim(note)) between 1 and 4000),
  reviewer_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (proposal_id, version) references public.strategy_proposal_versions(proposal_id, version) on delete restrict
);
create index strategy_proposal_reviews_version_idx on public.strategy_proposal_reviews (proposal_id, version, created_at desc);

create table public.strategy_proposal_acceptances (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null,
  version integer not null,
  accepted_by uuid not null,
  created_at timestamptz not null default now(),
  unique (proposal_id, version),
  foreign key (proposal_id, version) references public.strategy_proposal_versions(proposal_id, version) on delete restrict
);

create table public.strategy_proposal_publications (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null,
  version integer not null,
  engagement_id uuid not null,
  published_by uuid not null,
  created_at timestamptz not null default now(),
  unique (proposal_id, version),
  foreign key (proposal_id, version) references public.strategy_proposal_acceptances(proposal_id, version) on delete restrict
);
create index strategy_proposal_publications_engagement_idx on public.strategy_proposal_publications (engagement_id, created_at desc);

comment on table public.strategy_proposals is 'Strategy proposals per engagement (port of Goodo OS strategy_proposals). Staff only; written by the strategy functions.';
comment on table public.strategy_proposal_versions is 'Every version of a strategy proposal with its approved idea or shot list source. Staff only. Immutable.';
comment on table public.strategy_proposal_reviews is 'Staff review of one exact strategy proposal version. Staff only. Immutable.';
comment on table public.strategy_proposal_acceptances is 'Acceptance of one exact reviewed strategy proposal version. Staff only. Immutable.';
comment on table public.strategy_proposal_publications is 'Accepted strategy proposal versions published as the engagement strategy (internal; feeds handoff briefs). Staff only. Immutable.';

create trigger update_strategy_proposals_updated_at before update on public.strategy_proposals
  for each row execute function public.update_updated_at_column();

create or replace function public.prevent_strategy_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'strategy proposal history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_strategy_history_rewrite() from public, anon;

create trigger strategy_proposal_versions_immutable before update or delete on public.strategy_proposal_versions
  for each row execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposal_reviews_immutable before update or delete on public.strategy_proposal_reviews
  for each row execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposal_acceptances_immutable before update or delete on public.strategy_proposal_acceptances
  for each row execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposal_publications_immutable before update or delete on public.strategy_proposal_publications
  for each row execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposals_no_delete before delete on public.strategy_proposals
  for each row execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposal_versions_no_truncate before truncate on public.strategy_proposal_versions
  for each statement execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposal_reviews_no_truncate before truncate on public.strategy_proposal_reviews
  for each statement execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposal_acceptances_no_truncate before truncate on public.strategy_proposal_acceptances
  for each statement execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposal_publications_no_truncate before truncate on public.strategy_proposal_publications
  for each statement execute function public.prevent_strategy_history_rewrite();
create trigger strategy_proposals_no_truncate before truncate on public.strategy_proposals
  for each statement execute function public.prevent_strategy_history_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.strategy_proposals enable row level security;
alter table public.strategy_proposal_versions enable row level security;
alter table public.strategy_proposal_reviews enable row level security;
alter table public.strategy_proposal_acceptances enable row level security;
alter table public.strategy_proposal_publications enable row level security;

revoke all on table public.strategy_proposals, public.strategy_proposal_versions, public.strategy_proposal_reviews,
  public.strategy_proposal_acceptances, public.strategy_proposal_publications
  from public, anon, authenticated;
grant select on table public.strategy_proposals, public.strategy_proposal_versions, public.strategy_proposal_reviews,
  public.strategy_proposal_acceptances, public.strategy_proposal_publications to authenticated;
grant all on table public.strategy_proposals, public.strategy_proposal_versions, public.strategy_proposal_reviews,
  public.strategy_proposal_acceptances, public.strategy_proposal_publications to service_role;

create policy "Builder/employee can read strategy_proposals" on public.strategy_proposals
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read strategy_proposal_versions" on public.strategy_proposal_versions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read strategy_proposal_reviews" on public.strategy_proposal_reviews
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read strategy_proposal_acceptances" on public.strategy_proposal_acceptances
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read strategy_proposal_publications" on public.strategy_proposal_publications
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ helpers (internal)

-- Refuses a source that is not the published version of an idea or shot list of this
-- engagement right now. P0002 when the subject is not on the engagement, 40001 when
-- the version is not (or no longer) the published one.
create or replace function public.check_strategy_source(p_engagement_id uuid, p_subject_id uuid, p_version integer)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_subject public.approval_subjects;
  v_state text;
begin
  select * into v_subject from public.approval_subjects where id = p_subject_id;
  if v_subject.id is null or v_subject.engagement_id <> p_engagement_id then
    raise exception 'the idea or shot list is not on this engagement' using errcode = 'P0002';
  end if;
  select state into v_state from public.approval_subject_versions where subject_id = p_subject_id and version = p_version;
  if v_state is distinct from 'published' or v_subject.published_version is distinct from p_version then
    raise exception 'the source is no longer the published version' using errcode = '40001';
  end if;
end;
$$;

-- Trims the required inputs; 22023 when any is empty or too long.
create or replace function public.clean_required_inputs(p_inputs text[])
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v text[];
begin
  select array_agg(btrim(x)) into v from unnest(p_inputs) x where nullif(btrim(x), '') is not null;
  if v is null or cardinality(v) <> cardinality(p_inputs) or cardinality(v) > 50 or exists (select 1 from unnest(v) x where length(x) > 2000) then
    raise exception 'required inputs are 1 to 50 entries of 1 to 2000 characters' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function public.check_strategy_source(uuid, uuid, integer), public.clean_required_inputs(text[])
  from public, anon, authenticated;
grant execute on function public.check_strategy_source(uuid, uuid, integer), public.clean_required_inputs(text[]) to service_role;

-- ------------------------------------------------------------------ checked functions

-- Builder or employee: a new proposal (version 1) based on a published idea or shot list.
create or replace function public.create_strategy_proposal(
  p_engagement_id uuid,
  p_source_subject_id uuid,
  p_source_version integer,
  p_title text,
  p_summary text,
  p_brief text,
  p_angle text,
  p_goal text,
  p_required_inputs text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_engagement public.engagements;
  v_inputs text[];
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can write a strategy proposal' using errcode = 'insufficient_privilege';
  end if;
  select * into v_engagement from public.engagements where id = p_engagement_id for share;
  if v_engagement.id is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  if v_engagement.status in ('closed', 'cancelled') then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  perform 1 from public.approval_subjects where id = p_source_subject_id for share;
  perform public.check_strategy_source(p_engagement_id, p_source_subject_id, p_source_version);
  v_inputs := public.clean_required_inputs(p_required_inputs);
  insert into public.strategy_proposals (engagement_id, client_slug, created_by)
  values (p_engagement_id, v_engagement.client_slug, auth.uid())
  returning id into v_id;
  insert into public.strategy_proposal_versions (proposal_id, version, source_subject_id, source_version, title, summary, brief, angle, goal,
                                                 required_inputs, created_by)
  values (v_id, 1, p_source_subject_id, p_source_version, btrim(p_title), btrim(p_summary), btrim(p_brief), btrim(p_angle), btrim(p_goal),
          v_inputs, auth.uid());
  return v_id;
end;
$$;

-- Builder or employee: the next version of a proposal, written against the version on
-- screen (40001 when stale). A version that was already accepted cannot be revised.
create or replace function public.revise_strategy_proposal(
  p_proposal_id uuid,
  p_expected_version integer,
  p_source_subject_id uuid,
  p_source_version integer,
  p_title text,
  p_summary text,
  p_brief text,
  p_angle text,
  p_goal text,
  p_required_inputs text[]
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_proposal public.strategy_proposals;
  v_inputs text[];
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can revise a strategy proposal' using errcode = 'insufficient_privilege';
  end if;
  select * into v_proposal from public.strategy_proposals where id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'strategy proposal not found' using errcode = 'P0002';
  end if;
  if v_proposal.current_version <> p_expected_version then
    raise exception 'the proposal changed since it was shown' using errcode = '40001';
  end if;
  if exists (select 1 from public.strategy_proposal_acceptances where proposal_id = p_proposal_id and version = p_expected_version) then
    raise exception 'an accepted version is not revised' using errcode = '22023';
  end if;
  if exists (select 1 from public.engagements where id = v_proposal.engagement_id and status in ('closed', 'cancelled')) then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  perform 1 from public.approval_subjects where id = p_source_subject_id for share;
  perform public.check_strategy_source(v_proposal.engagement_id, p_source_subject_id, p_source_version);
  v_inputs := public.clean_required_inputs(p_required_inputs);
  insert into public.strategy_proposal_versions (proposal_id, version, source_subject_id, source_version, title, summary, brief, angle, goal,
                                                 required_inputs, created_by)
  values (p_proposal_id, p_expected_version + 1, p_source_subject_id, p_source_version, btrim(p_title), btrim(p_summary), btrim(p_brief),
          btrim(p_angle), btrim(p_goal), v_inputs, auth.uid());
  update public.strategy_proposals set current_version = p_expected_version + 1 where id = p_proposal_id;
  return p_expected_version + 1;
end;
$$;

-- Builder or employee who did not write the version: review the current version
-- (reviewed or changes requested, with a note). The source must still be published.
create or replace function public.review_strategy_proposal(
  p_proposal_id uuid,
  p_version integer,
  p_decision text,
  p_note text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_proposal public.strategy_proposals;
  v_version public.strategy_proposal_versions;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can review a strategy proposal' using errcode = 'insufficient_privilege';
  end if;
  select * into v_proposal from public.strategy_proposals where id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'strategy proposal not found' using errcode = 'P0002';
  end if;
  if v_proposal.current_version <> p_version then
    raise exception 'the proposal changed since it was shown' using errcode = '40001';
  end if;
  select * into v_version from public.strategy_proposal_versions where proposal_id = p_proposal_id and version = p_version;
  if v_version.created_by = auth.uid() then
    raise exception 'the author does not review their own version' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.strategy_proposal_acceptances where proposal_id = p_proposal_id and version = p_version) then
    raise exception 'this version is already accepted' using errcode = '22023';
  end if;
  if p_decision not in ('reviewed', 'changes_requested') then
    raise exception 'reviewed or changes requested' using errcode = '22023';
  end if;
  perform public.check_strategy_source(v_proposal.engagement_id, v_version.source_subject_id, v_version.source_version);
  insert into public.strategy_proposal_reviews (proposal_id, version, decision, note, reviewer_id)
  values (p_proposal_id, p_version, p_decision, btrim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee who did not write the version: accept the current version once
-- its latest review is "reviewed" and its source is still published.
create or replace function public.accept_strategy_proposal(p_proposal_id uuid, p_version integer)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_proposal public.strategy_proposals;
  v_version public.strategy_proposal_versions;
  v_latest text;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can accept a strategy proposal' using errcode = 'insufficient_privilege';
  end if;
  select * into v_proposal from public.strategy_proposals where id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'strategy proposal not found' using errcode = 'P0002';
  end if;
  if v_proposal.current_version <> p_version then
    raise exception 'the proposal changed since it was shown' using errcode = '40001';
  end if;
  select * into v_version from public.strategy_proposal_versions where proposal_id = p_proposal_id and version = p_version;
  if v_version.created_by = auth.uid() then
    raise exception 'the author does not accept their own version' using errcode = 'insufficient_privilege';
  end if;
  select decision into v_latest from public.strategy_proposal_reviews
   where proposal_id = p_proposal_id and version = p_version order by created_at desc, id desc limit 1;
  if v_latest is distinct from 'reviewed' then
    raise exception 'the version needs a review first' using errcode = '22023';
  end if;
  perform public.check_strategy_source(v_proposal.engagement_id, v_version.source_subject_id, v_version.source_version);
  insert into public.strategy_proposal_acceptances (proposal_id, version, accepted_by)
  values (p_proposal_id, p_version, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: publish the accepted current version as the engagement strategy.
-- Internal only; the latest publication is what handoff briefs start from.
create or replace function public.publish_strategy_proposal(p_proposal_id uuid, p_version integer)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_proposal public.strategy_proposals;
  v_version public.strategy_proposal_versions;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can publish a strategy proposal' using errcode = 'insufficient_privilege';
  end if;
  select * into v_proposal from public.strategy_proposals where id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'strategy proposal not found' using errcode = 'P0002';
  end if;
  if v_proposal.current_version <> p_version then
    raise exception 'the proposal changed since it was shown' using errcode = '40001';
  end if;
  if not exists (select 1 from public.strategy_proposal_acceptances where proposal_id = p_proposal_id and version = p_version) then
    raise exception 'the version must be accepted first' using errcode = '22023';
  end if;
  if exists (select 1 from public.strategy_proposal_publications where proposal_id = p_proposal_id and version = p_version) then
    raise exception 'this version is already published' using errcode = '22023';
  end if;
  if exists (select 1 from public.engagements where id = v_proposal.engagement_id and status in ('closed', 'cancelled')) then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  select * into v_version from public.strategy_proposal_versions where proposal_id = p_proposal_id and version = p_version;
  perform public.check_strategy_source(v_proposal.engagement_id, v_version.source_subject_id, v_version.source_version);
  insert into public.strategy_proposal_publications (proposal_id, version, engagement_id, published_by)
  values (p_proposal_id, p_version, v_proposal.engagement_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: the latest published strategy of an engagement, for prefilling
-- a handoff brief. No row when nothing is published.
create or replace function public.published_strategy_for_engagement(p_engagement_id uuid)
returns table (proposal_id uuid, version integer, title text, summary text, brief text, angle text, goal text,
               required_inputs text[], published_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can read the engagement strategy' using errcode = 'insufficient_privilege';
  end if;
  return query
    select v.proposal_id, v.version, v.title, v.summary, v.brief, v.angle, v.goal, v.required_inputs, p.created_at
      from public.strategy_proposal_publications p
      join public.strategy_proposal_versions v on v.proposal_id = p.proposal_id and v.version = p.version
     where p.engagement_id = p_engagement_id
     order by p.created_at desc, p.id desc
     limit 1;
end;
$$;

revoke all on function public.create_strategy_proposal(uuid, uuid, integer, text, text, text, text, text, text[]),
  public.revise_strategy_proposal(uuid, integer, uuid, integer, text, text, text, text, text, text[]),
  public.review_strategy_proposal(uuid, integer, text, text),
  public.accept_strategy_proposal(uuid, integer),
  public.publish_strategy_proposal(uuid, integer),
  public.published_strategy_for_engagement(uuid)
  from public, anon;
grant execute on function public.create_strategy_proposal(uuid, uuid, integer, text, text, text, text, text, text[]),
  public.revise_strategy_proposal(uuid, integer, uuid, integer, text, text, text, text, text, text[]),
  public.review_strategy_proposal(uuid, integer, text, text),
  public.accept_strategy_proposal(uuid, integer),
  public.publish_strategy_proposal(uuid, integer),
  public.published_strategy_for_engagement(uuid)
  to authenticated, service_role;

-- ------------------------------------------------------------------ handoffs prefilled from the strategy

-- Each packet version may name the published strategy proposal version its brief
-- started from. Both columns or neither; the publication must exist.
alter table public.handoff_packet_versions
  add column strategy_proposal_id uuid,
  add column strategy_proposal_version integer,
  add constraint handoff_packet_versions_strategy_pair check ((strategy_proposal_id is null) = (strategy_proposal_version is null)),
  add constraint handoff_packet_versions_strategy_fkey foreign key (strategy_proposal_id, strategy_proposal_version)
    references public.strategy_proposal_publications(proposal_id, version) on delete restrict;

drop function public.create_handoff_packet(uuid, text, uuid, uuid, date, text, text, text, text[]);

-- As in migration 20261110120004, plus the optional published strategy source. When
-- given, the proposal version must be published for this same engagement. The brief,
-- angle, goal and inputs are what the strategist saved (they may differ from the
-- proposal); the reference records where they started.
create or replace function public.create_handoff_packet(
  p_engagement_id uuid,
  p_receiving_role text,
  p_receiver_id uuid,
  p_accountable_owner_id uuid,
  p_due_date date,
  p_brief text,
  p_angle text,
  p_goal text,
  p_required_inputs text[],
  p_strategy_proposal_id uuid default null,
  p_strategy_proposal_version integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_engagement public.engagements;
  v_assets jsonb;
  v_inputs text[];
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can create a handoff' using errcode = 'insufficient_privilege';
  end if;
  select * into v_engagement from public.engagements where id = p_engagement_id for share;
  if v_engagement.id is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  if v_engagement.status in ('closed', 'cancelled') then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  if not public.is_staff_login(p_receiver_id) or not public.is_staff_login(p_accountable_owner_id) then
    raise exception 'the receiver and the accountable owner must be staff' using errcode = '22023';
  end if;
  if (p_strategy_proposal_id is null) <> (p_strategy_proposal_version is null) then
    raise exception 'name both the strategy proposal and its version, or neither' using errcode = '22023';
  end if;
  if p_strategy_proposal_id is not null and not exists (
       select 1 from public.strategy_proposal_publications
        where proposal_id = p_strategy_proposal_id and version = p_strategy_proposal_version and engagement_id = p_engagement_id) then
    raise exception 'that strategy proposal version is not published for this engagement' using errcode = '22023';
  end if;
  select array_agg(btrim(x)) into v_inputs from unnest(p_required_inputs) x where nullif(btrim(x), '') is not null;
  if v_inputs is null or cardinality(v_inputs) <> cardinality(p_required_inputs) or exists (select 1 from unnest(v_inputs) x where length(x) > 2000) then
    raise exception 'required inputs are 1 to 50 entries of 1 to 2000 characters' using errcode = '22023';
  end if;
  v_assets := public.handoff_asset_snapshot(p_engagement_id);
  perform public.check_handoff_source(p_receiving_role, v_assets);
  insert into public.handoff_packets (engagement_id, client_slug, receiving_role, receiver_id, accountable_owner_id, due_date, created_by)
  values (p_engagement_id, v_engagement.client_slug, p_receiving_role, p_receiver_id, p_accountable_owner_id, p_due_date, auth.uid())
  returning id into v_id;
  insert into public.handoff_packet_versions (packet_id, revision, brief, angle, goal, required_inputs, assets, receiving_role,
                                              receiver_id, accountable_owner_id, due_date, action, fingerprint, created_by,
                                              strategy_proposal_id, strategy_proposal_version)
  values (v_id, 1, btrim(p_brief), btrim(p_angle), btrim(p_goal), v_inputs, v_assets, p_receiving_role,
          p_receiver_id, p_accountable_owner_id, p_due_date, 'created',
          public.handoff_fingerprint(btrim(p_brief), btrim(p_angle), btrim(p_goal), v_inputs, v_assets,
                                     p_accountable_owner_id, p_receiver_id, p_receiving_role, p_due_date),
          auth.uid(), p_strategy_proposal_id, p_strategy_proposal_version);
  return v_id;
end;
$$;

revoke all on function public.create_handoff_packet(uuid, text, uuid, uuid, date, text, text, text, text[], uuid, integer) from public, anon;
grant execute on function public.create_handoff_packet(uuid, text, uuid, uuid, date, text, text, text, text[], uuid, integer)
  to authenticated, service_role;

-- Reassignment keeps the strategy reference of the revision it copies the brief from.
create or replace function public.reassign_handoff(
  p_packet_id uuid,
  p_expected_revision integer,
  p_receiver_id uuid,
  p_receiving_role text,
  p_due_date date,
  p_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_packet public.handoff_packets;
  v_version public.handoff_packet_versions;
  v_assets jsonb;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can reassign a handoff' using errcode = 'insufficient_privilege';
  end if;
  select * into v_packet from public.handoff_packets where id = p_packet_id for update;
  if v_packet.id is null then
    raise exception 'handoff not found' using errcode = 'P0002';
  end if;
  if not (auth.uid() in (v_packet.accountable_owner_id, v_packet.created_by) or public.has_role(auth.uid(), 'builder'::public.app_role)) then
    raise exception 'only the accountable owner, the creator or a builder reassigns a handoff' using errcode = 'insufficient_privilege';
  end if;
  if v_packet.current_revision <> p_expected_revision then
    raise exception 'the handoff changed since it was shown' using errcode = '40001';
  end if;
  if not public.is_staff_login(p_receiver_id) then
    raise exception 'the receiver must be staff' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'a reassignment needs a reason' using errcode = '22023';
  end if;
  if exists (select 1 from public.engagements where id = v_packet.engagement_id and status in ('closed', 'cancelled')) then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  select * into v_version from public.handoff_packet_versions where packet_id = p_packet_id and revision = v_packet.current_revision;
  v_assets := public.handoff_asset_snapshot(v_packet.engagement_id);
  perform public.check_handoff_source(p_receiving_role, v_assets);
  insert into public.handoff_packet_versions (packet_id, revision, brief, angle, goal, required_inputs, assets, receiving_role,
                                              receiver_id, accountable_owner_id, due_date, action, reason, fingerprint, created_by,
                                              strategy_proposal_id, strategy_proposal_version)
  values (p_packet_id, v_packet.current_revision + 1, v_version.brief, v_version.angle, v_version.goal, v_version.required_inputs,
          v_assets, p_receiving_role, p_receiver_id, v_packet.accountable_owner_id, p_due_date, 'reassigned', btrim(p_reason),
          public.handoff_fingerprint(v_version.brief, v_version.angle, v_version.goal, v_version.required_inputs, v_assets,
                                     v_packet.accountable_owner_id, p_receiver_id, p_receiving_role, p_due_date),
          auth.uid(), v_version.strategy_proposal_id, v_version.strategy_proposal_version);
  update public.handoff_packets
     set current_revision = v_packet.current_revision + 1, receiver_id = p_receiver_id, receiving_role = p_receiving_role,
         due_date = p_due_date, status = 'ready'
   where id = p_packet_id;
  return v_packet.current_revision + 1;
end;
$$;
