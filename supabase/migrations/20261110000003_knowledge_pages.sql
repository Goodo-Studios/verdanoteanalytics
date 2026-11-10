-- Goodo OS wave A: knowledge pages (consolidation step 4a). Port of Goodo OS
-- migrations 009_knowledge.sql, 042_knowledge_corrections.sql and
-- 043_knowledge_publications.sql (US-047, US-055, US-056), in Verdanote's shape.
--
--   knowledge_sources              one row per knowledge document: title, where it
--                                  applies (global or one client), classification
--                                  and the current version number.
--   knowledge_source_versions      every published version, append-only. A
--                                  publish or a rollback adds a version; nothing
--                                  is overwritten.
--   knowledge_corrections          a staff member's proposed change, locked to the
--                                  source version and body fingerprint it was
--                                  written against. Immutable.
--   knowledge_correction_reviews   one decision per correction (accepted,
--                                  rejected, conflict), append-only.
--
-- Writes go only through the checked functions below (SECURITY DEFINER, each
-- refuses non-staff in its own body). Staff read every table; clients read
-- nothing, including knowledge classed "client" (client views are phase 2).
--
-- Authority (conservative mapping of the Goodo OS capabilities, see "Needs the
-- owner" in the plan): any builder or employee can propose a correction. Content
-- and factual corrections can be reviewed by a builder or employee other than the
-- author; procedure and permission corrections by a builder only. Only a builder
-- adds a source, publishes an accepted correction or rolls a source back.
-- Procedure and permission corrections stay review decisions and are never
-- published, as in Goodo OS.
--
-- Not ported: the Goodo OS source provider (it was never wired in production;
-- sources are added on the page), the provider publication adapter and
-- reconciliation, knowledge maintenance tasks and the multi-company grant model.
-- Tests: supabase/tests/knowledge_pages_test.sql.

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  namespace text not null default 'general' check (namespace ~ '^[a-z][a-z0-9_-]{0,39}$'),
  classification text not null check (classification in ('client', 'staff')),
  release_scope text not null check (release_scope in ('global', 'client')),
  client_slug text references public.clients(slug) on delete restrict,
  citation_url text check (citation_url is null or (citation_url ~ '^https://\S+$' and length(citation_url) <= 508)),
  current_version integer not null default 1 check (current_version >= 1),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((release_scope = 'client') = (client_slug is not null))
);
create index knowledge_sources_client_idx on public.knowledge_sources (client_slug);

create table public.knowledge_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources(id) on delete restrict,
  version integer not null check (version >= 1),
  body text not null check (length(btrim(body)) between 1 and 20000),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('create', 'publish', 'rollback')),
  correction_id uuid,
  rolled_back_to integer,
  reason text check (reason is null or length(reason) between 1 and 2000),
  published_by uuid not null,
  created_at timestamptz not null default now(),
  unique (source_id, version),
  check ((kind = 'publish') = (correction_id is not null)),
  check ((kind = 'rollback') = (rolled_back_to is not null))
);

create table public.knowledge_corrections (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources(id) on delete restrict,
  source_version integer not null check (source_version >= 1),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  proposed_body text not null check (length(btrim(proposed_body)) between 1 and 20000),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  classification text not null check (classification in ('content', 'procedure', 'permission', 'factual')),
  submitted_by uuid not null,
  created_at timestamptz not null default now()
);
create index knowledge_corrections_source_idx on public.knowledge_corrections (source_id, created_at desc);

alter table public.knowledge_source_versions
  add constraint knowledge_source_versions_correction_fkey foreign key (correction_id)
  references public.knowledge_corrections(id) on delete restrict;
create unique index knowledge_source_versions_one_publish_per_correction
  on public.knowledge_source_versions (correction_id) where correction_id is not null;

create table public.knowledge_correction_reviews (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null unique references public.knowledge_corrections(id) on delete restrict,
  decision text not null check (decision in ('accepted', 'rejected', 'conflict')),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  reviewed_version integer not null check (reviewed_version >= 1),
  reviewer_id uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.knowledge_sources is 'Knowledge documents (port of Goodo OS knowledge_sources). Staff read; written by the knowledge functions only.';
comment on table public.knowledge_source_versions is 'Every published version of a knowledge source. Append-only.';
comment on table public.knowledge_corrections is 'Proposed knowledge corrections, locked to a source version. Immutable.';
comment on table public.knowledge_correction_reviews is 'One decision per knowledge correction. Append-only.';

create trigger update_knowledge_sources_updated_at before update on public.knowledge_sources
  for each row execute function public.update_updated_at_column();

create or replace function public.prevent_knowledge_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'knowledge history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_knowledge_history_rewrite() from public, anon;

create trigger knowledge_source_versions_immutable before update or delete on public.knowledge_source_versions
  for each row execute function public.prevent_knowledge_history_rewrite();
create trigger knowledge_corrections_immutable before update or delete on public.knowledge_corrections
  for each row execute function public.prevent_knowledge_history_rewrite();
create trigger knowledge_correction_reviews_immutable before update or delete on public.knowledge_correction_reviews
  for each row execute function public.prevent_knowledge_history_rewrite();
create trigger knowledge_sources_no_delete before delete on public.knowledge_sources
  for each row execute function public.prevent_knowledge_history_rewrite();
create trigger knowledge_source_versions_no_truncate before truncate on public.knowledge_source_versions
  for each statement execute function public.prevent_knowledge_history_rewrite();
create trigger knowledge_corrections_no_truncate before truncate on public.knowledge_corrections
  for each statement execute function public.prevent_knowledge_history_rewrite();
create trigger knowledge_correction_reviews_no_truncate before truncate on public.knowledge_correction_reviews
  for each statement execute function public.prevent_knowledge_history_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_source_versions enable row level security;
alter table public.knowledge_corrections enable row level security;
alter table public.knowledge_correction_reviews enable row level security;

revoke all on table public.knowledge_sources, public.knowledge_source_versions,
  public.knowledge_corrections, public.knowledge_correction_reviews from public, anon, authenticated;
grant select on table public.knowledge_sources, public.knowledge_source_versions,
  public.knowledge_corrections, public.knowledge_correction_reviews to authenticated;
grant all on table public.knowledge_sources, public.knowledge_source_versions,
  public.knowledge_corrections, public.knowledge_correction_reviews to service_role;

create policy "Builder/employee can read knowledge_sources" on public.knowledge_sources
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read knowledge_source_versions" on public.knowledge_source_versions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read knowledge_corrections" on public.knowledge_corrections
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read knowledge_correction_reviews" on public.knowledge_correction_reviews
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ checked functions

create or replace function public.knowledge_body_fingerprint(p_body text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
$$;

-- Builder: add a source with its first version.
create or replace function public.create_knowledge_source(
  p_title text,
  p_body text,
  p_classification text,
  p_release_scope text,
  p_client_slug text default null,
  p_namespace text default 'general',
  p_citation_url text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can add knowledge' using errcode = 'insufficient_privilege';
  end if;
  insert into public.knowledge_sources (title, namespace, classification, release_scope, client_slug, citation_url, created_by)
  values (btrim(p_title), coalesce(nullif(btrim(p_namespace), ''), 'general'), p_classification, p_release_scope,
          nullif(btrim(p_client_slug), ''), nullif(btrim(p_citation_url), ''), auth.uid())
  returning id into v_id;
  insert into public.knowledge_source_versions (source_id, version, body, fingerprint, kind, published_by)
  values (v_id, 1, p_body, public.knowledge_body_fingerprint(p_body), 'create', auth.uid());
  return v_id;
end;
$$;

-- Builder or employee: propose a correction against the version shown on screen.
create or replace function public.submit_knowledge_correction(
  p_source_id uuid,
  p_source_version integer,
  p_proposed_body text,
  p_reason text,
  p_classification text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_fingerprint text;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can propose a knowledge correction' using errcode = 'insufficient_privilege';
  end if;
  select current_version into v_current from public.knowledge_sources where id = p_source_id for update;
  if v_current is null then
    raise exception 'knowledge source not found' using errcode = 'P0002';
  end if;
  if v_current <> p_source_version then
    raise exception 'the source changed since it was shown' using errcode = '40001';
  end if;
  select fingerprint into v_fingerprint from public.knowledge_source_versions where source_id = p_source_id and version = v_current;
  if v_fingerprint = public.knowledge_body_fingerprint(p_proposed_body) then
    raise exception 'the proposed text is the same as the current text' using errcode = '22023';
  end if;
  insert into public.knowledge_corrections (source_id, source_version, source_fingerprint, proposed_body, reason, classification, submitted_by)
  values (p_source_id, v_current, v_fingerprint, p_proposed_body, p_reason, p_classification, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Review one correction. Not by its author. Procedure and permission corrections
-- need a builder. Accepting needs the source to still be at the corrected version.
create or replace function public.review_knowledge_correction(
  p_correction_id uuid,
  p_decision text,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_correction public.knowledge_corrections;
  v_current integer;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can review a knowledge correction' using errcode = 'insufficient_privilege';
  end if;
  select * into v_correction from public.knowledge_corrections where id = p_correction_id;
  if v_correction.id is null then
    raise exception 'knowledge correction not found' using errcode = 'P0002';
  end if;
  if v_correction.submitted_by = auth.uid() then
    raise exception 'a correction is reviewed by someone other than its author' using errcode = 'insufficient_privilege';
  end if;
  if v_correction.classification in ('procedure', 'permission') and not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'procedure and permission corrections are reviewed by a builder' using errcode = 'insufficient_privilege';
  end if;
  select current_version into v_current from public.knowledge_sources where id = v_correction.source_id for update;
  if p_decision = 'accepted' and v_current <> v_correction.source_version then
    raise exception 'the source changed after this correction was written' using errcode = '40001';
  end if;
  insert into public.knowledge_correction_reviews (correction_id, decision, reason, reviewed_version, reviewer_id)
  values (p_correction_id, p_decision, p_reason, v_current, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Builder: publish an accepted content or factual correction as the next version.
create or replace function public.publish_knowledge_correction(p_correction_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_correction public.knowledge_corrections;
  v_decision text;
  v_current integer;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can publish knowledge' using errcode = 'insufficient_privilege';
  end if;
  select * into v_correction from public.knowledge_corrections where id = p_correction_id;
  if v_correction.id is null then
    raise exception 'knowledge correction not found' using errcode = 'P0002';
  end if;
  if v_correction.classification not in ('content', 'factual') then
    raise exception 'procedure and permission corrections are decisions only and are not published' using errcode = '22023';
  end if;
  select decision into v_decision from public.knowledge_correction_reviews where correction_id = p_correction_id;
  if v_decision is distinct from 'accepted' then
    raise exception 'only an accepted correction is published' using errcode = '22023';
  end if;
  select current_version into v_current from public.knowledge_sources where id = v_correction.source_id for update;
  if v_current <> v_correction.source_version then
    raise exception 'the source changed after this correction was written' using errcode = '40001';
  end if;
  insert into public.knowledge_source_versions (source_id, version, body, fingerprint, kind, correction_id, published_by)
  values (v_correction.source_id, v_current + 1, v_correction.proposed_body,
          public.knowledge_body_fingerprint(v_correction.proposed_body), 'publish', p_correction_id, auth.uid());
  update public.knowledge_sources set current_version = v_current + 1 where id = v_correction.source_id;
  return v_current + 1;
end;
$$;

-- Builder: publish an earlier version's text again as the next version.
create or replace function public.rollback_knowledge_source(
  p_source_id uuid,
  p_to_version integer,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_body text;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can roll knowledge back' using errcode = 'insufficient_privilege';
  end if;
  select current_version into v_current from public.knowledge_sources where id = p_source_id for update;
  if v_current is null then
    raise exception 'knowledge source not found' using errcode = 'P0002';
  end if;
  if v_current <> p_expected_version then
    raise exception 'the source changed since it was shown' using errcode = '40001';
  end if;
  if p_to_version >= v_current then
    raise exception 'roll back to an earlier version' using errcode = '22023';
  end if;
  select body into v_body from public.knowledge_source_versions where source_id = p_source_id and version = p_to_version;
  if v_body is null then
    raise exception 'that version does not exist' using errcode = 'P0002';
  end if;
  insert into public.knowledge_source_versions (source_id, version, body, fingerprint, kind, rolled_back_to, reason, published_by)
  values (p_source_id, v_current + 1, v_body, public.knowledge_body_fingerprint(v_body), 'rollback', p_to_version, p_reason, auth.uid());
  update public.knowledge_sources set current_version = v_current + 1 where id = p_source_id;
  return v_current + 1;
end;
$$;

revoke all on function public.create_knowledge_source(text, text, text, text, text, text, text),
  public.submit_knowledge_correction(uuid, integer, text, text, text),
  public.review_knowledge_correction(uuid, text, text),
  public.publish_knowledge_correction(uuid),
  public.rollback_knowledge_source(uuid, integer, integer, text)
  from public, anon;
grant execute on function public.create_knowledge_source(text, text, text, text, text, text, text),
  public.submit_knowledge_correction(uuid, integer, text, text, text),
  public.review_knowledge_correction(uuid, text, text),
  public.publish_knowledge_correction(uuid),
  public.rollback_knowledge_source(uuid, integer, integer, text)
  to authenticated, service_role;
revoke all on function public.knowledge_body_fingerprint(text) from public, anon, authenticated;
grant execute on function public.knowledge_body_fingerprint(text) to service_role;
