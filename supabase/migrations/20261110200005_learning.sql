-- Goodo OS wave C: learning modules and self-service measurement (consolidation step
-- 4c). Port of Goodo OS migrations 007_learning.sql, 007a_learning_integrity.sql and
-- 054_learning_self_service.sql and backend/services/learningModules.ts and
-- learningReview.ts (staff editor, review, publication and withdrawal; US-076 staff
-- tally of recurring how-to questions and the baseline against pilot snapshot).
--
--   learning_modules              one lesson per client: key, title, current draft
--                                 version, published version, active flag. Changed only
--                                 by the functions below.
--   learning_module_versions      every draft: summary, steps, checklist, source links,
--                                 applicability, source clearance, client use rights,
--                                 blocking gaps, assigned reviewer. Immutable.
--   learning_reviews              the assigned reviewer accepts a version for review, then
--                                 approves or rejects it once. Immutable.
--   learning_history              publications and withdrawals with the actor and, for a
--                                 withdrawal, the reason. Immutable.
--   learning_support_weeks        staff weekly tally of recurring how-to questions that
--                                 reached people, per engagement. One row per week.
--                                 Immutable.
--   learning_self_service_snapshots  a baseline window against a pilot window, computed
--                                 from the weekly tallies only. Immutable.
--
-- Rules ported from Goodo OS: only the assigned reviewer reviews; "accepted" comes
-- first and one final "approved" or "rejected" follows; publication needs the approved
-- version to be for clients, cleared at source, approved for client use, with no
-- blocking gaps, at least one step, checklist item, applicability (standard or custom)
-- and https source link; a draft is written against the version on screen; withdrawal
-- needs a reason; the snapshot never mixes a missing week into a rate.
--
-- Differences (conservative stand-ins, see "Needs the owner" in the plan): Goodo OS
-- checked per-client learning.review and learning.publish capability grants; here the
-- reviewer must be a builder or employee login other than the author, and only a builder
-- publishes or withdraws. The client learning library, how-to answers, helpfulness
-- responses and lesson usage clicks are client-facing (phase 2), so "published" here
-- records the decision and no client reads anything, and the snapshot reports lesson
-- usage as not measured instead of zero. Template attachments are not ported (links
-- only). No Goodo OS lesson content is copied in.
--
-- Staff read every table; clients read nothing. Writes go only through the checked
-- functions (SECURITY DEFINER, each refuses non-staff in its own body).
-- Tests: supabase/tests/learning_test.sql.

create table public.learning_modules (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete restrict,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9-]{2,63}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  current_version integer not null default 0 check (current_version >= 0),
  published_version integer check (published_version is null or published_version >= 1),
  active boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_slug, module_key),
  check (not active or published_version is not null)
);

create table public.learning_module_versions (
  module_id uuid not null references public.learning_modules(id) on delete restrict,
  version integer not null check (version >= 1),
  summary text not null check (length(btrim(summary)) between 1 and 2000),
  steps text[] not null check (cardinality(steps) <= 100),
  checklist text[] not null check (cardinality(checklist) <= 100),
  source_refs text[] not null check (cardinality(source_refs) <= 50),
  applicability text[] not null check (applicability <@ array['standard', 'custom']::text[]),
  source_clearance text not null check (source_clearance in ('pending', 'cleared', 'source_blocked')),
  client_use_rights text not null check (client_use_rights in ('internal_draft_only', 'client_approved', 'prohibited')),
  blocking_gaps text[] not null default '{}' check (cardinality(blocking_gaps) <= 50),
  assigned_reviewer uuid,
  authored_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (module_id, version)
);

create table public.learning_reviews (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.learning_modules(id) on delete restrict,
  version integer not null,
  action text not null check (action in ('accepted', 'approved', 'rejected')),
  reviewer_id uuid not null,
  note text check (note is null or length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (module_id, version, action),
  foreign key (module_id, version) references public.learning_module_versions(module_id, version) on delete restrict
);
create unique index learning_reviews_one_final on public.learning_reviews (module_id, version) where action in ('approved', 'rejected');

create table public.learning_history (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.learning_modules(id) on delete restrict,
  version integer not null,
  action text not null check (action in ('published', 'withdrawn')),
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (module_id, version) references public.learning_module_versions(module_id, version) on delete restrict,
  check ((action = 'withdrawn') = (reason is not null))
);

create table public.learning_support_weeks (
  engagement_id uuid not null,
  client_slug text not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  observation_status text not null check (observation_status in ('observed', 'missing', 'unknown')),
  recurring_how_to_questions integer not null default 0 check (recurring_how_to_questions >= 0),
  data_origin text not null check (data_origin in ('synthetic_fixture', 'pilot_observation')),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (engagement_id, week_start),
  constraint learning_support_weeks_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict,
  check (observation_status = 'observed' or recurring_how_to_questions = 0)
);

create table public.learning_self_service_snapshots (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,
  client_slug text not null,
  baseline_start date not null,
  baseline_end date not null,
  pilot_start date not null,
  pilot_end date not null,
  baseline_questions integer not null,
  baseline_weeks_observed integer not null,
  baseline_weeks_missing integer not null,
  baseline_rate numeric,
  pilot_questions integer not null,
  pilot_weeks_observed integer not null,
  pilot_weeks_missing integer not null,
  pilot_rate numeric,
  comparison text not null check (comparison in ('better', 'same', 'worse', 'missing')),
  pilot_status text not null check (pilot_status in ('complete', 'incomplete')),
  data_origin text not null check (data_origin in ('synthetic_fixture', 'pilot_observation', 'mixed', 'missing')),
  usage_note text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint learning_self_service_snapshots_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict,
  check (baseline_start <= baseline_end and baseline_end < pilot_start and pilot_start <= pilot_end)
);
create index learning_self_service_snapshots_engagement_idx on public.learning_self_service_snapshots (engagement_id, created_at desc);

comment on table public.learning_modules is 'Learning lessons per client (port of Goodo OS learning_modules). Staff only; written by the learning functions.';
comment on table public.learning_module_versions is 'Every draft of a learning lesson. Staff only. Immutable.';
comment on table public.learning_reviews is 'Assigned reviewer decisions on a lesson version. Staff only. Immutable.';
comment on table public.learning_history is 'Lesson publications and withdrawals. Staff only. Immutable.';
comment on table public.learning_support_weeks is 'Staff weekly tally of recurring how-to questions per engagement. Staff only. Immutable.';
comment on table public.learning_self_service_snapshots is 'Baseline against pilot comparison of recurring how-to questions. Staff only. Immutable.';

create trigger update_learning_modules_updated_at before update on public.learning_modules
  for each row execute function public.update_updated_at_column();

create or replace function public.prevent_learning_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'learning history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_learning_history_rewrite() from public, anon;

create trigger learning_module_versions_immutable before update or delete on public.learning_module_versions
  for each row execute function public.prevent_learning_history_rewrite();
create trigger learning_reviews_immutable before update or delete on public.learning_reviews
  for each row execute function public.prevent_learning_history_rewrite();
create trigger learning_history_immutable before update or delete on public.learning_history
  for each row execute function public.prevent_learning_history_rewrite();
create trigger learning_support_weeks_immutable before update or delete on public.learning_support_weeks
  for each row execute function public.prevent_learning_history_rewrite();
create trigger learning_self_service_snapshots_immutable before update or delete on public.learning_self_service_snapshots
  for each row execute function public.prevent_learning_history_rewrite();
create trigger learning_modules_no_delete before delete on public.learning_modules
  for each row execute function public.prevent_learning_history_rewrite();
create trigger learning_module_versions_no_truncate before truncate on public.learning_module_versions
  for each statement execute function public.prevent_learning_history_rewrite();
create trigger learning_reviews_no_truncate before truncate on public.learning_reviews
  for each statement execute function public.prevent_learning_history_rewrite();
create trigger learning_history_no_truncate before truncate on public.learning_history
  for each statement execute function public.prevent_learning_history_rewrite();
create trigger learning_support_weeks_no_truncate before truncate on public.learning_support_weeks
  for each statement execute function public.prevent_learning_history_rewrite();
create trigger learning_self_service_snapshots_no_truncate before truncate on public.learning_self_service_snapshots
  for each statement execute function public.prevent_learning_history_rewrite();
create trigger learning_modules_no_truncate before truncate on public.learning_modules
  for each statement execute function public.prevent_learning_history_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.learning_modules enable row level security;
alter table public.learning_module_versions enable row level security;
alter table public.learning_reviews enable row level security;
alter table public.learning_history enable row level security;
alter table public.learning_support_weeks enable row level security;
alter table public.learning_self_service_snapshots enable row level security;

revoke all on table public.learning_modules, public.learning_module_versions, public.learning_reviews, public.learning_history,
  public.learning_support_weeks, public.learning_self_service_snapshots
  from public, anon, authenticated;
grant select on table public.learning_modules, public.learning_module_versions, public.learning_reviews, public.learning_history,
  public.learning_support_weeks, public.learning_self_service_snapshots to authenticated;
grant all on table public.learning_modules, public.learning_module_versions, public.learning_reviews, public.learning_history,
  public.learning_support_weeks, public.learning_self_service_snapshots to service_role;

create policy "Builder/employee can read learning_modules" on public.learning_modules
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read learning_module_versions" on public.learning_module_versions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read learning_reviews" on public.learning_reviews
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read learning_history" on public.learning_history
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read learning_support_weeks" on public.learning_support_weeks
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read learning_self_service_snapshots" on public.learning_self_service_snapshots
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ helpers (internal)

-- Trims a list of lines; 22023 when an entry is empty or too long.
create or replace function public.clean_learning_lines(p_lines text[], p_max integer)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v text[];
begin
  if p_lines is null then
    return '{}';
  end if;
  select coalesce(array_agg(btrim(x)), '{}') into v from unnest(p_lines) x where nullif(btrim(x), '') is not null;
  if cardinality(v) <> cardinality(p_lines) or cardinality(v) > p_max or exists (select 1 from unnest(v) x where length(x) > 10000) then
    raise exception 'list entries cannot be empty' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function public.clean_learning_lines(text[], integer) from public, anon, authenticated;
grant execute on function public.clean_learning_lines(text[], integer) to service_role;

-- ------------------------------------------------------------------ checked functions

-- Builder or employee: a new lesson for a client (no draft yet).
create or replace function public.create_learning_module(p_client_slug text, p_module_key text, p_title text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can create a lesson' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.clients where slug = p_client_slug) then
    raise exception 'client not found' using errcode = 'P0002';
  end if;
  insert into public.learning_modules (client_slug, module_key, title, created_by)
  values (p_client_slug, btrim(p_module_key), btrim(p_title), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: the next draft, written against the version on screen.
create or replace function public.save_learning_draft(
  p_module_id uuid,
  p_expected_version integer,
  p_summary text,
  p_steps text[],
  p_checklist text[],
  p_source_refs text[],
  p_applicability text[],
  p_source_clearance text,
  p_client_use_rights text,
  p_blocking_gaps text[],
  p_assigned_reviewer uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_module public.learning_modules;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can write a lesson' using errcode = 'insufficient_privilege';
  end if;
  select * into v_module from public.learning_modules where id = p_module_id for update;
  if v_module.id is null then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;
  if v_module.current_version <> p_expected_version then
    raise exception 'the lesson changed since it was shown' using errcode = '40001';
  end if;
  if p_assigned_reviewer is not null and (p_assigned_reviewer = auth.uid()
     or not exists (select 1 from public.user_roles where user_id = p_assigned_reviewer and role in ('builder', 'employee'))) then
    raise exception 'the reviewer must be another staff member' using errcode = '22023';
  end if;
  insert into public.learning_module_versions (module_id, version, summary, steps, checklist, source_refs, applicability, source_clearance,
                                               client_use_rights, blocking_gaps, assigned_reviewer, authored_by)
  values (p_module_id, p_expected_version + 1, btrim(p_summary), public.clean_learning_lines(p_steps, 100),
          public.clean_learning_lines(p_checklist, 100), public.clean_learning_lines(p_source_refs, 50),
          coalesce(p_applicability, '{}'), p_source_clearance, p_client_use_rights, public.clean_learning_lines(p_blocking_gaps, 50),
          p_assigned_reviewer, auth.uid());
  update public.learning_modules set current_version = p_expected_version + 1 where id = p_module_id;
  return p_expected_version + 1;
end;
$$;

-- The assigned reviewer: accept the current version for review, then approve or reject it once.
create or replace function public.review_learning_version(p_module_id uuid, p_version integer, p_action text, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_module public.learning_modules;
  v_version public.learning_module_versions;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can review a lesson' using errcode = 'insufficient_privilege';
  end if;
  select * into v_module from public.learning_modules where id = p_module_id for update;
  if v_module.id is null then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;
  if v_module.current_version <> p_version then
    raise exception 'the lesson changed since it was shown' using errcode = '40001';
  end if;
  select * into v_version from public.learning_module_versions where module_id = p_module_id and version = p_version;
  if v_version.assigned_reviewer is distinct from auth.uid() then
    raise exception 'only the assigned reviewer reviews this version' using errcode = 'insufficient_privilege';
  end if;
  if p_action not in ('accepted', 'approved', 'rejected') then
    raise exception 'accepted, approved or rejected' using errcode = '22023';
  end if;
  if p_action = 'accepted' and exists (select 1 from public.learning_reviews where module_id = p_module_id and version = p_version) then
    raise exception 'this version is already under review' using errcode = '22023';
  end if;
  if p_action <> 'accepted' and not exists (select 1 from public.learning_reviews where module_id = p_module_id and version = p_version and action = 'accepted') then
    raise exception 'accept the version for review first' using errcode = '22023';
  end if;
  if p_action <> 'accepted' and exists (select 1 from public.learning_reviews where module_id = p_module_id and version = p_version and action in ('approved', 'rejected')) then
    raise exception 'this version is already decided' using errcode = '22023';
  end if;
  insert into public.learning_reviews (module_id, version, action, reviewer_id, note)
  values (p_module_id, p_version, p_action, auth.uid(), nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder: publish an approved version that passes every publication check.
create or replace function public.publish_learning_version(p_module_id uuid, p_version integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_module public.learning_modules;
  v_version public.learning_module_versions;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder publishes a lesson' using errcode = 'insufficient_privilege';
  end if;
  select * into v_module from public.learning_modules where id = p_module_id for update;
  if v_module.id is null then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;
  if v_module.current_version <> p_version then
    raise exception 'the lesson changed since it was shown' using errcode = '40001';
  end if;
  if v_module.active and v_module.published_version = p_version then
    raise exception 'this version is already published' using errcode = '22023';
  end if;
  select * into v_version from public.learning_module_versions where module_id = p_module_id and version = p_version;
  if not exists (select 1 from public.learning_reviews where module_id = p_module_id and version = p_version and action = 'approved'
                    and reviewer_id = v_version.assigned_reviewer) then
    raise exception 'the assigned reviewer has not approved this version' using errcode = '22023';
  end if;
  if v_version.source_clearance <> 'cleared' or v_version.client_use_rights <> 'client_approved' or cardinality(v_version.blocking_gaps) > 0
     or cardinality(v_version.steps) = 0 or cardinality(v_version.checklist) = 0 or cardinality(v_version.applicability) = 0
     or cardinality(v_version.source_refs) = 0 or exists (select 1 from unnest(v_version.source_refs) r where r !~ '^https://') then
    raise exception 'publication needs cleared sources, client approved rights, no blocking gaps, steps, a checklist, applicability and https source links'
      using errcode = '22023';
  end if;
  update public.learning_modules set published_version = p_version, active = true where id = p_module_id;
  insert into public.learning_history (module_id, version, action, actor_id) values (p_module_id, p_version, 'published', auth.uid());
  return p_version;
end;
$$;

-- Builder: withdraw the published lesson, with a reason.
create or replace function public.withdraw_learning_module(p_module_id uuid, p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_module public.learning_modules;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder withdraws a lesson' using errcode = 'insufficient_privilege';
  end if;
  select * into v_module from public.learning_modules where id = p_module_id for update;
  if v_module.id is null then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;
  if not v_module.active then
    raise exception 'the lesson is not published' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'a withdrawal needs a reason' using errcode = '22023';
  end if;
  update public.learning_modules set active = false where id = p_module_id;
  insert into public.learning_history (module_id, version, action, reason, actor_id)
  values (p_module_id, v_module.published_version, 'withdrawn', btrim(p_reason), auth.uid());
  return v_module.published_version;
end;
$$;

-- Builder or employee: the tally of recurring how-to questions for one week (Monday).
create or replace function public.record_learning_support_week(
  p_engagement_id uuid,
  p_week_start date,
  p_observation_status text,
  p_recurring_how_to_questions integer,
  p_data_origin text
)
returns date
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_engagement public.engagements;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can record a support week' using errcode = 'insufficient_privilege';
  end if;
  select * into v_engagement from public.engagements where id = p_engagement_id;
  if v_engagement.id is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  insert into public.learning_support_weeks (engagement_id, client_slug, week_start, observation_status, recurring_how_to_questions, data_origin, recorded_by)
  values (p_engagement_id, v_engagement.client_slug, p_week_start, p_observation_status,
          case when p_observation_status = 'observed' then p_recurring_how_to_questions else 0 end, p_data_origin, auth.uid());
  return p_week_start;
end;
$$;

-- Builder or employee: compare a baseline window with a pilot window from the weekly
-- tallies. A week without a row, or not observed, counts as missing and stays out of
-- the rate (questions per observed week). Lesson usage is not measured until the
-- client library exists.
create or replace function public.snapshot_learning_self_service(
  p_engagement_id uuid,
  p_baseline_start date,
  p_baseline_end date,
  p_pilot_start date,
  p_pilot_end date
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_engagement public.engagements;
  b_q integer; b_obs integer; b_weeks integer;
  p_q integer; p_obs integer; p_weeks integer;
  b_rate numeric; p_rate numeric;
  v_origins text[];
  v_cmp text;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can take a self-service snapshot' using errcode = 'insufficient_privilege';
  end if;
  select * into v_engagement from public.engagements where id = p_engagement_id;
  if v_engagement.id is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  if p_baseline_start > p_baseline_end or p_baseline_end >= p_pilot_start or p_pilot_start > p_pilot_end then
    raise exception 'the baseline ends before the pilot starts' using errcode = '22023';
  end if;
  -- Mondays in each window.
  select count(*) into b_weeks from generate_series(date_trunc('week', p_baseline_start::timestamp), p_baseline_end::timestamp, interval '7 days') g
   where g::date >= p_baseline_start;
  select count(*) into p_weeks from generate_series(date_trunc('week', p_pilot_start::timestamp), p_pilot_end::timestamp, interval '7 days') g
   where g::date >= p_pilot_start;
  select coalesce(sum(recurring_how_to_questions), 0), count(*) into b_q, b_obs from public.learning_support_weeks
   where engagement_id = p_engagement_id and week_start between p_baseline_start and p_baseline_end and observation_status = 'observed';
  select coalesce(sum(recurring_how_to_questions), 0), count(*) into p_q, p_obs from public.learning_support_weeks
   where engagement_id = p_engagement_id and week_start between p_pilot_start and p_pilot_end and observation_status = 'observed';
  b_rate := case when b_obs > 0 then round(b_q::numeric / b_obs, 4) end;
  p_rate := case when p_obs > 0 then round(p_q::numeric / p_obs, 4) end;
  v_cmp := case when b_rate is null or p_rate is null then 'missing' when p_rate < b_rate then 'better' when p_rate > b_rate then 'worse' else 'same' end;
  select array_agg(distinct data_origin) into v_origins from public.learning_support_weeks
   where engagement_id = p_engagement_id and observation_status = 'observed'
     and (week_start between p_baseline_start and p_baseline_end or week_start between p_pilot_start and p_pilot_end);
  insert into public.learning_self_service_snapshots (engagement_id, client_slug, baseline_start, baseline_end, pilot_start, pilot_end,
    baseline_questions, baseline_weeks_observed, baseline_weeks_missing, baseline_rate, pilot_questions, pilot_weeks_observed,
    pilot_weeks_missing, pilot_rate, comparison, pilot_status, data_origin, usage_note, created_by)
  values (p_engagement_id, v_engagement.client_slug, p_baseline_start, p_baseline_end, p_pilot_start, p_pilot_end,
    b_q, b_obs, greatest(b_weeks - b_obs, 0), b_rate, p_q, p_obs, greatest(p_weeks - p_obs, 0), p_rate, v_cmp,
    case when p_obs = p_weeks and p_weeks > 0 then 'complete' else 'incomplete' end,
    case when v_origins is null then 'missing' when cardinality(v_origins) > 1 then 'mixed' else v_origins[1] end,
    'Lesson opens, template use and completions are not measured: the client learning library is phase 2.', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_learning_module(text, text, text),
  public.save_learning_draft(uuid, integer, text, text[], text[], text[], text[], text, text, text[], uuid),
  public.review_learning_version(uuid, integer, text, text),
  public.publish_learning_version(uuid, integer),
  public.withdraw_learning_module(uuid, text),
  public.record_learning_support_week(uuid, date, text, integer, text),
  public.snapshot_learning_self_service(uuid, date, date, date, date)
  from public, anon;
grant execute on function public.create_learning_module(text, text, text),
  public.save_learning_draft(uuid, integer, text, text[], text[], text[], text[], text, text, text[], uuid),
  public.review_learning_version(uuid, integer, text, text),
  public.publish_learning_version(uuid, integer),
  public.withdraw_learning_module(uuid, text),
  public.record_learning_support_week(uuid, date, text, integer, text),
  public.snapshot_learning_self_service(uuid, date, date, date, date)
  to authenticated, service_role;
