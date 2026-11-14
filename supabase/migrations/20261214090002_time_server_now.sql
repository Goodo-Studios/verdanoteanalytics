-- The database clock, for the running timer (data audit fix).
--
-- The timer pill worked out elapsed time as the browser's Date.now() minus the entry's start_at,
-- which the database set with now(). A browser clock that is wrong by a minute showed a timer a
-- minute long or short, or negative (clamped to 0). The app now asks for the database's clock and
-- uses the difference to its own clock, so elapsed time is measured on one clock.

create or replace function public.time_server_now()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not (public.has_role(auth.uid(), 'builder'::public.app_role)
             or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only staff can track time.' using errcode = '42501';
  end if;
  return clock_timestamp();
end;
$$;

revoke all on function public.time_server_now() from public, anon;
grant execute on function public.time_server_now() to authenticated, service_role;
