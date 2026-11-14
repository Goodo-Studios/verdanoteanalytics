-- Public links, part 2 (P8): location boards and call sheets.
--
-- Same framework as part 1 (20261116080001_public_links.sql): the page reads through the
-- public-link function, which uses the service role and the service-only functions below. The
-- link tables stay as they are (the copy script loads them with triggers off and checksums whole
-- rows), and a registry row with the SHA-256 of each token is kept by an ENABLE ALWAYS trigger.
--
-- What the old public pages did, and what these keep
--   Location board  view only: for each shared location the name, neighborhood, rental type,
--                   rooms, attributes and photos. No cost, listing link, host contact or notes.
--                   The old page had no "pick" action, so none is added.
--   Call sheet      read only: call and wrap times, notes, the shoot date and place, the brand
--                   name, the confirmed talent (name, phone, email), the location (name,
--                   neighborhood, parking, wifi, entry instructions, host contact), the schedule
--                   and the crew (name, role, phone, email). The old page had no confirm or
--                   acknowledge action, so none is added. Talent lines (call_sheet_talent_entries:
--                   wardrobe, rate note, internal note) were never public and are still not.
--                   Phone numbers and emails appear because the old call sheet showed them to the
--                   crew and talent holding the link; nothing else was added.
--
-- Expiry
--   Revoked stays on the link row. public_link_registry.expires_at (null for no expiry) is
--   honored for every link type, and staff may set it (column grant below). A call sheet link
--   also stops working 30 days after the shoot date. Copied old links have no expiry, so they keep
--   working until revoked, and a call sheet keeps working until that 30 day mark.

-- ---------------------------------------------------------------- registry triggers
create trigger location_boards_registry
  after insert or update of token or delete on public.location_boards
  for each row execute function public.public_link_registry_sync('location_board');
alter table public.location_boards enable always trigger location_boards_registry;

create trigger call_sheets_registry
  after insert or update of token or delete on public.call_sheets
  for each row execute function public.public_link_registry_sync('call_sheet');
alter table public.call_sheets enable always trigger call_sheets_registry;

insert into public.public_link_registry (link_type, link_id, token_hash)
select 'location_board', id, public.public_link_hash(token) from public.location_boards
on conflict (link_type, link_id) do nothing;
insert into public.public_link_registry (link_type, link_id, token_hash)
select 'call_sheet', id, public.public_link_hash(token) from public.call_sheets
on conflict (link_type, link_id) do nothing;

create or replace function public.public_link_backfill_registry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval integer;
  v_location integer;
  v_sheet integer;
begin
  with ins as (
    insert into public.public_link_registry (link_type, link_id, token_hash)
    select 'approval_board', id, public.public_link_hash(token) from public.approval_boards
    on conflict (link_type, link_id) do nothing returning 1
  ) select count(*) into v_approval from ins;
  with ins as (
    insert into public.public_link_registry (link_type, link_id, token_hash)
    select 'location_board', id, public.public_link_hash(token) from public.location_boards
    on conflict (link_type, link_id) do nothing returning 1
  ) select count(*) into v_location from ins;
  with ins as (
    insert into public.public_link_registry (link_type, link_id, token_hash)
    select 'call_sheet', id, public.public_link_hash(token) from public.call_sheets
    on conflict (link_type, link_id) do nothing returning 1
  ) select count(*) into v_sheet from ins;
  return jsonb_build_object('approval_board', v_approval, 'location_board', v_location, 'call_sheet', v_sheet);
end;
$$;
revoke all on function public.public_link_backfill_registry() from public, anon, authenticated;
grant execute on function public.public_link_backfill_registry() to service_role;

-- Staff can set or clear a link's expiry, and nothing else on the registry.
grant update (expires_at) on table public.public_link_registry to authenticated;
create policy "Staff set public_link_registry expiry" on public.public_link_registry
  for update to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ---------------------------------------------------------------- location board
create or replace function public.public_location_board_get(p_token_hash text, p_count_open boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.location_boards%rowtype;
  r public.public_link_registry%rowtype;
  v_client_name text;
begin
  if p_token_hash is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into r from public.public_link_registry where link_type = 'location_board' and token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into b from public.location_boards where id = r.link_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if b.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if r.expires_at is not null and now() > r.expires_at then
    return jsonb_build_object('status', 'expired');
  end if;
  if p_count_open then
    update public.public_link_registry set open_count = open_count + 1, last_opened_at = now()
     where link_type = 'location_board' and link_id = b.id;
  end if;
  select name into v_client_name from public.clients where slug = b.client_slug;
  return jsonb_build_object(
    'status', 'ok',
    'label', b.label,
    'client_name', coalesce(v_client_name, ''),
    'expires_at', r.expires_at,
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'location_id', l.id,
        'name', l.name,
        'neighborhood', l.neighborhood,
        'rental_type', l.rental_type,
        'rooms', l.rooms,
        'attributes', l.attributes,
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object('id', lp.id, 'caption', lp.caption, 'path', lp.storage_path)
                           order by lp.sort_order, lp.created_at, lp.id)
          from public.location_photos lp where lp.location_id = l.id
        ), '[]'::jsonb)
      ) order by l.name, l.id)
      from public.location_board_items lbi
      join public.locations l on l.id = lbi.location_id
      where lbi.board_id = b.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.public_location_board_get(text, boolean) from public, anon, authenticated;
grant execute on function public.public_location_board_get(text, boolean) to service_role;

-- ---------------------------------------------------------------- call sheet
create or replace function public.public_call_sheet_get(p_token_hash text, p_count_open boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cs public.call_sheets%rowtype;
  r public.public_link_registry%rowtype;
  s public.shoots%rowtype;
  v_client_name text;
begin
  if p_token_hash is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into r from public.public_link_registry where link_type = 'call_sheet' and token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into cs from public.call_sheets where id = r.link_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into s from public.shoots where id = cs.shoot_id;
  if cs.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if (r.expires_at is not null and now() > r.expires_at) or s.shoot_date + 30 < current_date then
    return jsonb_build_object('status', 'expired');
  end if;
  if p_count_open then
    update public.public_link_registry set open_count = open_count + 1, last_opened_at = now()
     where link_type = 'call_sheet' and link_id = cs.id;
  end if;
  select name into v_client_name from public.clients where slug = s.client_slug;

  return jsonb_build_object(
    'status', 'ok',
    'call_time', cs.call_time,
    'wrap_time_estimate', cs.wrap_time_estimate,
    'general_notes', cs.general_notes,
    'shoot_date', s.shoot_date,
    'shoot_location', s.location,
    'client_name', coalesce(v_client_name, ''),
    'talent', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'phone', a.phone, 'email', a.email) order by a.name, a.id)
      from public.actor_assignments aa join public.actors a on a.id = aa.actor_id
      where aa.shoot_id = s.id
    ), '[]'::jsonb),
    'location', (
      select jsonb_build_object(
        'name', l.name, 'neighborhood', l.neighborhood, 'parking_instructions', l.parking_instructions,
        'wifi_name', l.wifi_name, 'wifi_password', l.wifi_password, 'entry_instructions', l.entry_instructions,
        'contact_name', l.contact_name, 'contact_email', l.contact_email)
      from public.locations l where l.id = s.location_id
    ),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'label', b.label, 'start_time', b.start_time, 'end_time', b.end_time,
        'location', b.location, 'notes', b.notes,
        'talent', coalesce((
          select jsonb_agg(jsonb_build_object('name', ba.name) order by ba.name)
          from public.shoot_schedule_block_talent bt
          join public.actor_assignments baa on baa.id = bt.actor_assignment_id
          join public.actors ba on ba.id = baa.actor_id
          where bt.block_id = b.id
        ), '[]'::jsonb),
        'crew', coalesce((
          select jsonb_agg(jsonb_build_object('id', bcm.id, 'name', bcm.name) order by bcm.name)
          from public.shoot_schedule_block_crew bc
          join public.crew_members bcm on bcm.id = bc.crew_member_id
          where bc.block_id = b.id
            and exists (select 1 from public.call_sheet_crew x where x.call_sheet_id = cs.id and x.crew_member_id = bc.crew_member_id)
        ), '[]'::jsonb)
      ) order by b.start_time, b.label, b.id)
      from public.shoot_schedule_blocks b where b.shoot_id = s.id
    ), '[]'::jsonb),
    'crew', coalesce((
      select jsonb_agg(jsonb_build_object('id', cm.id, 'name', cm.name, 'role', cm.role, 'phone', cm.phone, 'email', cm.email) order by cm.name, cm.id)
      from public.call_sheet_crew csc join public.crew_members cm on cm.id = csc.crew_member_id
      where csc.call_sheet_id = cs.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.public_call_sheet_get(text, boolean) from public, anon, authenticated;
grant execute on function public.public_call_sheet_get(text, boolean) to service_role;
