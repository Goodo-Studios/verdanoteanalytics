-- Goodo OS wave B: handoffs (consolidation step 4b). Port of Goodo OS migration
-- 037_handoffs.sql and backend/services/handoffs.ts (handoff packets: an immutable
-- brief snapshot for the receiving role, acknowledged or returned by the receiver,
-- reassigned as a new revision), on the engagements of migration 20261109000004 and
-- the deliverables of migrations 20261110120002 and 20261110120003.
--
--   handoff_packets            one packet per handoff: engagement, receiving role,
--                              receiver, accountable owner, due date, status and
--                              current revision. Changed only by the functions below.
--   handoff_packet_versions    every revision of a packet: the brief, angle, goal,
--                              required inputs, a snapshot of the engagement's
--                              deliverables (title, revision, stage, links) and a
--                              sha256 fingerprint. Immutable.
--   handoff_acknowledgements   the receiver's acknowledgement or return (with a
--                              reason) of one exact revision. Immutable.
--
-- Rules ported from Goodo OS: a packet for a QA reviewer needs every deliverable in
-- internal QA, and one for the delivery owner needs every deliverable final; the
-- packet keeps the snapshot it was written against, and the page shows "stale" when
-- the deliverables have moved on since; only the receiver acknowledges or returns,
-- and a return needs a reason; a reassignment is a new revision with a fresh
-- snapshot and the same brief, and waits for the new receiver. Acknowledging a packet
-- does not complete any ClickUp task.
--
-- Differences (conservative stand-ins, see "Needs the owner" in the plan): Goodo OS
-- copied the brief, angle, goal and required inputs from the published strategy
-- proposal (wave 4c, not built yet), so here the strategist types them. Goodo OS
-- checked a per-engagement capability for each role; here any builder or employee
-- can create a packet, and the receiver and accountable owner must be builder or
-- employee logins. Reassigning is open to the accountable owner, the creator or a
-- builder. Goodo OS refused a packet with no deliverables; here only the QA reviewer
-- and delivery owner roles need deliverables, so a strategist or editor can be
-- handed a brief before the first revision exists.
--
-- Staff read every table; clients read nothing. Writes go only through the checked
-- functions (SECURITY DEFINER, each refuses non-staff in its own body).
--
-- Not ported: the bounded handoff automation of 038_bounded_handoffs.sql (rules that
-- queue a ClickUp task action and a Slack reminder when a handoff completes; both
-- are outward sends), command receipts and the multi-company grant model.
-- Tests: supabase/tests/handoffs_test.sql.

create table public.handoff_packets (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,
  client_slug text not null,
  current_revision integer not null default 1 check (current_revision >= 1),
  status text not null default 'ready' check (status in ('ready', 'acknowledged', 'returned')),
  receiving_role text not null check (receiving_role in ('strategist', 'editor', 'qa_reviewer', 'delivery_owner')),
  receiver_id uuid not null,
  accountable_owner_id uuid not null,
  due_date date not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handoff_packets_engagement_fkey foreign key (engagement_id, client_slug)
    references public.engagements(id, client_slug) on delete restrict
);
create index handoff_packets_engagement_idx on public.handoff_packets (engagement_id);
create index handoff_packets_receiver_idx on public.handoff_packets (receiver_id, status);

create table public.handoff_packet_versions (
  packet_id uuid not null references public.handoff_packets(id) on delete restrict,
  revision integer not null check (revision >= 1),
  brief text not null check (length(btrim(brief)) between 1 and 100000),
  angle text not null check (length(btrim(angle)) between 1 and 10000),
  goal text not null check (length(btrim(goal)) between 1 and 10000),
  required_inputs text[] not null check (cardinality(required_inputs) between 1 and 50),
  assets jsonb not null check (jsonb_typeof(assets) = 'array'),
  receiving_role text not null check (receiving_role in ('strategist', 'editor', 'qa_reviewer', 'delivery_owner')),
  receiver_id uuid not null,
  accountable_owner_id uuid not null,
  due_date date not null,
  action text not null check (action in ('created', 'reassigned')),
  reason text check (reason is null or length(btrim(reason)) between 1 and 4000),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (packet_id, revision),
  check ((action = 'reassigned') = (reason is not null))
);

create table public.handoff_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null,
  revision integer not null,
  action text not null check (action in ('acknowledged', 'returned')),
  reason text check (reason is null or length(btrim(reason)) between 1 and 4000),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (packet_id, revision),
  foreign key (packet_id, revision) references public.handoff_packet_versions(packet_id, revision) on delete restrict,
  check (action = 'acknowledged' or reason is not null)
);

comment on table public.handoff_packets is 'Handoff packets (port of Goodo OS handoff_packets). Staff only; written by the handoff functions.';
comment on table public.handoff_packet_versions is 'Every revision of a handoff packet with its brief and deliverable snapshot. Staff only. Immutable.';
comment on table public.handoff_acknowledgements is 'The receiver acknowledging or returning one packet revision. Staff only. Immutable.';

create trigger update_handoff_packets_updated_at before update on public.handoff_packets
  for each row execute function public.update_updated_at_column();

create or replace function public.prevent_handoff_history_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'handoff history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_handoff_history_rewrite() from public, anon;

create trigger handoff_packet_versions_immutable before update or delete on public.handoff_packet_versions
  for each row execute function public.prevent_handoff_history_rewrite();
create trigger handoff_acknowledgements_immutable before update or delete on public.handoff_acknowledgements
  for each row execute function public.prevent_handoff_history_rewrite();
create trigger handoff_packets_no_delete before delete on public.handoff_packets
  for each row execute function public.prevent_handoff_history_rewrite();
create trigger handoff_packet_versions_no_truncate before truncate on public.handoff_packet_versions
  for each statement execute function public.prevent_handoff_history_rewrite();
create trigger handoff_acknowledgements_no_truncate before truncate on public.handoff_acknowledgements
  for each statement execute function public.prevent_handoff_history_rewrite();
create trigger handoff_packets_no_truncate before truncate on public.handoff_packets
  for each statement execute function public.prevent_handoff_history_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.handoff_packets enable row level security;
alter table public.handoff_packet_versions enable row level security;
alter table public.handoff_acknowledgements enable row level security;

revoke all on table public.handoff_packets, public.handoff_packet_versions, public.handoff_acknowledgements
  from public, anon, authenticated;
grant select on table public.handoff_packets, public.handoff_packet_versions, public.handoff_acknowledgements to authenticated;
grant all on table public.handoff_packets, public.handoff_packet_versions, public.handoff_acknowledgements to service_role;

create policy "Builder/employee can read handoff_packets" on public.handoff_packets
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read handoff_packet_versions" on public.handoff_packet_versions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read handoff_acknowledgements" on public.handoff_acknowledgements
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ helpers (internal)

-- The engagement's deliverables as a packet sees them: every deliverable that has a
-- revision and is not withdrawn, ordered by id.
create or replace function public.handoff_asset_snapshot(p_engagement_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'deliverableId', d.id, 'title', d.title, 'revision', d.current_revision, 'stage', d.stage,
           'reviewUrl', r.review_url, 'finalDownloadUrl', d.final_download_url) order by d.id), '[]'::jsonb)
    from public.engagement_deliverables d
    join public.engagement_deliverable_revisions r on r.deliverable_id = d.id and r.revision = d.current_revision
   where d.engagement_id = p_engagement_id and d.stage <> 'withdrawn' and d.current_revision > 0;
$$;

-- Refuses a snapshot the receiving role cannot work from (port of the Goodo OS
-- source checks). 22023 when the source is incomplete.
create or replace function public.check_handoff_source(p_role text, p_assets jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_role in ('qa_reviewer', 'delivery_owner') and jsonb_array_length(p_assets) = 0 then
    raise exception 'a QA or delivery handoff needs deliverables with a revision' using errcode = '22023';
  end if;
  if p_role = 'qa_reviewer' and exists (select 1 from jsonb_array_elements(p_assets) a where a.value ->> 'stage' <> 'internal_qa') then
    raise exception 'every deliverable must be in internal QA for a QA reviewer handoff' using errcode = '22023';
  end if;
  if p_role = 'delivery_owner' and exists (select 1 from jsonb_array_elements(p_assets) a where a.value ->> 'stage' <> 'final_ready') then
    raise exception 'every deliverable must be final for a delivery handoff' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.handoff_fingerprint(
  p_brief text, p_angle text, p_goal text, p_inputs text[], p_assets jsonb,
  p_owner uuid, p_receiver uuid, p_role text, p_due date
)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'brief', p_brief, 'angle', p_angle, 'goal', p_goal, 'requiredInputs', to_jsonb(p_inputs), 'assets', p_assets,
    'owner', p_owner, 'receiver', p_receiver, 'role', p_role, 'due', p_due)::text, 'UTF8')), 'hex');
$$;

create or replace function public.is_staff_login(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = p_user and role in ('builder', 'employee'));
$$;

revoke all on function public.handoff_asset_snapshot(uuid), public.check_handoff_source(text, jsonb),
  public.handoff_fingerprint(text, text, text, text[], jsonb, uuid, uuid, text, date), public.is_staff_login(uuid)
  from public, anon, authenticated;
grant execute on function public.handoff_asset_snapshot(uuid), public.check_handoff_source(text, jsonb),
  public.handoff_fingerprint(text, text, text, text[], jsonb, uuid, uuid, text, date), public.is_staff_login(uuid)
  to service_role;

-- ------------------------------------------------------------------ checked functions

-- Builder or employee: the staff logins a packet can go to (receiver and owner pickers).
create or replace function public.handoff_staff_options()
returns table (user_id uuid, display_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can list handoff receivers' using errcode = 'insufficient_privilege';
  end if;
  return query
    select ur.user_id, p.display_name, coalesce(p.email, u.email::text), min(ur.role::text)
      from public.user_roles ur
      join auth.users u on u.id = ur.user_id
      left join public.profiles p on p.user_id = ur.user_id
     where ur.role in ('builder', 'employee')
     group by ur.user_id, p.display_name, p.email, u.email
     order by coalesce(p.display_name, p.email, u.email::text);
end;
$$;

-- Builder or employee: create a packet for one receiving role on an open engagement.
create or replace function public.create_handoff_packet(
  p_engagement_id uuid,
  p_receiving_role text,
  p_receiver_id uuid,
  p_accountable_owner_id uuid,
  p_due_date date,
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
                                              receiver_id, accountable_owner_id, due_date, action, fingerprint, created_by)
  values (v_id, 1, btrim(p_brief), btrim(p_angle), btrim(p_goal), v_inputs, v_assets, p_receiving_role,
          p_receiver_id, p_accountable_owner_id, p_due_date, 'created',
          public.handoff_fingerprint(btrim(p_brief), btrim(p_angle), btrim(p_goal), v_inputs, v_assets,
                                     p_accountable_owner_id, p_receiver_id, p_receiving_role, p_due_date),
          auth.uid());
  return v_id;
end;
$$;

-- The receiver: acknowledge or return (with a reason) the revision on screen.
create or replace function public.acknowledge_handoff(
  p_packet_id uuid,
  p_expected_revision integer,
  p_action text,
  p_reason text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_packet public.handoff_packets;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can acknowledge a handoff' using errcode = 'insufficient_privilege';
  end if;
  select * into v_packet from public.handoff_packets where id = p_packet_id for update;
  if v_packet.id is null then
    raise exception 'handoff not found' using errcode = 'P0002';
  end if;
  if v_packet.receiver_id <> auth.uid() then
    raise exception 'only the receiver acknowledges or returns a handoff' using errcode = 'insufficient_privilege';
  end if;
  if v_packet.current_revision <> p_expected_revision or v_packet.status <> 'ready' then
    raise exception 'the handoff changed since it was shown' using errcode = '40001';
  end if;
  if p_action not in ('acknowledged', 'returned') then
    raise exception 'acknowledge or return' using errcode = '22023';
  end if;
  insert into public.handoff_acknowledgements (packet_id, revision, action, reason, actor_id)
  values (p_packet_id, p_expected_revision, p_action, nullif(btrim(p_reason), ''), auth.uid());
  update public.handoff_packets set status = p_action where id = p_packet_id;
  return p_action;
end;
$$;

-- The accountable owner, the creator or a builder: reassign to a new receiver, role or
-- due date as the next revision, with the same brief and a fresh deliverable snapshot.
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
                                              receiver_id, accountable_owner_id, due_date, action, reason, fingerprint, created_by)
  values (p_packet_id, v_packet.current_revision + 1, v_version.brief, v_version.angle, v_version.goal, v_version.required_inputs,
          v_assets, p_receiving_role, p_receiver_id, v_packet.accountable_owner_id, p_due_date, 'reassigned', btrim(p_reason),
          public.handoff_fingerprint(v_version.brief, v_version.angle, v_version.goal, v_version.required_inputs, v_assets,
                                     v_packet.accountable_owner_id, p_receiver_id, p_receiving_role, p_due_date),
          auth.uid());
  update public.handoff_packets
     set current_revision = v_packet.current_revision + 1, receiver_id = p_receiver_id, receiving_role = p_receiving_role,
         due_date = p_due_date, status = 'ready'
   where id = p_packet_id;
  return v_packet.current_revision + 1;
end;
$$;

-- Builder or employee: whether a packet's deliverable snapshot still matches the
-- engagement ('current'), has moved on ('stale'), or no longer passes its role's
-- source checks ('blocked': the receiver should return it with a reason).
create or replace function public.handoff_source_status(p_packet_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_packet public.handoff_packets;
  v_assets jsonb;
  v_saved jsonb;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can read a handoff' using errcode = 'insufficient_privilege';
  end if;
  select * into v_packet from public.handoff_packets where id = p_packet_id;
  if v_packet.id is null then
    raise exception 'handoff not found' using errcode = 'P0002';
  end if;
  select assets into v_saved from public.handoff_packet_versions where packet_id = p_packet_id and revision = v_packet.current_revision;
  v_assets := public.handoff_asset_snapshot(v_packet.engagement_id);
  begin
    perform public.check_handoff_source(v_packet.receiving_role, v_assets);
  exception when sqlstate '22023' then
    return 'blocked';
  end;
  return case when v_assets = v_saved then 'current' else 'stale' end;
end;
$$;

revoke all on function public.handoff_staff_options(),
  public.create_handoff_packet(uuid, text, uuid, uuid, date, text, text, text, text[]),
  public.acknowledge_handoff(uuid, integer, text, text),
  public.reassign_handoff(uuid, integer, uuid, text, date, text),
  public.handoff_source_status(uuid)
  from public, anon;
grant execute on function public.handoff_staff_options(),
  public.create_handoff_packet(uuid, text, uuid, uuid, date, text, text, text, text[]),
  public.acknowledge_handoff(uuid, integer, text, text),
  public.reassign_handoff(uuid, integer, uuid, text, date, text),
  public.handoff_source_status(uuid)
  to authenticated, service_role;
