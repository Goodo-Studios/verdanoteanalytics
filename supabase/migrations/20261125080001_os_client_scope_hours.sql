-- Goodo OS story OS-013: hours per client against monthly scope.
--
-- Before this, a client's scope was only words (clients.scope, for example "4 UGC videos per
-- month") and agreed deliverables on engagement terms. There was no hours figure anywhere, so
-- this adds one:
--
--   clients.monthly_scope_hours   hours per calendar month the client's scope allows. Null means
--                                 no hours figure is set; the client hub then says so.
--
-- Who can see and change it: clients is readable by staff only (the "Staff read clients" row
-- rule); client logins read nothing from it. Signed-in users have no write grant on clients, so
-- the column changes only through set_client_scope_hours(), which refuses anyone who is not a
-- builder. Same pattern as set_client_scope.

alter table public.clients
  add column monthly_scope_hours numeric(6, 2)
    constraint clients_monthly_scope_hours_range
      check (monthly_scope_hours is null or (monthly_scope_hours > 0 and monthly_scope_hours <= 744));

comment on column public.clients.monthly_scope_hours is
  'Hours per month in the client''s scope (OS-013). Null: not set. Builder sets it with set_client_scope_hours().';

create or replace function public.set_client_scope_hours(p_slug text, p_hours numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'Only admins can set a client''s scope hours.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where slug = p_slug) then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  if p_hours is not null and (p_hours <= 0 or p_hours > 744) then
    raise exception 'Scope hours must be more than 0 and at most 744 a month.' using errcode = '22023';
  end if;

  update public.clients set monthly_scope_hours = round(p_hours, 2), updated_at = now()
   where slug = p_slug
  returning monthly_scope_hours into v_hours;
  return v_hours;
end;
$$;

revoke all on function public.set_client_scope_hours(text, numeric) from public, anon, authenticated;
grant execute on function public.set_client_scope_hours(text, numeric) to authenticated, service_role;
