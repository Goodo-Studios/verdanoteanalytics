-- Goodo OS wave B: deliverables and approvals (consolidation step 4b). Port of Goodo
-- OS migrations 021_deliverables.sql (deliverable assets, exact revisions, client
-- rounds and round exceptions) and 008_approvals.sql (exact-version decisions on
-- ideas and shot lists), on the engagements of migration 20261109000004 and the
-- engagement terms of migration 20261110120001.
--
--   engagement_deliverables               one deliverable of an engagement (a video,
--                                         image, design or document), with its current
--                                         revision and stage. Changed only by the
--                                         functions below.
--   engagement_deliverable_revisions      every revision staff add: the review link
--                                         (Air) and an optional Air revision id.
--                                         Immutable.
--   engagement_deliverable_decisions      the client's decision on one exact revision
--                                         (approved or changes requested), recorded
--                                         by staff with where it came from. One per
--                                         revision. Immutable.
--   engagement_deliverable_round_exceptions  a request for a client round beyond the
--                                         included rounds, decided once by a builder.
--   approval_subjects                     an idea or shot list of an engagement that
--                                         the client approves.
--   approval_subject_versions             its numbered versions: draft, published,
--                                         superseded. Text never changes.
--   approval_subject_decisions            the client's decision on one published
--                                         version, recorded by staff. Immutable.
--
-- Staff read every table; clients read nothing (the Goodo OS client portal screens
-- are dropped; client views are phase 2). A client decision reaches Verdanote the way
-- it reaches Goodo today, on a call, in Slack or by email, and a staff member records
-- it with that channel and a note. Writes go only through the checked functions
-- (SECURITY DEFINER, each refuses non-staff in its own body).
--
-- Client rounds: a deliverable gets the clientRevisionRounds of its agreed
-- deliverable in the engagement terms; without one, 2 rounds, or 0 for a custom
-- engagement (Goodo OS defaults). A changes-requested decision beyond that opens a
-- round exception instead of being recorded; once a builder approves it, one more
-- round can be recorded for that revision.
--
-- Not ported: the Air connector (staff paste the review link; nothing is fetched),
-- health observations, the command receipt tables, approval sync events and the
-- client portal. Tests: supabase/tests/deliverables_approvals_test.sql.

create table public.engagement_deliverables (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,
  client_slug text not null,
  title text not null check (length(btrim(title)) between 1 and 500),
  asset_kind text not null check (asset_kind in ('video', 'image', 'design', 'document', 'other')),
  agreed_item text check (agreed_item is null or length(btrim(agreed_item)) between 1 and 200),
  current_revision integer not null default 0 check (current_revision >= 0),
  stage text not null default 'not_started'
    check (stage in ('not_started', 'client_review', 'changes_requested', 'client_approved', 'internal_qa', 'final_ready', 'withdrawn')),
  final_download_url text check (final_download_url is null or (final_download_url ~ '^https://\S+$' and length(final_download_url) <= 2000)),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engagement_deliverables_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict,
  check ((stage = 'final_ready') = (final_download_url is not null)),
  check ((stage = 'not_started') = (current_revision = 0) or stage = 'withdrawn')
);
create index engagement_deliverables_engagement_idx on public.engagement_deliverables (engagement_id);

create table public.engagement_deliverable_revisions (
  deliverable_id uuid not null references public.engagement_deliverables(id) on delete restrict,
  revision integer not null check (revision >= 1),
  review_url text not null check (review_url ~ '^https://\S+$' and length(review_url) <= 2000),
  air_revision_id text check (air_revision_id is null or length(btrim(air_revision_id)) between 1 and 200),
  note text check (note is null or length(note) <= 2000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (deliverable_id, revision)
);

create table public.engagement_deliverable_decisions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null,
  revision integer not null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  client_round integer check (client_round is null or client_round >= 1),
  channel text not null check (channel in ('call', 'slack', 'email')),
  source_note text not null check (length(btrim(source_note)) between 1 and 4000),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (deliverable_id, revision),
  foreign key (deliverable_id, revision) references public.engagement_deliverable_revisions(deliverable_id, revision) on delete restrict,
  check ((decision = 'changes_requested') = (client_round is not null))
);

create table public.engagement_deliverable_round_exceptions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null,
  revision integer not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  requested_by uuid not null,
  decided_by uuid,
  decision_reason text check (decision_reason is null or length(btrim(decision_reason)) between 1 and 2000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (deliverable_id, revision),
  foreign key (deliverable_id, revision) references public.engagement_deliverable_revisions(deliverable_id, revision) on delete restrict,
  check ((status = 'pending') = (decided_by is null and decided_at is null and decision_reason is null))
);

create table public.approval_subjects (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,
  client_slug text not null,
  subject_kind text not null check (subject_kind in ('idea', 'shot_list')),
  title text not null check (length(btrim(title)) between 1 and 300),
  current_version integer not null default 0 check (current_version >= 0),
  published_version integer check (published_version is null or published_version >= 1),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_subjects_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict
);
create index approval_subjects_engagement_idx on public.approval_subjects (engagement_id);

create table public.approval_subject_versions (
  subject_id uuid not null references public.approval_subjects(id) on delete restrict,
  version integer not null check (version >= 1),
  state text not null default 'draft' check (state in ('draft', 'published', 'superseded')),
  body text not null check (length(btrim(body)) between 1 and 20000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  primary key (subject_id, version),
  check ((state = 'draft') = (published_at is null and published_by is null))
);

create table public.approval_subject_decisions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  version integer not null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  channel text not null check (channel in ('call', 'slack', 'email')),
  source_note text not null check (length(btrim(source_note)) between 1 and 4000),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (subject_id, version),
  foreign key (subject_id, version) references public.approval_subject_versions(subject_id, version) on delete restrict
);

comment on table public.engagement_deliverables is 'Deliverables of an engagement (port of Goodo OS deliverable_assets). Staff only; written by the deliverable functions.';
comment on table public.engagement_deliverable_revisions is 'Every revision of a deliverable with its review link. Staff only. Immutable.';
comment on table public.engagement_deliverable_decisions is 'Client decision on one exact deliverable revision, recorded by staff. Staff only. Immutable.';
comment on table public.engagement_deliverable_round_exceptions is 'Client rounds beyond the included rounds, decided once by a builder. Staff only.';
comment on table public.approval_subjects is 'Ideas and shot lists the client approves (port of Goodo OS approval_subjects). Staff only.';
comment on table public.approval_subject_versions is 'Numbered versions of an approval subject. Text never changes. Staff only.';
comment on table public.approval_subject_decisions is 'Client decision on one published version, recorded by staff. Staff only. Immutable.';

create trigger update_engagement_deliverables_updated_at before update on public.engagement_deliverables
  for each row execute function public.update_updated_at_column();
create trigger update_approval_subjects_updated_at before update on public.approval_subjects
  for each row execute function public.update_updated_at_column();

-- ------------------------------------------------------------------ history rules

create or replace function public.prevent_deliverable_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'deliverable and approval history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_deliverable_history_rewrite() from public, anon;

create trigger engagement_deliverable_revisions_immutable before update or delete on public.engagement_deliverable_revisions
  for each row execute function public.prevent_deliverable_history_rewrite();
create trigger engagement_deliverable_decisions_immutable before update or delete on public.engagement_deliverable_decisions
  for each row execute function public.prevent_deliverable_history_rewrite();
create trigger approval_subject_decisions_immutable before update or delete on public.approval_subject_decisions
  for each row execute function public.prevent_deliverable_history_rewrite();
create trigger engagement_deliverables_no_delete before delete on public.engagement_deliverables
  for each row execute function public.prevent_deliverable_history_rewrite();
create trigger engagement_deliverable_round_exceptions_no_delete before delete on public.engagement_deliverable_round_exceptions
  for each row execute function public.prevent_deliverable_history_rewrite();
create trigger approval_subjects_no_delete before delete on public.approval_subjects
  for each row execute function public.prevent_deliverable_history_rewrite();
create trigger engagement_deliverables_no_truncate before truncate on public.engagement_deliverables
  for each statement execute function public.prevent_deliverable_history_rewrite();
create trigger engagement_deliverable_revisions_no_truncate before truncate on public.engagement_deliverable_revisions
  for each statement execute function public.prevent_deliverable_history_rewrite();
create trigger engagement_deliverable_decisions_no_truncate before truncate on public.engagement_deliverable_decisions
  for each statement execute function public.prevent_deliverable_history_rewrite();
create trigger engagement_deliverable_round_exceptions_no_truncate before truncate on public.engagement_deliverable_round_exceptions
  for each statement execute function public.prevent_deliverable_history_rewrite();
create trigger approval_subjects_no_truncate before truncate on public.approval_subjects
  for each statement execute function public.prevent_deliverable_history_rewrite();
create trigger approval_subject_versions_no_truncate before truncate on public.approval_subject_versions
  for each statement execute function public.prevent_deliverable_history_rewrite();
create trigger approval_subject_decisions_no_truncate before truncate on public.approval_subject_decisions
  for each statement execute function public.prevent_deliverable_history_rewrite();

-- A round exception is decided once.
create or replace function public.guard_round_exception_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'pending' or new.deliverable_id is distinct from old.deliverable_id or new.revision is distinct from old.revision
     or new.reason is distinct from old.reason or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a round exception is decided once' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_round_exception_update() from public, anon;
create trigger engagement_deliverable_round_exceptions_guard before update on public.engagement_deliverable_round_exceptions
  for each row execute function public.guard_round_exception_update();

-- Approval versions: the text never changes; only draft -> published -> superseded
-- (port of Goodo OS reject_approval_history_mutation).
create or replace function public.guard_approval_version_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'approval history is append-only' using errcode = '23514';
  end if;
  if new.subject_id = old.subject_id and new.version = old.version and new.body = old.body
     and new.created_by = old.created_by and new.created_at = old.created_at
     and ((old.state = 'draft' and new.state = 'published' and new.published_at is not null and new.published_by is not null)
       or (old.state = 'published' and new.state = 'superseded' and new.published_at = old.published_at and new.published_by = old.published_by)) then
    return new;
  end if;
  raise exception 'approval history is append-only' using errcode = '23514';
end;
$$;
revoke all on function public.guard_approval_version_update() from public, anon;
create trigger approval_subject_versions_guard before update or delete on public.approval_subject_versions
  for each row execute function public.guard_approval_version_update();

-- ------------------------------------------------------------------ grants and row rules

alter table public.engagement_deliverables enable row level security;
alter table public.engagement_deliverable_revisions enable row level security;
alter table public.engagement_deliverable_decisions enable row level security;
alter table public.engagement_deliverable_round_exceptions enable row level security;
alter table public.approval_subjects enable row level security;
alter table public.approval_subject_versions enable row level security;
alter table public.approval_subject_decisions enable row level security;

revoke all on table public.engagement_deliverables, public.engagement_deliverable_revisions,
  public.engagement_deliverable_decisions, public.engagement_deliverable_round_exceptions,
  public.approval_subjects, public.approval_subject_versions, public.approval_subject_decisions
  from public, anon, authenticated;
grant select on table public.engagement_deliverables, public.engagement_deliverable_revisions,
  public.engagement_deliverable_decisions, public.engagement_deliverable_round_exceptions,
  public.approval_subjects, public.approval_subject_versions, public.approval_subject_decisions
  to authenticated;
grant all on table public.engagement_deliverables, public.engagement_deliverable_revisions,
  public.engagement_deliverable_decisions, public.engagement_deliverable_round_exceptions,
  public.approval_subjects, public.approval_subject_versions, public.approval_subject_decisions
  to service_role;

create policy "Builder/employee can read engagement_deliverables" on public.engagement_deliverables
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_deliverable_revisions" on public.engagement_deliverable_revisions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_deliverable_decisions" on public.engagement_deliverable_decisions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_deliverable_round_exceptions" on public.engagement_deliverable_round_exceptions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read approval_subjects" on public.approval_subjects
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read approval_subject_versions" on public.approval_subject_versions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read approval_subject_decisions" on public.approval_subject_decisions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ checked functions: deliverables

-- Builder or employee: add a deliverable to an engagement that is not closed or
-- cancelled. agreed_item names the agreed deliverable whose rounds it uses.
create or replace function public.add_engagement_deliverable(
  p_engagement_id uuid,
  p_title text,
  p_asset_kind text,
  p_agreed_item text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_engagement public.engagements;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can add a deliverable' using errcode = 'insufficient_privilege';
  end if;
  select * into v_engagement from public.engagements where id = p_engagement_id for share;
  if v_engagement.id is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  if v_engagement.status in ('closed', 'cancelled') then
    raise exception 'the engagement is closed' using errcode = '22023';
  end if;
  insert into public.engagement_deliverables (engagement_id, client_slug, title, asset_kind, agreed_item, created_by)
  values (p_engagement_id, v_engagement.client_slug, btrim(p_title), p_asset_kind, nullif(btrim(p_agreed_item), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: add the next revision (a new review link) naming the revision
-- on screen. The deliverable goes to client review.
create or replace function public.add_deliverable_revision(
  p_deliverable_id uuid,
  p_expected_revision integer,
  p_review_url text,
  p_air_revision_id text default null,
  p_note text default null
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
    raise exception 'only staff can add a revision' using errcode = 'insufficient_privilege';
  end if;
  select * into v_deliverable from public.engagement_deliverables where id = p_deliverable_id for update;
  if v_deliverable.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_deliverable.current_revision <> p_expected_revision then
    raise exception 'the deliverable changed since it was shown' using errcode = '40001';
  end if;
  if v_deliverable.stage in ('final_ready', 'withdrawn') then
    raise exception 'a final or withdrawn deliverable takes no new revision' using errcode = '22023';
  end if;
  insert into public.engagement_deliverable_revisions (deliverable_id, revision, review_url, air_revision_id, note, created_by)
  values (p_deliverable_id, p_expected_revision + 1, btrim(p_review_url), nullif(btrim(p_air_revision_id), ''), nullif(btrim(p_note), ''), auth.uid());
  update public.engagement_deliverables set current_revision = p_expected_revision + 1, stage = 'client_review' where id = p_deliverable_id;
  return p_expected_revision + 1;
end;
$$;

-- Included client rounds of a deliverable (see the header).
create or replace function public.deliverable_client_round_limit(p_deliverable_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select case when jsonb_typeof(item -> 'clientRevisionRounds') = 'number'
                  and (item ->> 'clientRevisionRounds')::numeric >= 0
                  and (item ->> 'clientRevisionRounds')::numeric = trunc((item ->> 'clientRevisionRounds')::numeric)
                 then (item ->> 'clientRevisionRounds')::integer end
       from public.engagement_deliverables d
       join public.engagement_terms t on t.engagement_id = d.engagement_id
       cross join lateral jsonb_array_elements(t.agreed_deliverables) item
      where d.id = p_deliverable_id and d.agreed_item is not null and item ->> 'name' = d.agreed_item
      limit 1),
    (select case when e.engagement_type = 'custom' then 0 else 2 end
       from public.engagement_deliverables d join public.engagements e on e.id = d.engagement_id
      where d.id = p_deliverable_id));
$$;
-- Internal: called by record_deliverable_client_decision. Not callable from the browser.
revoke all on function public.deliverable_client_round_limit(uuid) from public, anon, authenticated;
grant execute on function public.deliverable_client_round_limit(uuid) to service_role;

-- Migration 20261110120001 left the milestone template check callable by signed-in
-- users. It touches no table, but a client calling it gets an answer instead of a
-- refusal, which the staging function grants check rejects. Only the checked
-- functions (as owner) and the service role need it.
revoke execute on function public.normalize_engagement_milestone_template(jsonb) from authenticated;

-- Builder or employee: record the client's decision on the current revision, with
-- the channel it came through and a note (for example a Slack link or call summary).
-- Returns 'recorded', or 'exception_pending' when a changes request is beyond the
-- included rounds (nothing is recorded; a builder decides the exception).
create or replace function public.record_deliverable_client_decision(
  p_deliverable_id uuid,
  p_revision integer,
  p_decision text,
  p_channel text,
  p_source_note text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deliverable public.engagement_deliverables;
  v_used integer;
  v_limit integer;
  v_exception text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can record a client decision' using errcode = 'insufficient_privilege';
  end if;
  select * into v_deliverable from public.engagement_deliverables where id = p_deliverable_id for update;
  if v_deliverable.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_deliverable.current_revision <> p_revision then
    raise exception 'a decision is recorded on the current revision only' using errcode = '40001';
  end if;
  if v_deliverable.stage <> 'client_review' then
    raise exception 'this revision is not waiting for a client decision' using errcode = '22023';
  end if;
  if p_decision = 'changes_requested' then
    select count(*)::int into v_used from public.engagement_deliverable_decisions
     where deliverable_id = p_deliverable_id and decision = 'changes_requested';
    -- Included rounds plus one per approved exception on this deliverable.
    v_limit := public.deliverable_client_round_limit(p_deliverable_id)
      + (select count(*)::int from public.engagement_deliverable_round_exceptions
          where deliverable_id = p_deliverable_id and status = 'approved');
    if v_used >= v_limit then
      select status into v_exception from public.engagement_deliverable_round_exceptions
       where deliverable_id = p_deliverable_id and revision = p_revision;
      if v_exception = 'denied' then
        raise exception 'the extra round for this revision was denied' using errcode = '22023';
      elsif v_exception = 'approved' then
        raise exception 'no client rounds are left on this deliverable' using errcode = '22023';
      end if;
      insert into public.engagement_deliverable_round_exceptions (deliverable_id, revision, reason, requested_by)
      values (p_deliverable_id, p_revision, 'Client asked for changes beyond the included rounds: ' || left(btrim(p_source_note), 1900), auth.uid())
      on conflict (deliverable_id, revision) do nothing;
      return 'exception_pending';
    end if;
  end if;
  insert into public.engagement_deliverable_decisions (deliverable_id, revision, decision, client_round, channel, source_note, recorded_by)
  values (p_deliverable_id, p_revision, p_decision,
          case when p_decision = 'changes_requested' then coalesce(v_used, 0) + 1 end,
          p_channel, btrim(p_source_note), auth.uid());
  update public.engagement_deliverables
     set stage = case when p_decision = 'approved' then 'client_approved' else 'changes_requested' end
   where id = p_deliverable_id;
  return 'recorded';
end;
$$;

-- Builder: approve or deny a pending round exception, once.
create or replace function public.decide_deliverable_round_exception(
  p_exception_id uuid,
  p_approve boolean,
  p_reason text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder decides an extra client round' using errcode = 'insufficient_privilege';
  end if;
  select status into v_status from public.engagement_deliverable_round_exceptions where id = p_exception_id for update;
  if v_status is null then
    raise exception 'round exception not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'this round exception is already decided' using errcode = '40001';
  end if;
  update public.engagement_deliverable_round_exceptions
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
   where id = p_exception_id;
  return case when p_approve then 'approved' else 'denied' end;
end;
$$;

-- Builder or employee: withdraw a deliverable that is not final. Its revisions and
-- decisions stay.
create or replace function public.withdraw_engagement_deliverable(p_deliverable_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_stage text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can withdraw a deliverable' using errcode = 'insufficient_privilege';
  end if;
  select stage into v_stage from public.engagement_deliverables where id = p_deliverable_id for update;
  if v_stage is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_stage in ('final_ready', 'withdrawn') then
    raise exception 'a final or withdrawn deliverable cannot be withdrawn' using errcode = '22023';
  end if;
  update public.engagement_deliverables set stage = 'withdrawn' where id = p_deliverable_id;
  return 'withdrawn';
end;
$$;

-- ------------------------------------------------------------------ checked functions: approvals

-- Builder or employee: add an idea or shot list to an engagement.
create or replace function public.create_approval_subject(
  p_engagement_id uuid,
  p_subject_kind text,
  p_title text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_client text;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can add an approval subject' using errcode = 'insufficient_privilege';
  end if;
  select client_slug into v_client from public.engagements where id = p_engagement_id for share;
  if v_client is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  insert into public.approval_subjects (engagement_id, client_slug, subject_kind, title, created_by)
  values (p_engagement_id, v_client, p_subject_kind, btrim(p_title), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: save the next version as a draft, naming the version on screen.
create or replace function public.save_approval_draft(
  p_subject_id uuid,
  p_expected_version integer,
  p_body text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current integer;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can save a draft' using errcode = 'insufficient_privilege';
  end if;
  select current_version into v_current from public.approval_subjects where id = p_subject_id for update;
  if v_current is null then
    raise exception 'approval subject not found' using errcode = 'P0002';
  end if;
  if v_current <> p_expected_version then
    raise exception 'the subject changed since it was shown' using errcode = '40001';
  end if;
  insert into public.approval_subject_versions (subject_id, version, body, created_by)
  values (p_subject_id, v_current + 1, p_body, auth.uid());
  update public.approval_subjects set current_version = v_current + 1 where id = p_subject_id;
  return v_current + 1;
end;
$$;

-- Builder or employee: publish the latest draft for the client to decide on. The
-- version published before it becomes superseded.
create or replace function public.publish_approval_version(
  p_subject_id uuid,
  p_version integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_subject public.approval_subjects;
  v_state text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can publish a version' using errcode = 'insufficient_privilege';
  end if;
  select * into v_subject from public.approval_subjects where id = p_subject_id for update;
  if v_subject.id is null then
    raise exception 'approval subject not found' using errcode = 'P0002';
  end if;
  if v_subject.current_version <> p_version then
    raise exception 'only the latest version is published' using errcode = '40001';
  end if;
  select state into v_state from public.approval_subject_versions where subject_id = p_subject_id and version = p_version;
  if v_state is distinct from 'draft' then
    raise exception 'that version is already published' using errcode = '22023';
  end if;
  update public.approval_subject_versions set state = 'superseded'
   where subject_id = p_subject_id and state = 'published';
  update public.approval_subject_versions set state = 'published', published_by = auth.uid(), published_at = now()
   where subject_id = p_subject_id and version = p_version;
  update public.approval_subjects set published_version = p_version where id = p_subject_id;
  return p_version;
end;
$$;

-- Builder or employee: record the client's decision on the published version.
create or replace function public.record_approval_decision(
  p_subject_id uuid,
  p_version integer,
  p_decision text,
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
  v_published integer;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can record a client decision' using errcode = 'insufficient_privilege';
  end if;
  select published_version into v_published from public.approval_subjects where id = p_subject_id for update;
  if not found then
    raise exception 'approval subject not found' using errcode = 'P0002';
  end if;
  if v_published is distinct from p_version then
    raise exception 'a decision is recorded on the published version only' using errcode = '40001';
  end if;
  insert into public.approval_subject_decisions (subject_id, version, decision, channel, source_note, recorded_by)
  values (p_subject_id, p_version, p_decision, p_channel, btrim(p_source_note), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_engagement_deliverable(uuid, text, text, text),
  public.add_deliverable_revision(uuid, integer, text, text, text),
  public.record_deliverable_client_decision(uuid, integer, text, text, text),
  public.decide_deliverable_round_exception(uuid, boolean, text),
  public.withdraw_engagement_deliverable(uuid),
  public.create_approval_subject(uuid, text, text),
  public.save_approval_draft(uuid, integer, text),
  public.publish_approval_version(uuid, integer),
  public.record_approval_decision(uuid, integer, text, text, text)
  from public, anon;
grant execute on function public.add_engagement_deliverable(uuid, text, text, text),
  public.add_deliverable_revision(uuid, integer, text, text, text),
  public.record_deliverable_client_decision(uuid, integer, text, text, text),
  public.decide_deliverable_round_exception(uuid, boolean, text),
  public.withdraw_engagement_deliverable(uuid),
  public.create_approval_subject(uuid, text, text),
  public.save_approval_draft(uuid, integer, text),
  public.publish_approval_version(uuid, integer),
  public.record_approval_decision(uuid, integer, text, text, text)
  to authenticated, service_role;
