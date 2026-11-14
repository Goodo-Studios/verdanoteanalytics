-- A client's completed hours for the client hub, counted over everyone's time (data audit fix).
--
-- The hub's "hours of scope" read the clients row with its time_entries embedded, which runs under
-- row rules. Since 20261123080001 an employee sees only their own time_entries rows, so the hub
-- showed an employee too few hours. This function totals the client's entries for any staff member
-- (builder or employee) and returns only the total, never the rows, so an employee still cannot
-- read another person's entries.
--
-- Zone rule: the caller passes the period as two instants. The app builds them as local midnight
-- in America/New_York (src/lib/timeReports.ts, STUDIO_ZONE), so the month boundaries are the
-- studio's, not the server's. Same counting rules as the app: an entry belongs to the period when
-- it started inside [p_from, p_to), only completed entries count, and each entry counts whole
-- seconds (floored), as entrySeconds() does.

create or replace function public.time_client_month_seconds(
  p_client_slug text,
  p_from timestamptz,
  p_to timestamptz
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not (public.has_role(auth.uid(), 'builder'::public.app_role)
             or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only staff can read client hours.' using errcode = '42501';
  end if;

  if p_client_slug is null or p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Give a client and a period that ends after it starts.' using errcode = '22023';
  end if;

  return coalesce((
    select sum(floor(extract(epoch from (e.end_at - e.start_at))))::bigint
      from public.time_entries e
     where e.client_slug = p_client_slug
       and e.end_at is not null
       and e.end_at > e.start_at
       and e.start_at >= p_from
       and e.start_at < p_to
  ), 0);
end;
$$;

revoke all on function public.time_client_month_seconds(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.time_client_month_seconds(text, timestamptz, timestamptz) to authenticated, service_role;
