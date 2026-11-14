-- create_call_sheet accepted any non-empty token, but the public side (the public-link function)
-- only honors a token of 32 to 128 url-safe characters. A staff member could save a call sheet whose
-- link could never open. Add that shape check; everything else is the definition from
-- 20261101000002 unchanged (same signature, security, search_path and staff check).
--
-- CREATE OR REPLACE keeps the grants (authenticated only, set by 20261101000002 and 20261101000020),
-- so none are touched here.

CREATE OR REPLACE FUNCTION public.create_call_sheet(p_shoot_id uuid, p_token text, p_call_time time without time zone DEFAULT NULL::time without time zone, p_wrap_time_estimate text DEFAULT NULL::text, p_general_notes text DEFAULT NULL::text, p_crew_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shoot shoots%rowtype;
  v_token text;
  v_row   call_sheets%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can create a call sheet.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_shoot_id is null then
    raise exception 'p_shoot_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  v_token := btrim(coalesce(p_token, ''));
  if v_token = '' then
    raise exception 'p_token is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The same shape the public link checks (TOKEN_SHAPE in supabase/functions/_shared/public-link.ts).
  if v_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'p_token must be 32 to 128 letters, digits, dashes or underscores'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_shoot
  from shoots
  where id = p_shoot_id;

  if not found then
    raise exception 'Shoot not found.'
      using errcode = 'no_data_found';
  end if;

  -- NO "has this got a date yet?" CHECK, AND THAT IS THE POINT. `049` refused
  -- an assignment whose `scheduled_shoot_date` was null because the date lived
  -- on the actor's row. A `shoots` row carries its own `shoot_date NOT NULL`
  -- (058), so a production ALWAYS has a date to print and a call sheet can be
  -- built before anybody is cast - crew, location and call time are known long
  -- before talent is. See migration 20261101000002's header.

  insert into call_sheets (
    shoot_id, token, call_time, wrap_time_estimate, general_notes
  )
  values (
    p_shoot_id,
    v_token,
    p_call_time,
    nullif(btrim(coalesce(p_wrap_time_estimate, '')), ''),
    nullif(btrim(coalesce(p_general_notes, '')), '')
  )
  returning * into v_row;

  if p_crew_member_ids is not null and array_length(p_crew_member_ids, 1) > 0 then
    insert into call_sheet_crew (call_sheet_id, crew_member_id)
    select v_row.id, cm_id
    from unnest(p_crew_member_ids) as cm_id;
  end if;

  return to_jsonb(v_row);
end;
$function$;
