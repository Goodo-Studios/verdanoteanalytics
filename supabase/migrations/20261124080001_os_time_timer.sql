-- Goodo OS story OS-012: a timer on tasks and in the top bar, and the weekly log.
--
-- time_entries gains what the time was for:
--   task_id      the Goodo OS task (os_tasks). Kept as null if the task is deleted.
--   client_slug  the client (clients.slug). Copied from the task when a task is given.
--   is_internal  time for Goodo itself, with no client.
--   category     one of a short fixed list (a check, not a lookup table, because the list is
--                small and changes only with a migration): Editing, Strategy, Production, Admin,
--                Meetings, Other.
--
-- Rule for rows made in the app (source_id is null): either a task is set, or a client or
-- Internal is set together with a category. Rows copied from Goodo Time (source_id set) are
-- exempt, as they carry a Goodo Time project instead.
--
-- Functions, for signed-in staff (builder or employee) only; clients and logins with no role
-- are refused:
--   time_my_person()    finds or creates the caller's time_people row by their login email
--                       (lower case) and links user_id. Returns its id. The weekly log calls it
--                       before a manual entry, so a member with no row yet gets one.
--   time_start_timer()  stops the caller's running entry at now() and starts a new one. With a
--                       task, the task's client is copied and a read-only task is refused.
--   time_stop_timer()   stops the caller's running entry. Returns it, or null if none ran.
--
-- Stopping and starting share one moment: the old entry ends exactly when the new one starts,
-- which the half-open no-overlap rule allows. A running entry that started at that same moment
-- (two starts in one transaction) has no length, so it is removed instead of stopped.
--
-- Manual entries: the OS-011 row rules already let an employee add, edit and delete entries
-- whose person row has user_id = auth.uid(), and a builder manage all. Nothing changes there.

-- ------------------------------------------------------------------ columns

alter table public.time_entries
  add column task_id uuid references public.os_tasks(id) on delete set null,
  add column client_slug text references public.clients(slug) on update cascade,
  add column is_internal boolean not null default false,
  add column category text;

alter table public.time_entries
  add constraint time_entries_category_known
    check (category is null or category in ('Editing', 'Strategy', 'Production', 'Admin', 'Meetings', 'Other')),
  add constraint time_entries_client_or_internal
    check (not (is_internal and client_slug is not null));

-- Added without checking old rows first, then checked: if the target already holds app-made
-- rows from before this rule (there was no screen to make them, so none are expected), the
-- migration still applies and leaves the rule unchecked for those rows only.
alter table public.time_entries
  add constraint time_entries_needs_purpose
    check (source_id is not null
           or task_id is not null
           or ((client_slug is not null or is_internal) and category is not null))
    not valid;

do $$
begin
  alter table public.time_entries validate constraint time_entries_needs_purpose;
exception when check_violation then
  raise notice 'time_entries_needs_purpose left unvalidated: older app-made rows have no task, client or category';
end;
$$;

create index time_entries_task_idx on public.time_entries (task_id) where task_id is not null;

-- A task's client is copied onto the entry when the entry names a task and no client.
create or replace function public.time_entries_fill_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_id is not null and new.client_slug is null then
    select t.client_slug into new.client_slug from public.os_tasks t where t.id = new.task_id;
    new.is_internal := false;
  end if;
  return new;
end;
$$;

revoke all on function public.time_entries_fill_client() from public, anon, authenticated;

-- Named to sort before time_entries_guard, so the guard sees the filled row.
create trigger time_entries_fill_client before insert or update on public.time_entries
  for each row execute function public.time_entries_fill_client();

-- ------------------------------------------------------------------ my person row

create or replace function public.time_my_person()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_email text;
  v_name text;
begin
  if v_uid is null
     or not (public.has_role(auth.uid(), 'builder'::public.app_role)
             or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only staff can track time.' using errcode = '42501';
  end if;

  select id into v_id from public.time_people where user_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  select lower(btrim(u.email)),
         coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                  nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
                  split_part(lower(btrim(u.email)), '@', 1))
    into v_email, v_name
    from auth.users u
   where u.id = v_uid;
  if v_email is null or v_email not like '%@%' then
    raise exception 'Your login has no email, so time cannot be tracked for it.' using errcode = '22023';
  end if;

  -- A row copied from Goodo Time with this email and no login yet: link it.
  update public.time_people set user_id = v_uid
   where email = v_email and user_id is null
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  if exists (select 1 from public.time_people where email = v_email) then
    raise exception 'Your email is already linked to another login in time tracking. Ask an admin to fix it.'
      using errcode = '42501';
  end if;

  insert into public.time_people (email, name, user_id)
  values (v_email, v_name, v_uid)
  on conflict (email) do nothing
  returning id into v_id;
  if v_id is null then
    -- Another request created it at the same moment.
    select id into v_id from public.time_people where user_id = v_uid;
  end if;
  return v_id;
end;
$$;

-- ------------------------------------------------------------------ stop

create or replace function public.time_stop_timer()
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_row public.time_entries;
begin
  if auth.uid() is null
     or not (public.has_role(auth.uid(), 'builder'::public.app_role)
             or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only staff can track time.' using errcode = '42501';
  end if;

  select id into v_person from public.time_people where user_id = auth.uid();
  if v_person is null then
    return null;
  end if;

  select * into v_row from public.time_entries
   where person_id = v_person and end_at is null
   for update;
  if not found then
    return null;
  end if;

  if v_row.start_at >= now() then
    delete from public.time_entries where id = v_row.id;
    v_row.end_at := v_row.start_at;
    return v_row;
  end if;

  update public.time_entries set end_at = now() where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

-- ------------------------------------------------------------------ start

create or replace function public.time_start_timer(
  p_task_id uuid,
  p_client_slug text,
  p_internal boolean,
  p_category text,
  p_description text
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_slug text;
  v_internal boolean := coalesce(p_internal, false);
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_read_only boolean;
  v_row public.time_entries;
begin
  if auth.uid() is null
     or not (public.has_role(auth.uid(), 'builder'::public.app_role)
             or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only staff can track time.' using errcode = '42501';
  end if;

  if p_task_id is not null then
    select t.client_slug, t.read_only into v_slug, v_read_only from public.os_tasks t where t.id = p_task_id;
    if not found then
      raise exception 'That task was not found.' using errcode = '22023';
    end if;
    if v_read_only then
      raise exception 'That task is read-only history from ClickUp, so time cannot be tracked on it.'
        using errcode = '42501';
    end if;
    v_internal := false;
  else
    v_slug := nullif(btrim(coalesce(p_client_slug, '')), '');
    if v_internal and v_slug is not null then
      raise exception 'Choose a client or Internal, not both.' using errcode = '23514';
    end if;
    if not v_internal and v_slug is null then
      raise exception 'Choose a task, a client or Internal.' using errcode = '23514';
    end if;
    if v_category is null then
      raise exception 'Choose a category for time with no task.' using errcode = '23514';
    end if;
  end if;

  v_person := public.time_my_person();

  perform public.time_stop_timer();

  insert into public.time_entries (person_id, task_id, client_slug, is_internal, category, description, start_at)
  values (v_person, p_task_id, v_slug, v_internal, v_category, btrim(coalesce(p_description, '')), now())
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.time_my_person(), public.time_stop_timer(),
  public.time_start_timer(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.time_my_person(), public.time_stop_timer(),
  public.time_start_timer(uuid, text, boolean, text, text) to authenticated, service_role;
