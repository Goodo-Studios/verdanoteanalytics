-- Goodo OS wave B: clients and engagements (consolidation step 4b). Port of Goodo OS
-- migrations 002_engagements.sql (templates, kickoff, immutable original schedule),
-- 023_engagement_template_versions.sql (versioned, client-scoped templates) and
-- 032_engagement_closeout.sql (closeout readouts), on top of the client model from
-- migration 20261109000004 (clients.slug, engagements, engagement_notes).
--
--   engagement_templates    a named template (milestones and agreed deliverables),
--                           for all clients or one client. Every save is a new
--                           version row; rows never change.
--   engagement_terms        the template snapshot an engagement was created from,
--                           plus when its kickoff was recorded. One row per
--                           engagement. Staff only: agreed deliverables are
--                           commercial terms, so they are not on `engagements`,
--                           which clients of the same client can read.
--   engagement_milestones   the milestones of one engagement, copied from the
--                           template when it is created. Immutable.
--   engagement_closeouts    closeout readouts per engagement, versioned and
--                           append-only. Staff only; publishing to the client is
--                           not ported (client views are phase 2).
--
-- `engagements` keeps its shape and its row rules. Once a kickoff is recorded, its
-- start date and type can no longer change (Goodo OS: the original day 30 and day 45
-- dates are immutable). Writes to the four new tables go only through the checked
-- functions below (SECURITY DEFINER, each refuses non-staff in its own body).
--
-- Authority (conservative mapping of the Goodo OS engagement.write grant, see "Needs
-- the owner" in the plan): only a builder saves a template; a builder or employee
-- creates an engagement from a template, records its kickoff and writes a closeout.
--
-- Not ported: the command receipt and idempotency tables (each function checks the
-- version it was shown instead), the job enqueued on creation, closeout publication
-- and the multi-company grant model. Tests: supabase/tests/engagement_setup_test.sql.

create table public.engagement_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (template_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  version integer not null check (version >= 1),
  client_slug text references public.clients(slug) on delete restrict,
  template_type text not null check (template_type in ('standard_sprint', 'retainer', 'custom')),
  milestone_template jsonb not null check (jsonb_typeof(milestone_template) = 'array' and jsonb_array_length(milestone_template) between 1 and 40),
  agreed_deliverables jsonb not null default '[]'::jsonb check (jsonb_typeof(agreed_deliverables) = 'array' and jsonb_array_length(agreed_deliverables) <= 100),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 200),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create unique index engagement_templates_key_scope_version
  on public.engagement_templates (template_key, coalesce(client_slug, ''), version);
create index engagement_templates_client_idx on public.engagement_templates (client_slug);

create table public.engagement_terms (
  engagement_id uuid primary key,
  client_slug text not null,
  template_id uuid references public.engagement_templates(id) on delete restrict,
  milestone_template jsonb not null default '[]'::jsonb check (jsonb_typeof(milestone_template) = 'array'),
  agreed_deliverables jsonb not null default '[]'::jsonb check (jsonb_typeof(agreed_deliverables) = 'array'),
  kickoff_recorded_at timestamptz,
  kickoff_recorded_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint engagement_terms_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict,
  check ((kickoff_recorded_at is null) = (kickoff_recorded_by is null))
);

create table public.engagement_milestones (
  engagement_id uuid not null references public.engagements(id) on delete restrict,
  milestone_key text not null check (milestone_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  position integer not null check (position >= 1),
  required_evidence text[] not null check (cardinality(required_evidence) between 1 and 20),
  client_visible boolean not null,
  created_at timestamptz not null default now(),
  primary key (engagement_id, milestone_key),
  unique (engagement_id, position)
);

create table public.engagement_closeouts (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,
  client_slug text not null,
  version integer not null check (version >= 1),
  testing_started_at timestamptz,
  testing_ended_at timestamptz,
  evidence_limit text not null check (length(btrim(evidence_limit)) between 1 and 5000),
  delivered_assets text[] not null default '{}' check (cardinality(delivered_assets) <= 100),
  supported_conclusions text[] not null default '{}' check (cardinality(supported_conclusions) <= 50),
  outstanding_actions text[] not null default '{}' check (cardinality(outstanding_actions) <= 50),
  authored_by uuid not null,
  created_at timestamptz not null default now(),
  unique (engagement_id, version),
  constraint engagement_closeouts_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict,
  check (testing_ended_at is null or testing_started_at is null or testing_ended_at >= testing_started_at)
);

comment on table public.engagement_templates is 'Engagement templates (port of Goodo OS engagement_templates and versions). Staff read; builder saves through save_engagement_template. Rows never change.';
comment on table public.engagement_terms is 'Template snapshot and kickoff record of one engagement. Staff only.';
comment on table public.engagement_milestones is 'Milestones of one engagement, copied from its template. Staff only. Immutable.';
comment on table public.engagement_closeouts is 'Closeout readouts of an engagement, versioned. Staff only. Append-only.';

-- ------------------------------------------------------------------ history rules

create or replace function public.prevent_engagement_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'engagement history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_engagement_history_rewrite() from public, anon;

create trigger engagement_templates_immutable before update or delete on public.engagement_templates
  for each row execute function public.prevent_engagement_history_rewrite();
create trigger engagement_milestones_immutable before update or delete on public.engagement_milestones
  for each row execute function public.prevent_engagement_history_rewrite();
create trigger engagement_closeouts_immutable before update or delete on public.engagement_closeouts
  for each row execute function public.prevent_engagement_history_rewrite();
create trigger engagement_terms_no_delete before delete on public.engagement_terms
  for each row execute function public.prevent_engagement_history_rewrite();
create trigger engagement_templates_no_truncate before truncate on public.engagement_templates
  for each statement execute function public.prevent_engagement_history_rewrite();
create trigger engagement_milestones_no_truncate before truncate on public.engagement_milestones
  for each statement execute function public.prevent_engagement_history_rewrite();
create trigger engagement_closeouts_no_truncate before truncate on public.engagement_closeouts
  for each statement execute function public.prevent_engagement_history_rewrite();
create trigger engagement_terms_no_truncate before truncate on public.engagement_terms
  for each statement execute function public.prevent_engagement_history_rewrite();

-- engagement_terms: the snapshot never changes; the kickoff is recorded once.
create or replace function public.guard_engagement_terms_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.engagement_id is distinct from old.engagement_id or new.client_slug is distinct from old.client_slug
     or new.template_id is distinct from old.template_id or new.milestone_template is distinct from old.milestone_template
     or new.agreed_deliverables is distinct from old.agreed_deliverables or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or (old.kickoff_recorded_at is not null and (new.kickoff_recorded_at is distinct from old.kickoff_recorded_at
         or new.kickoff_recorded_by is distinct from old.kickoff_recorded_by)) then
    raise exception 'engagement terms are immutable and a kickoff is recorded once' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_engagement_terms_update() from public, anon;
create trigger engagement_terms_guard before update on public.engagement_terms
  for each row execute function public.guard_engagement_terms_update();

-- engagements: once a kickoff is recorded, the original schedule (start date and the
-- type that derives day 30 and day 45) cannot change. Runs as the caller; only staff
-- and the service role can update engagements, and both can read engagement_terms.
create or replace function public.prevent_engagement_schedule_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.start_date is distinct from old.start_date or new.engagement_type is distinct from old.engagement_type
      or new.client_slug is distinct from old.client_slug)
     and exists (select 1 from public.engagement_terms t where t.engagement_id = old.id and t.kickoff_recorded_at is not null) then
    raise exception 'the original schedule of an engagement is immutable once its kickoff is recorded' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_engagement_schedule_rewrite() from public, anon;
create trigger engagements_original_schedule_immutable before update on public.engagements
  for each row execute function public.prevent_engagement_schedule_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.engagement_templates enable row level security;
alter table public.engagement_terms enable row level security;
alter table public.engagement_milestones enable row level security;
alter table public.engagement_closeouts enable row level security;

revoke all on table public.engagement_templates, public.engagement_terms,
  public.engagement_milestones, public.engagement_closeouts from public, anon, authenticated;
grant select on table public.engagement_templates, public.engagement_terms,
  public.engagement_milestones, public.engagement_closeouts to authenticated;
grant all on table public.engagement_templates, public.engagement_terms,
  public.engagement_milestones, public.engagement_closeouts to service_role;

create policy "Builder/employee can read engagement_templates" on public.engagement_templates
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_terms" on public.engagement_terms
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_milestones" on public.engagement_milestones
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read engagement_closeouts" on public.engagement_closeouts
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ milestone template rules

-- Port of Goodo OS parseMilestoneTemplate. Each entry is a string (legacy form: the
-- key, needing a source handoff, or "delivery" with its three release gates) or an
-- object with exactly key, requiredEvidence (distinct tokens) and clientVisible.
-- Keys are distinct. A "delivery" milestone must require strategist_congruency,
-- qa_release and delivery_receipt. Returns the entries in object form; raises 22023
-- when the template is not valid.
create or replace function public.normalize_engagement_milestone_template(p_template jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_entry jsonb;
  v_key text;
  v_evidence text[];
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_token constant text := '^[a-z][a-z0-9_.-]{0,79}$';
begin
  if p_template is null or jsonb_typeof(p_template) <> 'array' or jsonb_array_length(p_template) not between 1 and 40 then
    raise exception 'a milestone template is a list of 1 to 40 milestones' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_template) loop
    if jsonb_typeof(v_entry) = 'string' then
      v_key := v_entry #>> '{}';
      v_evidence := case when v_key = 'delivery' then array['strategist_congruency', 'qa_release', 'delivery_receipt'] else array['source_handoff'] end;
      v_entry := jsonb_build_object('key', v_key, 'requiredEvidence', to_jsonb(v_evidence), 'clientVisible', true);
    elsif jsonb_typeof(v_entry) <> 'object'
       or (select count(*) from jsonb_object_keys(v_entry)) <> 3
       or not (v_entry ? 'key' and v_entry ? 'requiredEvidence' and v_entry ? 'clientVisible')
       or jsonb_typeof(v_entry -> 'key') <> 'string'
       or jsonb_typeof(v_entry -> 'requiredEvidence') <> 'array'
       or jsonb_typeof(v_entry -> 'clientVisible') <> 'boolean' then
      raise exception 'each milestone has exactly a key, its required evidence and whether the client sees it' using errcode = '22023';
    end if;
    v_key := v_entry ->> 'key';
    if v_key !~ v_token or v_key = any (v_seen) then
      raise exception 'milestone keys are short lower-case words and appear once' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_entry -> 'requiredEvidence') e where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ v_token) then
      raise exception 'required evidence entries are short lower-case words' using errcode = '22023';
    end if;
    select array_agg(e.value #>> '{}' order by e.ordinality) into v_evidence
      from jsonb_array_elements(v_entry -> 'requiredEvidence') with ordinality e;
    if v_evidence is null or cardinality(v_evidence) > 20
       or cardinality(v_evidence) <> (select count(distinct x) from unnest(v_evidence) x) then
      raise exception 'each milestone needs 1 to 20 distinct pieces of evidence' using errcode = '22023';
    end if;
    if v_key = 'delivery' and not (v_evidence @> array['strategist_congruency', 'qa_release', 'delivery_receipt']) then
      raise exception 'the delivery milestone keeps its three release gates' using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'requiredEvidence', to_jsonb(v_evidence), 'clientVisible', (v_entry ->> 'clientVisible')::boolean));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.normalize_engagement_milestone_template(jsonb) from public, anon;
grant execute on function public.normalize_engagement_milestone_template(jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------ checked functions

-- Builder: save a template. A new key starts at version 1 (p_expected_version 0); a
-- later save of the same key and client scope must name the version on screen and
-- keep the type. Existing engagements keep the snapshot they were created with.
create or replace function public.save_engagement_template(
  p_template_key text,
  p_client_slug text,
  p_expected_version integer,
  p_template_type text,
  p_milestone_template jsonb,
  p_agreed_deliverables jsonb,
  p_source_reference text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_client text := nullif(btrim(p_client_slug), '');
  v_latest integer;
  v_type text;
  v_id uuid;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can save an engagement template' using errcode = 'insufficient_privilege';
  end if;
  -- One save at a time per key and scope.
  perform pg_advisory_xact_lock(hashtext('engagement_template:' || coalesce(p_template_key, '') || ':' || coalesce(v_client, '')));
  select version, template_type into v_latest, v_type
    from public.engagement_templates
   where template_key = p_template_key and coalesce(client_slug, '') = coalesce(v_client, '')
   order by version desc limit 1;
  if coalesce(v_latest, 0) <> p_expected_version then
    raise exception 'the template changed since it was shown' using errcode = '40001';
  end if;
  if v_type is not null and v_type <> p_template_type then
    raise exception 'a new version keeps the template type' using errcode = '22023';
  end if;
  insert into public.engagement_templates (template_key, version, client_slug, template_type, milestone_template,
                                           agreed_deliverables, source_reference, created_by)
  values (p_template_key, coalesce(v_latest, 0) + 1, v_client, p_template_type,
          public.normalize_engagement_milestone_template(p_milestone_template),
          coalesce(p_agreed_deliverables, '[]'::jsonb), btrim(p_source_reference), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder or employee: create the client's next engagement cycle from a template
-- (one for all clients or one for this client). It starts planned with no dates;
-- the template's milestones and agreed deliverables are copied and never follow
-- later template versions.
create or replace function public.create_engagement_from_template(
  p_client_slug text,
  p_template_id uuid,
  p_purchase_reference text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_template public.engagement_templates;
  v_cycle integer;
  v_id uuid;
  v_milestone jsonb;
  v_position integer := 0;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can create an engagement' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.clients where slug = p_client_slug and active for update;
  if not found then
    raise exception 'client not found or not active' using errcode = 'P0002';
  end if;
  select * into v_template from public.engagement_templates where id = p_template_id;
  if v_template.id is null or (v_template.client_slug is not null and v_template.client_slug <> p_client_slug) then
    raise exception 'that template is not available for this client' using errcode = '22023';
  end if;
  select coalesce(max(cycle_number), 0) + 1 into v_cycle from public.engagements where client_slug = p_client_slug;
  insert into public.engagements (client_slug, cycle_number, engagement_type, status, created_by)
  values (p_client_slug, v_cycle, v_template.template_type, 'planned', auth.uid())
  returning id into v_id;
  insert into public.engagement_terms (engagement_id, client_slug, template_id, milestone_template, agreed_deliverables, created_by)
  values (v_id, p_client_slug, v_template.id, v_template.milestone_template, v_template.agreed_deliverables, auth.uid());
  for v_milestone in select value from jsonb_array_elements(v_template.milestone_template) loop
    v_position := v_position + 1;
    insert into public.engagement_milestones (engagement_id, milestone_key, position, required_evidence, client_visible)
    values (v_id, v_milestone ->> 'key', v_position,
            array(select jsonb_array_elements_text(v_milestone -> 'requiredEvidence')),
            (v_milestone ->> 'clientVisible')::boolean);
  end loop;
  if nullif(btrim(p_purchase_reference), '') is not null then
    insert into public.engagement_notes (engagement_id, purchase_reference, updated_by)
    values (v_id, btrim(p_purchase_reference), auth.uid());
  end if;
  return v_id;
end;
$$;

-- Builder or employee: record the actual kickoff of a planned engagement once. Sets
-- the start date (day 30 and day 45 follow for a standard sprint) and makes it active.
-- A client keeps at most one active standard sprint (unique index on engagements).
create or replace function public.record_engagement_kickoff(
  p_engagement_id uuid,
  p_start_date date
)
returns date
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_engagement public.engagements;
  v_recorded timestamptz;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can record a kickoff' using errcode = 'insufficient_privilege';
  end if;
  select * into v_engagement from public.engagements where id = p_engagement_id for update;
  if v_engagement.id is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  select kickoff_recorded_at into v_recorded from public.engagement_terms where engagement_id = p_engagement_id for update;
  if v_recorded is not null then
    raise exception 'the kickoff of this engagement is already recorded' using errcode = '40001';
  end if;
  if v_engagement.status <> 'planned' then
    raise exception 'only a planned engagement can be kicked off' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'a kickoff needs a date' using errcode = '22023';
  end if;
  update public.engagements set start_date = p_start_date, status = 'active' where id = p_engagement_id;
  insert into public.engagement_terms (engagement_id, client_slug, created_by, kickoff_recorded_at, kickoff_recorded_by)
  values (p_engagement_id, v_engagement.client_slug, auth.uid(), now(), auth.uid())
  on conflict (engagement_id) do update
    set kickoff_recorded_at = excluded.kickoff_recorded_at, kickoff_recorded_by = excluded.kickoff_recorded_by;
  return p_start_date;
end;
$$;

-- Builder or employee: save the next closeout readout of an engagement, naming the
-- version on screen (0 for the first). Earlier versions stay.
create or replace function public.save_engagement_closeout(
  p_engagement_id uuid,
  p_expected_version integer,
  p_evidence_limit text,
  p_testing_started_at timestamptz default null,
  p_testing_ended_at timestamptz default null,
  p_delivered_assets text[] default '{}',
  p_supported_conclusions text[] default '{}',
  p_outstanding_actions text[] default '{}'
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_client text;
  v_latest integer;
  v_clean constant text := '^\s*$';
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can write a closeout' using errcode = 'insufficient_privilege';
  end if;
  select client_slug into v_client from public.engagements where id = p_engagement_id for update;
  if v_client is null then
    raise exception 'engagement not found' using errcode = 'P0002';
  end if;
  select coalesce(max(version), 0) into v_latest from public.engagement_closeouts where engagement_id = p_engagement_id;
  if v_latest <> p_expected_version then
    raise exception 'the closeout changed since it was shown' using errcode = '40001';
  end if;
  if exists (select 1 from unnest(coalesce(p_delivered_assets, '{}') || coalesce(p_supported_conclusions, '{}') || coalesce(p_outstanding_actions, '{}')) x
              where x is null or x ~ v_clean or length(x) > 2000) then
    raise exception 'list entries are 1 to 2000 characters' using errcode = '22023';
  end if;
  insert into public.engagement_closeouts (engagement_id, client_slug, version, testing_started_at, testing_ended_at, evidence_limit,
                                           delivered_assets, supported_conclusions, outstanding_actions, authored_by)
  values (p_engagement_id, v_client, v_latest + 1, p_testing_started_at, p_testing_ended_at, btrim(p_evidence_limit),
          coalesce(p_delivered_assets, '{}'), coalesce(p_supported_conclusions, '{}'), coalesce(p_outstanding_actions, '{}'), auth.uid());
  return v_latest + 1;
end;
$$;

revoke all on function public.save_engagement_template(text, text, integer, text, jsonb, jsonb, text),
  public.create_engagement_from_template(text, uuid, text),
  public.record_engagement_kickoff(uuid, date),
  public.save_engagement_closeout(uuid, integer, text, timestamptz, timestamptz, text[], text[], text[])
  from public, anon;
grant execute on function public.save_engagement_template(text, text, integer, text, jsonb, jsonb, text),
  public.create_engagement_from_template(text, uuid, text),
  public.record_engagement_kickoff(uuid, date),
  public.save_engagement_closeout(uuid, integer, text, timestamptz, timestamptz, text[], text[], text[])
  to authenticated, service_role;
