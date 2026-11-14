-- Goodo OS story OS-021: invite clients and pilot with two.
--
--   os_invite_excluded_clients    hard exclusion list. A client whose slug is listed, or whose name
--                                 starts with a listed name_prefix, can never be put in a batch, get
--                                 an invite row, or have an invite marked sent. Seeded with the ending
--                                 clients Cattasaurus, Marek, Miracle and Royo under every slug they
--                                 may carry (cattasaurus, marek, marek-health, miracle, miracle-brand,
--                                 royo, royo-bread) plus the name prefixes.
--   os_client_invite_blocked(slug) why a client may not be invited ('excluded', 'ending',
--                                 'unknown_client') or null. Ending means clients.active is false or
--                                 clients.status mentions ending, ended, inactive, churned or cancelled
--                                 (ClickUp marks an ending client in the folder name and the sync sets
--                                 the client inactive).
--   os_client_invite_template     one row: the subject and body of the invite email, and whether a
--                                 builder approved it. Any change to the text clears the approval.
--   os_client_invite_batches      a pilot batch has exactly 2 clients; a later batch 1 to 5. A builder
--                                 approves it; the client-invite function sets sent_at, and
--                                 guest_access_review_after = sent_at + 14 days. The
--                                 guest_access_removal_confirmed_* columns only record Matthew's
--                                 confirmation that the ClickUp guest views may be removed. Nothing in
--                                 the app or the functions changes ClickUp.
--   os_client_invites             one row per contact: draft -> approved (with the batch) -> sent (by
--                                 the client-invite function) -> accepted (first sign-in).
--   os_client_invite_mark_accepted()  the app calls this after a client signs in; it marks that
--                                 login's sent invites accepted.
--   os_client_invite_pilot_status()   staff view per batch client: contacts, sent, accepted, whether
--                                 an invited person has approved a task in the app (OS-019
--                                 os_task_client_decisions or the older client_task_decisions), and
--                                 the guest access review date and confirmation.
--
-- Row rules: builders read every table; employees and clients read nothing. Nobody writes the tables
-- directly: the builder-only functions below and the service role (the client-invite function) do.
-- The guards are triggers, so they hold for the service role too.
--
-- Tests: supabase/tests/os_client_invites_test.sql.

-- ------------------------------------------------------------------ exclusion list

create table public.os_invite_excluded_clients (
  client_slug text primary key check (client_slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name_prefix text not null check (name_prefix ~ '^[a-z0-9]+$'),
  reason text not null check (length(btrim(reason)) between 1 and 200),
  added_at timestamptz not null default now()
);

comment on table public.os_invite_excluded_clients is
  'Clients that must never be invited to the app (OS-021). Matched on slug or on a name starting with name_prefix.';

insert into public.os_invite_excluded_clients (client_slug, name_prefix, reason) values
  ('cattasaurus',   'cattasaurus', 'Ending client, not invited (OS-021)'),
  ('marek',         'marek',       'Ending client, not invited (OS-021)'),
  ('marek-health',  'marek',       'Ending client, not invited (OS-021)'),
  ('miracle',       'miracle',     'Ending client, not invited (OS-021)'),
  ('miracle-brand', 'miracle',     'Ending client, not invited (OS-021)'),
  ('royo',          'royo',        'Ending client, not invited (OS-021)'),
  ('royo-bread',    'royo',        'Ending client, not invited (OS-021)');

create or replace function public.os_client_invite_blocked(p_slug text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_slug is null then 'unknown_client'
    when exists (select 1 from public.os_invite_excluded_clients e where e.client_slug = lower(p_slug)) then 'excluded'
    when not exists (select 1 from public.clients c where c.slug = p_slug) then 'unknown_client'
    when exists (
      select 1 from public.clients c, public.os_invite_excluded_clients e
       where c.slug = p_slug
         and (lower(btrim(c.name)) like e.name_prefix || '%' or c.slug like e.name_prefix || '-%')
    ) then 'excluded'
    when exists (
      select 1 from public.clients c
       where c.slug = p_slug
         and (not c.active or coalesce(c.status, '') ~* '(ending|ended|inactive|churn|cancel)')
    ) then 'ending'
    else null
  end;
$$;
revoke all on function public.os_client_invite_blocked(text) from public, anon, authenticated;
grant execute on function public.os_client_invite_blocked(text) to service_role;

-- ------------------------------------------------------------------ template

create table public.os_client_invite_template (
  id boolean primary key default true check (id),
  subject text not null check (length(btrim(subject)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 5000),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  constraint os_client_invite_template_approval_pair check ((approved_at is null) = (approved_by is null))
);

comment on table public.os_client_invite_template is
  'The client invite email text (OS-021). One row. Editing subject or body clears approved_at/approved_by.';

insert into public.os_client_invite_template (subject, body) values (
  'Your Goodo Studios workspace is ready',
  'Hi! Your Goodo Studios workspace is ready. Use the button in this email to sign in; there is no password to set. You will find your briefs, cuts to review and finished assets there.'
);

create or replace function public.guard_os_client_invite_template()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subject is distinct from old.subject or new.body is distinct from old.body then
    new.approved_at := null;
    new.approved_by := null;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.guard_os_client_invite_template() from public, anon, authenticated;

create trigger os_client_invite_template_guard before update on public.os_client_invite_template
  for each row execute function public.guard_os_client_invite_template();

-- ------------------------------------------------------------------ batches

create table public.os_client_invite_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('pilot', 'batch')),
  client_slugs text[] not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  sent_at timestamptz,
  guest_access_review_after timestamptz,
  guest_access_removal_confirmed_by uuid,
  guest_access_removal_confirmed_at timestamptz,
  constraint os_client_invite_batches_size check (
    (kind = 'pilot' and cardinality(client_slugs) = 2)
    or (kind = 'batch' and cardinality(client_slugs) between 1 and 5)
  ),
  constraint os_client_invite_batches_approval_pair check ((approved_at is null) = (approved_by is null)),
  constraint os_client_invite_batches_sent_needs_approval check (sent_at is null or approved_at is not null),
  constraint os_client_invite_batches_confirm_pair check (
    (guest_access_removal_confirmed_by is null) = (guest_access_removal_confirmed_at is null)),
  constraint os_client_invite_batches_confirm_after_review check (
    guest_access_removal_confirmed_at is null
    or (guest_access_review_after is not null and guest_access_removal_confirmed_at >= guest_access_review_after))
);

comment on table public.os_client_invite_batches is
  'Client invite batches (OS-021): a pilot of 2 clients, then batches of up to 5. guest_access_* only records Matthew''s confirmation; nothing touches ClickUp.';

create or replace function public.guard_os_client_invite_batches()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_slug text;
  v_why text;
begin
  if tg_op = 'UPDATE' and old.sent_at is not null
     and (new.client_slugs is distinct from old.client_slugs or new.kind is distinct from old.kind
          or new.sent_at is distinct from old.sent_at or new.approved_at is distinct from old.approved_at) then
    raise exception 'a sent batch cannot be changed' using errcode = '23514';
  end if;
  if (select count(distinct s) from unnest(new.client_slugs) s) <> cardinality(new.client_slugs) then
    raise exception 'a client is listed twice in the batch' using errcode = '23514';
  end if;
  foreach v_slug in array new.client_slugs loop
    v_why := public.os_client_invite_blocked(v_slug);
    if v_why is not null then
      raise exception 'client % cannot be invited (%)', v_slug, v_why using errcode = '23514';
    end if;
  end loop;
  if tg_op = 'UPDATE' and new.client_slugs is distinct from old.client_slugs then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  if new.sent_at is not null then
    new.guest_access_review_after := new.sent_at + interval '14 days';
  else
    new.guest_access_review_after := null;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_os_client_invite_batches() from public, anon, authenticated;

create trigger os_client_invite_batches_guard before insert or update on public.os_client_invite_batches
  for each row execute function public.guard_os_client_invite_batches();

-- ------------------------------------------------------------------ invites

create table public.os_client_invites (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.os_client_invite_batches(id) on delete cascade,
  client_slug text not null references public.clients(slug) on update cascade on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 320),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'accepted')),
  invited_user_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  sent_at timestamptz,
  accepted_at timestamptz,
  constraint os_client_invites_sent_has_time check (status not in ('sent', 'accepted') or sent_at is not null),
  constraint os_client_invites_accepted_has_time check ((status = 'accepted') = (accepted_at is not null)),
  unique (batch_id, email)
);

create index os_client_invites_user_idx on public.os_client_invites (invited_user_id);
create index os_client_invites_email_idx on public.os_client_invites (email);

comment on table public.os_client_invites is
  'Client contacts to invite (OS-021): draft, approved (with the batch), sent (client-invite function), accepted (first sign-in).';

create or replace function public.guard_os_client_invites()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_batch public.os_client_invite_batches%rowtype;
  v_why text;
begin
  select * into v_batch from public.os_client_invite_batches where id = new.batch_id;
  if not (new.client_slug = any (v_batch.client_slugs)) then
    raise exception 'client % is not in this batch', new.client_slug using errcode = '23514';
  end if;
  v_why := public.os_client_invite_blocked(new.client_slug);
  if v_why is not null and (tg_op = 'INSERT' or new.status in ('approved', 'sent')) then
    raise exception 'client % cannot be invited (%)', new.client_slug, v_why using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception 'a new invite starts as a draft' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and v_batch.sent_at is not null then
    raise exception 'the batch was already sent' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.status = 'sent' and old.status <> 'sent' then
    if old.status <> 'approved' or v_batch.approved_at is null then
      raise exception 'only an approved invite in an approved batch can be sent' using errcode = '23514';
    end if;
    if not exists (select 1 from public.os_client_invite_template where approved_at is not null) then
      raise exception 'the invite email text is not approved' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' and old.status <> 'sent' then
    raise exception 'only a sent invite can be accepted' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_os_client_invites() from public, anon, authenticated;

create trigger os_client_invites_guard before insert or update on public.os_client_invites
  for each row execute function public.guard_os_client_invites();

-- ------------------------------------------------------------------ row rules

alter table public.os_invite_excluded_clients enable row level security;
alter table public.os_client_invite_template enable row level security;
alter table public.os_client_invite_batches enable row level security;
alter table public.os_client_invites enable row level security;

revoke all on table public.os_invite_excluded_clients, public.os_client_invite_template,
  public.os_client_invite_batches, public.os_client_invites from public, anon, authenticated;
grant select on table public.os_invite_excluded_clients, public.os_client_invite_template,
  public.os_client_invite_batches, public.os_client_invites to authenticated;
grant all on table public.os_invite_excluded_clients, public.os_client_invite_template,
  public.os_client_invite_batches, public.os_client_invites to service_role;

create policy "Builders can read os_invite_excluded_clients" on public.os_invite_excluded_clients
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builders can read os_client_invite_template" on public.os_client_invite_template
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builders can read os_client_invite_batches" on public.os_client_invite_batches
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builders can read os_client_invites" on public.os_client_invites
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));

-- ------------------------------------------------------------------ builder functions
-- Each refuses anyone who is not a builder with 42501.

create or replace function public.os_client_invite_save_template(p_subject text, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'builders only' using errcode = '42501';
  end if;
  update public.os_client_invite_template
     set subject = btrim(p_subject), body = btrim(p_body), updated_by = auth.uid()
   where id;
end;
$$;

create or replace function public.os_client_invite_approve_template()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'builders only' using errcode = '42501';
  end if;
  update public.os_client_invite_template set approved_at = now(), approved_by = auth.uid() where id;
end;
$$;

create or replace function public.os_client_invite_create_batch(p_name text, p_kind text, p_client_slugs text[])
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
    raise exception 'builders only' using errcode = '42501';
  end if;
  insert into public.os_client_invite_batches (name, kind, client_slugs, created_by)
  values (btrim(p_name), p_kind, p_client_slugs, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.os_client_invite_add_contact(p_batch_id uuid, p_client_slug text, p_email text, p_display_name text)
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
    raise exception 'builders only' using errcode = '42501';
  end if;
  if exists (select 1 from public.os_client_invite_batches where id = p_batch_id and approved_at is not null) then
    raise exception 'the batch is already approved; contacts cannot be added' using errcode = '23514';
  end if;
  insert into public.os_client_invites (batch_id, client_slug, email, display_name, created_by)
  values (p_batch_id, p_client_slug, lower(btrim(p_email)), btrim(p_display_name), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.os_client_invite_remove_contact(p_invite_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'builders only' using errcode = '42501';
  end if;
  delete from public.os_client_invites where id = p_invite_id and status = 'draft';
  if not found then
    raise exception 'only a draft contact can be removed' using errcode = '23514';
  end if;
end;
$$;

-- Approves the batch and its draft contacts. Every client in the batch needs at least one contact.
create or replace function public.os_client_invite_approve_batch(p_batch_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_batch public.os_client_invite_batches%rowtype;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'builders only' using errcode = '42501';
  end if;
  select * into v_batch from public.os_client_invite_batches where id = p_batch_id for update;
  if not found then
    raise exception 'batch not found' using errcode = 'P0002';
  end if;
  if v_batch.sent_at is not null then
    raise exception 'the batch was already sent' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(v_batch.client_slugs) s
              where not exists (select 1 from public.os_client_invites i where i.batch_id = p_batch_id and i.client_slug = s)) then
    raise exception 'every client in the batch needs at least one contact' using errcode = '23514';
  end if;
  -- Re-runs the batch guard (excluded or ending clients) on the current client list.
  update public.os_client_invite_batches set approved_at = now(), approved_by = auth.uid() where id = p_batch_id;
  update public.os_client_invites set status = 'approved' where batch_id = p_batch_id and status = 'draft';
end;
$$;

-- Records that Matthew confirmed the ClickUp guest views of this batch's clients may be removed.
-- Only possible 14 days after the batch was sent. Nothing is removed by this call.
create or replace function public.os_client_invite_confirm_guest_removal(p_batch_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_batch public.os_client_invite_batches%rowtype;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'builders only' using errcode = '42501';
  end if;
  select * into v_batch from public.os_client_invite_batches where id = p_batch_id for update;
  if not found then
    raise exception 'batch not found' using errcode = 'P0002';
  end if;
  if v_batch.sent_at is null or now() < v_batch.guest_access_review_after then
    raise exception 'guest access can be reviewed only 14 days after the batch was sent' using errcode = '23514';
  end if;
  if v_batch.guest_access_removal_confirmed_at is not null then
    return;
  end if;
  update public.os_client_invite_batches
     set guest_access_removal_confirmed_by = auth.uid(), guest_access_removal_confirmed_at = now()
   where id = p_batch_id;
end;
$$;

-- Staff view: one row per batch client.
create or replace function public.os_client_invite_pilot_status()
returns table (
  batch_id uuid, batch_name text, kind text, client_slug text, client_name text,
  contacts integer, sent integer, accepted integer, client_approval_done boolean,
  batch_sent_at timestamptz, guest_access_review_after timestamptz,
  guest_access_removal_confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'builders only' using errcode = '42501';
  end if;
  return query
  select b.id, b.name, b.kind, s.slug, coalesce(c.name, s.slug),
         (select count(*)::int from public.os_client_invites i where i.batch_id = b.id and i.client_slug = s.slug),
         (select count(*)::int from public.os_client_invites i where i.batch_id = b.id and i.client_slug = s.slug and i.status in ('sent', 'accepted')),
         (select count(*)::int from public.os_client_invites i where i.batch_id = b.id and i.client_slug = s.slug and i.status = 'accepted'),
         exists (
           select 1 from public.os_client_invites i
            where i.batch_id = b.id and i.client_slug = s.slug and i.invited_user_id is not null
              and (exists (select 1 from public.os_task_client_decisions d
                            where d.client_slug = s.slug and d.decided_by = i.invited_user_id and d.decision = 'approved')
                or exists (select 1 from public.client_task_decisions d
                            where d.client_slug = s.slug and d.decided_by = i.invited_user_id and d.decision = 'approved'))
         ),
         b.sent_at, b.guest_access_review_after, b.guest_access_removal_confirmed_at
    from public.os_client_invite_batches b
    cross join lateral unnest(b.client_slugs) as s(slug)
    left join public.clients c on c.slug = s.slug
   order by b.created_at, b.id, s.slug;
end;
$$;

-- ------------------------------------------------------------------ accepted

-- Any signed-in user: marks their own sent invites accepted. Matches the login id the function
-- recorded, or the login email. Returns how many rows changed.
create or replace function public.os_client_invite_mark_accepted()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_n integer;
begin
  if v_uid is null then
    return 0;
  end if;
  select lower(btrim(email)) into v_email from auth.users where id = v_uid;
  update public.os_client_invites
     set status = 'accepted', accepted_at = now(), invited_user_id = coalesce(invited_user_id, v_uid)
   where status = 'sent'
     and (invited_user_id = v_uid or (invited_user_id is null and email = v_email));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'os_client_invite_save_template(text, text)',
    'os_client_invite_approve_template()',
    'os_client_invite_create_batch(text, text, text[])',
    'os_client_invite_add_contact(uuid, text, text, text)',
    'os_client_invite_remove_contact(uuid)',
    'os_client_invite_approve_batch(uuid)',
    'os_client_invite_confirm_guest_removal(uuid)',
    'os_client_invite_pilot_status()',
    'os_client_invite_mark_accepted()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;
