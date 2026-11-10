-- Phase 4, PR 2: invites that send.
--
-- The invite-user function (builder only) creates a login with Supabase Auth's own invite
-- (no typed password, the standard invite email) and gives it its role and, for a client
-- login, its client. This migration adds the record of who invited whom and the two
-- functions around it.
--
--   user_invites          one row per invite: who was invited (email, name, role, client),
--                         by whom, how many times the email was sent, and whether it was
--                         revoked. Builders read it; nobody writes it from the browser. Only
--                         the invite-user function (service role) writes.
--   list_user_invites()   builder: the log with each invite's current state. "Accepted" is
--                         read from the login itself (the invited person confirmed the email).
--   invite_login_state()  service role only: does a login with this email exist, and has its
--                         owner confirmed it yet. The auth schema is not readable through the
--                         API, so the function looks it up.
--
-- Clients read nothing here. Tests: supabase/tests/user_invites_test.sql.

create table public.user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  role public.app_role not null,
  -- The slug is kept as plain text: this is a log, and it must survive a client being removed.
  client_slug text,
  invited_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid not null,
  status text not null default 'sent' check (status in ('sent', 'revoked')),
  sent_count integer not null default 1 check (sent_count >= 1),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  last_sent_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  check ((role = 'client') = (client_slug is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);
-- One open invite per email. A revoked invite does not block a new one.
create unique index user_invites_one_open_per_email on public.user_invites (email) where status = 'sent';
create index user_invites_created_idx on public.user_invites (created_at desc);

comment on table public.user_invites is 'Who invited whom by email (phase 4). Written only by the invite-user function. Builders read.';

alter table public.user_invites enable row level security;
revoke all on table public.user_invites from public, anon, authenticated;
grant select on table public.user_invites to authenticated;
grant all on table public.user_invites to service_role;

create policy "Builder can read user_invites" on public.user_invites
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role));

-- ------------------------------------------------------------------ functions

create or replace function public.list_user_invites()
returns table (
  id uuid,
  email text,
  display_name text,
  role text,
  client_slug text,
  status text,
  sent_count integer,
  created_at timestamptz,
  last_sent_at timestamptz,
  invited_by_name text,
  accepted boolean,
  login_exists boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can read the invites' using errcode = '42501';
  end if;

  return query
  select ui.id, ui.email, ui.display_name, ui.role::text, ui.client_slug, ui.status,
         ui.sent_count, ui.created_at, ui.last_sent_at,
         coalesce(nullif(btrim(coalesce(p.display_name, '')), ''), p.email, 'Someone'),
         (u.id is not null and u.email_confirmed_at is not null),
         (u.id is not null)
    from public.user_invites ui
    left join auth.users u on u.id = ui.invited_user_id
    left join public.profiles p on p.user_id = ui.invited_by
   order by ui.created_at desc
   limit 200;
end;
$$;

create or replace function public.invite_login_state(p_email text)
returns table (user_id uuid, confirmed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, (u.email_confirmed_at is not null)
    from auth.users u
   where lower(btrim(u.email)) = lower(btrim(p_email))
   limit 1
$$;

revoke all on function public.list_user_invites() from public, anon, authenticated;
grant execute on function public.list_user_invites() to authenticated, service_role;
-- Service role only: it reads auth.users for any email, so no signed-in user may call it.
revoke all on function public.invite_login_state(text) from public, anon, authenticated;
grant execute on function public.invite_login_state(text) to service_role;
