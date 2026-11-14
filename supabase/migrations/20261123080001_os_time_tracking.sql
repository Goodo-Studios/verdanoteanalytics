-- Goodo OS story OS-011: time tracking moves into the app (data layer only).
--
-- Copies Goodo Time's model into tables prefixed time_:
--
--   time_people         one row per person who tracks time, keyed by email. user_id is the app
--                       login with that email, filled by time_link_people(); it stays null for
--                       someone with no login yet, and their entries are still kept and counted.
--                       Holds the monthly fee an admin sets. Address and payment details are
--                       NOT copied from Goodo Time (left out on purpose for now).
--   time_clients        clients time is tracked against (names unique regardless of case).
--   time_projects       projects, optionally under a client (names unique per client).
--   time_entries        one row per entry or running timer (end_at null).
--   time_invoices       one invoice per person per half-month (1st-15th or 16th-last day).
--   time_invoice_lines  fee, time (hours per project) and fixed (expense) lines.
--
-- Rules the database enforces (the same rules as Goodo Time):
--   end after start; one person's entries never overlap, with a running timer open-ended and
--   ranges half-open so 10:00-11:00 and 11:00-12:00 do not clash; at most one running timer per
--   person; an entry is on at most one invoice, and only on an invoice of the same person, and
--   only once it has ended; an entry is at most 24 hours long when typed in or edited (stopping
--   a timer never fails on length, as in Goodo Time, and rows copied from Goodo Time keep their
--   length); a new entry, or an entry moved to another project, cannot use an archived project;
--   once an invoice is sent its entries, fields and lines are locked until a builder reopens it;
--   only a builder marks an invoice paid or reopens it; only a draft can be deleted.
--
-- Access:
--   builder (admin)  reads and manages everyone's time, invoices, people, clients and projects.
--   employee         reads and writes only their own entries and invoices (their time_people row
--                    has user_id = auth.uid()); reads clients and projects; reads their own
--                    time_people row and cannot change it.
--   client, anon     nothing.
--   service_role     everything; the copy script (scripts/migrate-goodo-time.mjs) runs as it.
--
-- source_id columns hold Goodo Time's integer ids so the copy script can upsert and be re-run.

create extension if not exists btree_gist with schema extensions;

-- ------------------------------------------------------------------ helpers

-- True for a builder, or for the service role (edge functions and the copy script).
create or replace function public.time_is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.role() = 'service_role', false)
      or coalesce(public.has_role(auth.uid(), 'builder'::public.app_role), false);
$$;

revoke all on function public.time_is_admin() from public, anon;
grant execute on function public.time_is_admin() to authenticated, service_role;

-- ------------------------------------------------------------------ people

create table public.time_people (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and email like '%@%'),
  name text not null check (length(btrim(name)) > 0),
  user_id uuid unique references auth.users(id) on delete set null,
  source_role text not null default 'member' check (source_role in ('admin', 'member')),
  active boolean not null default true,
  monthly_fee_cents integer check (monthly_fee_cents is null or monthly_fee_cents >= 0),
  source_id integer unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index time_people_email_key on public.time_people (email);

create trigger update_time_people_updated_at before update on public.time_people
  for each row execute function public.update_updated_at_column();

comment on table public.time_people is
  'People who track time (OS-011). Keyed by email; user_id is the app login with that email, or null.';

-- Link people to app logins with the same email. Returns how many rows were linked.
create or replace function public.time_link_people()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.time_people p
     set user_id = u.id
    from auth.users u
   where p.user_id is null
     and lower(u.email) = p.email
     and not exists (select 1 from public.time_people o where o.user_id = u.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.time_link_people() from public, anon, authenticated;
grant execute on function public.time_link_people() to service_role;

-- ------------------------------------------------------------------ clients and projects

create table public.time_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0 and length(name) <= 120),
  archived boolean not null default false,
  source_id integer unique,
  created_at timestamptz not null default now()
);

create unique index time_clients_name_key on public.time_clients (lower(name));

create table public.time_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.time_clients(id),
  name text not null check (length(btrim(name)) > 0 and length(name) <= 120),
  archived boolean not null default false,
  source_id integer unique,
  created_at timestamptz not null default now()
);

create unique index time_projects_client_name_key
  on public.time_projects (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ------------------------------------------------------------------ invoices

create table public.time_invoices (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.time_people(id),
  number integer not null check (number > 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'paid')),
  period_from date not null,
  period_to date not null,
  issued_on date not null,
  due_on date,
  bill_to text not null default '',
  notes text not null default '',
  submitted_at timestamptz,
  paid_at timestamptz,
  source_id integer unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_invoices_number_per_person unique (person_id, number),
  constraint time_invoices_one_per_period unique (person_id, period_from),
  -- Lets time_entries require that an entry's invoice belongs to the same person.
  constraint time_invoices_id_person unique (id, person_id),
  -- An invoice covers the 1st to the 15th, or the 16th to the last day of the month.
  constraint time_invoices_half_month check (
    (extract(day from period_from) = 1 and period_to = period_from + 14)
    or (extract(day from period_from) = 16
        and period_to = (date_trunc('month', period_from) + interval '1 month - 1 day')::date)
  )
);

create index time_invoices_person_idx on public.time_invoices (person_id, period_from);

create trigger update_time_invoices_updated_at before update on public.time_invoices
  for each row execute function public.update_updated_at_column();

create table public.time_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.time_invoices(id) on delete cascade,
  kind text not null check (kind in ('fee', 'time', 'fixed')),
  description text not null,
  seconds integer check (seconds is null or seconds >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  position integer not null default 0,
  source_id integer unique
);

create index time_invoice_lines_invoice_idx on public.time_invoice_lines (invoice_id);

-- ------------------------------------------------------------------ entries

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.time_people(id),
  project_id uuid references public.time_projects(id),
  description text not null default '' check (length(description) <= 500),
  start_at timestamptz not null,
  end_at timestamptz,
  invoice_id uuid,
  source_id integer unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_end_after_start check (end_at is null or end_at > start_at),
  -- Only a completed entry can be billed.
  constraint time_entries_invoice_needs_end check (invoice_id is null or end_at is not null),
  -- The invoice must be the same person's. Deleting a draft frees its entries.
  constraint time_entries_invoice_same_person foreign key (invoice_id, person_id)
    references public.time_invoices (id, person_id) on delete set null (invoice_id),
  -- One person's entries never overlap. A running timer (no end) is open-ended.
  -- Ranges are half-open, so 10:00-11:00 and 11:00-12:00 do not clash.
  constraint time_entries_no_overlap
    exclude using gist (person_id with =, tstzrange(start_at, end_at, '[)') with &&)
);

create index time_entries_person_start_idx on public.time_entries (person_id, start_at);
create index time_entries_invoice_idx on public.time_entries (invoice_id) where invoice_id is not null;

-- At most one running timer per person.
create unique index time_entries_one_running on public.time_entries (person_id) where end_at is null;

create trigger update_time_entries_updated_at before update on public.time_entries
  for each row execute function public.update_updated_at_column();

comment on table public.time_entries is
  'Time entries and running timers (OS-011). No overlaps per person; locked once on a sent invoice.';

-- ------------------------------------------------------------------ entry rules

create or replace function public.time_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    select status into v_status from public.time_invoices where id = old.invoice_id;
    if coalesce(v_status, 'draft') <> 'draft' then
      raise exception 'This entry is on an invoice that was sent. Reopen the invoice to change it.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- Time on a sent invoice stays as it was billed. The copy script (service role) may write
  -- it, so a re-run can bring a sent invoice's entries across.
  if tg_op = 'UPDATE' and old.invoice_id is not null
     and (old.person_id, old.project_id, old.description, old.start_at, old.end_at, old.invoice_id)
         is distinct from (new.person_id, new.project_id, new.description, new.start_at, new.end_at, new.invoice_id)
     and coalesce(auth.role(), '') <> 'service_role' then
    select status into v_status from public.time_invoices where id = old.invoice_id;
    if coalesce(v_status, 'draft') <> 'draft' then
      raise exception 'This entry is on an invoice that was sent. Reopen the invoice to change it.'
        using errcode = '42501';
    end if;
  end if;

  -- No time is added to a sent invoice.
  if new.invoice_id is not null
     and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id)
     and coalesce(auth.role(), '') <> 'service_role' then
    select status into v_status from public.time_invoices where id = new.invoice_id;
    if coalesce(v_status, 'draft') <> 'draft' then
      raise exception 'Time cannot be added to an invoice that was sent.' using errcode = '42501';
    end if;
  end if;

  -- 24-hour cap for typed-in and edited entries. Stopping a running timer is exempt (Goodo Time
  -- records the real time and lets the person split it afterwards), as are rows copied from
  -- Goodo Time and edits that leave the times as they were.
  if new.end_at is not null and new.end_at - new.start_at > interval '24 hours'
     and not (tg_op = 'INSERT' and new.source_id is not null)
     and not (tg_op = 'UPDATE' and old.end_at is null and new.start_at = old.start_at)
     and not (tg_op = 'UPDATE' and new.start_at = old.start_at and new.end_at = old.end_at) then
    raise exception 'An entry cannot be longer than 24 hours. Split it into separate entries.'
      using errcode = '23514';
  end if;

  -- Archived projects are only allowed on entries that already use them.
  if new.project_id is not null
     and ((tg_op = 'INSERT' and new.source_id is null)
          or (tg_op = 'UPDATE' and new.project_id is distinct from old.project_id))
     and exists (select 1 from public.time_projects where id = new.project_id and archived) then
    raise exception 'That project is archived. Choose an active project.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger time_entries_guard before insert or update or delete on public.time_entries
  for each row execute function public.time_entries_guard();

-- ------------------------------------------------------------------ invoice rules

create or replace function public.time_invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.time_is_admin();
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not v_admin then
      raise exception 'A new invoice starts as a draft.' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Only a draft invoice can be deleted.' using errcode = '42501';
    end if;
    return old;
  end if;

  -- A sent or paid invoice keeps its contents. Only its status (and the dates that go with it)
  -- can change, and only a builder changes it: mark paid, or reopen as a draft.
  if old.status <> 'draft' then
    if (old.person_id, old.number, old.period_from, old.period_to, old.issued_on, old.due_on, old.bill_to, old.notes)
       is distinct from
       (new.person_id, new.number, new.period_from, new.period_to, new.issued_on, new.due_on, new.bill_to, new.notes)
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'This invoice was sent, so it cannot be changed. Ask an admin to reopen it.'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not v_admin then
      raise exception 'Only an admin can mark an invoice paid or reopen it.' using errcode = '42501';
    end if;
  end if;

  if old.status = 'draft' and new.status = 'paid' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only an invoice that was sent can be marked paid.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger time_invoices_guard before insert or update or delete on public.time_invoices
  for each row execute function public.time_invoices_guard();

create or replace function public.time_invoice_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_locked boolean;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_ids := array[new.invoice_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.invoice_id, new.invoice_id];
  else
    v_ids := array[old.invoice_id];
  end if;
  -- No row means the invoice is being deleted (only drafts can be), so its lines go with it.
  select coalesce(bool_or(status <> 'draft'), false) into v_locked
    from public.time_invoices where id = any (v_ids);
  if v_locked then
    raise exception 'This invoice was sent, so its lines cannot be changed.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger time_invoice_lines_guard before insert or update or delete on public.time_invoice_lines
  for each row execute function public.time_invoice_lines_guard();

revoke all on function public.time_entries_guard(), public.time_invoices_guard(),
  public.time_invoice_lines_guard() from public, anon, authenticated;

-- ------------------------------------------------------------------ grants and row rules

alter table public.time_people enable row level security;
alter table public.time_clients enable row level security;
alter table public.time_projects enable row level security;
alter table public.time_entries enable row level security;
alter table public.time_invoices enable row level security;
alter table public.time_invoice_lines enable row level security;

revoke all on table public.time_people, public.time_clients, public.time_projects, public.time_entries,
  public.time_invoices, public.time_invoice_lines from public, anon, authenticated;

grant select, insert, update, delete on table public.time_people, public.time_clients, public.time_projects,
  public.time_entries, public.time_invoices, public.time_invoice_lines to authenticated;
grant all on table public.time_people, public.time_clients, public.time_projects, public.time_entries,
  public.time_invoices, public.time_invoice_lines to service_role;

-- People: a builder manages everyone; an employee reads only their own row.
create policy "Builders manage time_people" on public.time_people
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Employees read their own time_people row" on public.time_people
  for select to authenticated
  using (user_id = auth.uid() and public.has_role(auth.uid(), 'employee'::public.app_role));

-- Clients and projects: staff read; builders write.
create policy "Staff read time_clients" on public.time_clients
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builders manage time_clients" on public.time_clients
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Staff read time_projects" on public.time_projects
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builders manage time_projects" on public.time_projects
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

-- Entries: a builder manages everyone's; an employee only their own.
create policy "Builders manage time_entries" on public.time_entries
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Employees manage their own time_entries" on public.time_entries
  for all to authenticated
  using (public.has_role(auth.uid(), 'employee'::public.app_role)
         and person_id in (select p.id from public.time_people p where p.user_id = auth.uid()))
  with check (public.has_role(auth.uid(), 'employee'::public.app_role)
              and person_id in (select p.id from public.time_people p where p.user_id = auth.uid()));

-- Invoices: same split as entries.
create policy "Builders manage time_invoices" on public.time_invoices
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Employees manage their own time_invoices" on public.time_invoices
  for all to authenticated
  using (public.has_role(auth.uid(), 'employee'::public.app_role)
         and person_id in (select p.id from public.time_people p where p.user_id = auth.uid()))
  with check (public.has_role(auth.uid(), 'employee'::public.app_role)
              and person_id in (select p.id from public.time_people p where p.user_id = auth.uid()));

-- Lines follow their invoice: whoever can see the invoice can work on its lines.
create policy "Staff manage lines of invoices they can see" on public.time_invoice_lines
  for all to authenticated
  using ((public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
         and invoice_id in (select i.id from public.time_invoices i))
  with check ((public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
              and invoice_id in (select i.id from public.time_invoices i));
