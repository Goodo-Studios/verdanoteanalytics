-- Step 5c: one call sheet, merged with Goodo OS.
--
-- The old dashboard's call sheet is per shoot (call_sheets, migration
-- 20261101000001): call time, wrap estimate, general notes, crew, and the
-- shoot's schedule blocks, opened by crew and clients through a secret link.
-- Goodo OS had a second call sheet per engagement with a line per talent:
-- call time, wardrobe, notes for the talent, and staff-only rate and internal
-- notes. Instead of a second call sheet, the per-talent lines are added to the
-- dashboard's call sheet here, one line per talent confirmed onto its shoot.
--
-- Staff only. Clients and the public link read nothing from this table: the
-- public call sheet page stays on the old dashboard and reads the old
-- database until the release, and rate and internal notes must never reach a
-- client login. Signed-in users hold only a read grant (staff rows through
-- the policy); every write goes through the two checked functions below,
-- which test the role in their body.
--
-- Not ported from Goodo OS: immutable published versions with command
-- receipts and the talent portal view (the talent portal is dropped).

create table public.call_sheet_talent_entries (
  call_sheet_id uuid not null references public.call_sheets(id) on delete cascade,
  actor_assignment_id uuid not null references public.actor_assignments(id) on delete cascade,
  call_time time without time zone,
  wardrobe text check (wardrobe is null or char_length(wardrobe) <= 500),
  talent_notes text check (talent_notes is null or char_length(talent_notes) <= 1000),
  rate_note text check (rate_note is null or char_length(rate_note) <= 500),
  internal_note text check (internal_note is null or char_length(internal_note) <= 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (call_sheet_id, actor_assignment_id)
);

create index call_sheet_talent_entries_assignment_idx on public.call_sheet_talent_entries (actor_assignment_id);

comment on table public.call_sheet_talent_entries is
  'Per-talent lines of a call sheet (Goodo OS call sheet entries merged into the dashboard call sheet). Staff only; rate_note and internal_note are never for clients or talent.';

alter table public.call_sheet_talent_entries enable row level security;
revoke all on table public.call_sheet_talent_entries from public, anon, authenticated;
grant select on table public.call_sheet_talent_entries to authenticated;
grant all on table public.call_sheet_talent_entries to service_role;

create policy "Staff read call_sheet_talent_entries" on public.call_sheet_talent_entries
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ writes

create or replace function public.save_call_sheet_talent_entry(
  p_call_sheet_id uuid,
  p_actor_assignment_id uuid,
  p_call_time time without time zone default null,
  p_wardrobe text default null,
  p_talent_notes text default null,
  p_rate_note text default null,
  p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet call_sheets%rowtype;
  v_row call_sheet_talent_entries%rowtype;
  v_wardrobe text := nullif(btrim(coalesce(p_wardrobe, '')), '');
  v_talent_notes text := nullif(btrim(coalesce(p_talent_notes, '')), '');
  v_rate_note text := nullif(btrim(coalesce(p_rate_note, '')), '');
  v_internal_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only staff can change a call sheet.' using errcode = '42501';
  end if;

  select * into v_sheet from call_sheets where id = p_call_sheet_id for update;
  if not found then
    raise exception 'Call sheet not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from actor_assignments
    where id = p_actor_assignment_id and shoot_id = v_sheet.shoot_id
  ) then
    raise exception 'Only talent confirmed onto this shoot can be on its call sheet.' using errcode = '22023';
  end if;

  if char_length(v_wardrobe) > 500 or char_length(v_rate_note) > 500 then
    raise exception 'Wardrobe and rate note must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if char_length(v_talent_notes) > 1000 or char_length(v_internal_note) > 1000 then
    raise exception 'Notes must be 1000 characters or fewer.' using errcode = '22023';
  end if;

  insert into call_sheet_talent_entries (
    call_sheet_id, actor_assignment_id, call_time, wardrobe, talent_notes, rate_note, internal_note, updated_by, updated_at
  )
  values (
    p_call_sheet_id, p_actor_assignment_id, p_call_time, v_wardrobe, v_talent_notes, v_rate_note, v_internal_note, auth.uid(), now()
  )
  on conflict (call_sheet_id, actor_assignment_id) do update
    set call_time = excluded.call_time,
        wardrobe = excluded.wardrobe,
        talent_notes = excluded.talent_notes,
        rate_note = excluded.rate_note,
        internal_note = excluded.internal_note,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
  returning * into v_row;

  update call_sheets set updated_at = now() where id = p_call_sheet_id;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.remove_call_sheet_talent_entry(p_call_sheet_id uuid, p_actor_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only staff can change a call sheet.' using errcode = '42501';
  end if;

  delete from call_sheet_talent_entries
  where call_sheet_id = p_call_sheet_id and actor_assignment_id = p_actor_assignment_id;
  if not found then
    raise exception 'That talent line is not on the call sheet.' using errcode = 'P0002';
  end if;

  update call_sheets set updated_at = now() where id = p_call_sheet_id;

  return jsonb_build_object('call_sheet_id', p_call_sheet_id, 'actor_assignment_id', p_actor_assignment_id);
end;
$$;

revoke all on function public.save_call_sheet_talent_entry(uuid, uuid, time without time zone, text, text, text, text) from public, anon;
revoke all on function public.remove_call_sheet_talent_entry(uuid, uuid) from public, anon;
grant execute on function public.save_call_sheet_talent_entry(uuid, uuid, time without time zone, text, text, text, text) to authenticated, service_role;
grant execute on function public.remove_call_sheet_talent_entry(uuid, uuid) to authenticated, service_role;
