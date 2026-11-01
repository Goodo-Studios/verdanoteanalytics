-- Dashboard data foundation 2/6: staff functions and triggers
--
-- The dashboard's functions that run with the owner's rights (SECURITY DEFINER)
-- and bypass row rules: approving and rejecting applications, approval board and
-- vote changes, clients, shoots, locations, props, shipments, crew and call
-- sheets. Each one used to check app_users through is_active_user(),
-- is_active_non_viewer() or is_active_admin(). Here each one checks the Verdanote
-- staff role instead:
--
--   staff   = has_role(auth.uid(), 'builder') or has_role(auth.uid(), 'employee')
--   admin   = has_role(auth.uid(), 'builder')   (was app_users.role = 'admin')
--
-- A client (or anyone without a staff role) is refused with insufficient_privilege.
-- EXECUTE is revoked from PUBLIC and anon and granted to authenticated only.
--
-- Not ported, because the public forms and token links stay with the old
-- dashboard: the anon-callable functions (submit_*_application,
-- create_*_upload_url, get_*board*, get_call_sheet, cast_*_vote,
-- record_public_error), the helpers only they use (signed_upload_expiry,
-- sniff_storage_object_mime, verify_content_or_reject) and the old role checks
-- (is_active_*, link_current_app_user).
--
-- storage_admin_request reads the Storage project URL and service key from the
-- vault (secrets storage_signing_project_url and storage_signing_service_role_key)
-- instead of the dashboard URL that was hard coded. It needs the http extension.

create extension if not exists http with schema extensions;

CREATE OR REPLACE FUNCTION public.actor_application_tristate(p_payload jsonb, p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
           when jsonb_typeof(p_payload -> p_key) = 'boolean'
             then (p_payload ->> p_key)::boolean
           else null
         end;
$function$;

CREATE OR REPLACE FUNCTION public.application_flag(p_payload jsonb, p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
           when jsonb_typeof(p_payload -> p_key) = 'boolean'
             then (p_payload ->> p_key)::boolean
           else false
         end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_actor_approval_votes(p_client_slug text, p_votes jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated_at timestamptz := now();
  v_count      integer := 0;
  v_item       jsonb;
  v_id         uuid;
  v_vote       text;
  v_stage      text;
  v_row_count  integer;
begin
  -- SECURITY DEFINER bypasses actor_assignments' RLS entirely (that is the
  -- point - this is the one write path that must succeed atomically across many
  -- rows), which also means the deactivation and viewer-role checks on that
  -- table's write policy never run for this call. Re-check explicitly so
  -- neither gap reopens through this function. Same predicate and same SQLSTATE
  -- as 016 gave apply_approval_votes.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can apply approvals.'
      using errcode = '42501';
  end if;

  if p_client_slug is null or btrim(p_client_slug) = '' then
    raise exception 'p_client_slug is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_votes is null or jsonb_typeof(p_votes) <> 'array' then
    raise exception 'p_votes must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(p_votes)
  loop
    v_id := (v_item ->> 'assignment_id')::uuid;
    v_vote := v_item ->> 'vote';

    if v_vote not in ('up', 'down') then
      raise exception 'invalid vote %  for assignment %  - must be up or down',
        v_vote, v_id
        using errcode = 'invalid_parameter_value';
    end if;

    v_stage := case v_vote when 'up' then 'client_approved' else 'declined' end;

    -- Scoped to p_client_slug as well as id, mirroring the board resolver's
    -- load-bearing client_slug predicate - a vote can only move an assignment
    -- that actually belongs to the brand this apply is for.
    update actor_assignments
    set stage = v_stage,
        updated_at = v_updated_at
    where id = v_id
      and client_slug = p_client_slug;

    get diagnostics v_row_count = row_count;

    if v_row_count = 0 then
      raise exception
        'assignment %  not found for client %  - aborting, nothing applied',
        v_id, p_client_slug
        using errcode = 'no_data_found';
    end if;

    v_count := v_count + v_row_count;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_approval_votes(p_client_slug text, p_votes jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated_at timestamptz := now();
  v_count      integer := 0;
  v_item       jsonb;
  v_id         uuid;
  v_vote       text;
  v_stage      text;
  v_row_count  integer;
begin
  -- SECURITY DEFINER bypasses creator_assignments' RLS entirely (that is the
  -- point - this is the one write path that must succeed atomically across
  -- many rows), which also means the migration-013 deactivation check (and,
  -- as of migration 016, the viewer-role check) on that table's write policy
  -- never runs for this call. Re-check explicitly so neither gap reopens
  -- through this function.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can apply approvals.'
      using errcode = '42501';
  end if;

  if p_client_slug is null or btrim(p_client_slug) = '' then
    raise exception 'p_client_slug is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_votes is null or jsonb_typeof(p_votes) <> 'array' then
    raise exception 'p_votes must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(p_votes)
  loop
    v_id := (v_item ->> 'assignment_id')::uuid;
    v_vote := v_item ->> 'vote';

    if v_vote not in ('up', 'down') then
      raise exception 'invalid vote %  for assignment %  - must be up or down',
        v_vote, v_id
        using errcode = 'invalid_parameter_value';
    end if;

    v_stage := case v_vote when 'up' then 'client_approved' else 'declined' end;

    -- Scoped to p_client_slug as well as id, mirroring get_approval_board's
    -- load-bearing client_slug predicate - a vote can only move an
    -- assignment that actually belongs to the brand this apply is for, even
    -- if the caller's payload somehow named a foreign assignment_id.
    update creator_assignments
    set stage = v_stage,
        updated_at = v_updated_at
    where id = v_id
      and client_slug = p_client_slug;

    get diagnostics v_row_count = row_count;

    if v_row_count = 0 then
      raise exception
        'assignment %  not found for client %  - aborting, nothing applied',
        v_id, p_client_slug
        using errcode = 'no_data_found';
    end if;

    v_count := v_count + v_row_count;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_actor_application(application_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '90s'
AS $function$
declare
  v_app        actor_applications%rowtype;
  v_reviewer   uuid;
  v_actor_id   uuid;
  v_headshot   text;
  v_video      record;
  v_dest       text;
  v_thumb      text;
  v_resp       jsonb;
  v_src_images text[] := '{}';
  v_src_videos text[] := '{}';
begin
  -- `and active` is load-bearing. Clearing app_users.active does NOT delete the
  -- Supabase auth user - a deactivated employee can still sign in and still
  -- holds the `authenticated` role, which is all this grant requires. Without
  -- this clause they could keep approving applications after offboarding:
  -- creating actors and moving and deleting storage objects.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only an active signed-in staff user can approve an application'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verdanote logins are a different pool from the old dashboard, so the
  -- reviewer row is found by email. reviewed_by stays null when the signed-in
  -- staff member has no copied app_users row.
  select au.id into v_reviewer
  from app_users au
  join auth.users u on lower(u.email) = lower(au.email)
  where u.id = auth.uid()
    and au.active;

  -- 016's rule, restated in-function: this is SECURITY DEFINER and therefore
  -- bypasses RLS entirely, so the viewer restriction has to be checked here or
  -- it is not checked at all. Approving creates an `actors` row, which a viewer
  -- may not do through any other route.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'viewers cannot approve applications'
      using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE + the status guard together make a double-approve impossible:
  -- the second caller blocks until the first commits, then reads 'approved' and
  -- refuses. Without the lock both could read 'pending' and each create an
  -- actor.
  select * into v_app
  from actor_applications
  where id = application_id
  for update;

  if not found then
    raise exception 'application % not found', application_id
      using errcode = 'no_data_found';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'application % has already been % and cannot be approved',
      application_id, v_app.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Minted up front so destination paths can be built before the row exists.
  v_actor_id := gen_random_uuid();

  -- --- media: copy first, delete last ---------------------------------------
  -- HTTP calls are not transactional. Ordering every copy before every delete
  -- means the worst case is an orphaned duplicate in the destination bucket
  -- (harmless, private, staff-read-only) rather than a source object deleted
  -- against a copy that never landed.
  if v_app.headshot_path is not null then
    v_headshot := v_actor_id::text || '/headshot-'
               || regexp_replace(v_app.headshot_path, '^.*/', '');

    v_resp := storage_admin_request('POST', '/object/copy', jsonb_build_object(
      'bucketId',          'actor-application-headshots',
      'sourceKey',         v_app.headshot_path,
      'destinationBucket', 'actor-headshots',
      'destinationKey',    v_headshot
    ));

    if (v_resp ->> 'status')::int not in (200, 201) then
      raise exception 'failed to copy application headshot (http %): %',
        v_resp ->> 'status', v_resp -> 'body';
    end if;

    v_src_images := array_append(v_src_images, v_app.headshot_path);
  end if;

  -- --- actors row -----------------------------------------------------------
  -- Column for column. `sewist` and `do_not_use_again` are left to their
  -- defaults: the intake form asks neither, and a new applicant is not
  -- do-not-use. `dog_owner` carries its answered value across; the tri-state is
  -- preserved by the column type rather than by a coalesce, so if a future
  -- import ever writes a NULL here it stays "never asked" on the roster instead
  -- of becoming "no".
  insert into actors (
    id, name, email, phone, gender, age_range, notes, dog_owner,
    kids_in_videos, social_url, additional_social_url, headshot_path, source
  )
  values (
    v_actor_id,
    v_app.name,
    v_app.email,
    v_app.phone,
    v_app.gender,
    v_app.age_range,
    v_app.notes,
    v_app.dog_owner,
    v_app.kids_in_videos,
    v_app.social_url,
    v_app.additional_social_url,
    v_headshot,
    'application'
  );

  -- --- videos ---------------------------------------------------------------
  -- sort_order carries across unchanged, so the order the applicant chose is
  -- the order the producer sees. Capped at 8 by actor_videos' own trigger
  -- (032), which the 1-8 limit on submit already respects.
  for v_video in
    select * from actor_application_videos
    where actor_application_videos.application_id
            = approve_actor_application.application_id
    order by sort_order
  loop
    v_dest := v_actor_id::text || '/video-'
           || regexp_replace(v_video.storage_path, '^.*/', '');

    v_resp := storage_admin_request('POST', '/object/copy', jsonb_build_object(
      'bucketId',          'actor-application-videos',
      'sourceKey',         v_video.storage_path,
      'destinationBucket', 'actor-videos',
      'destinationKey',    v_dest
    ));

    if (v_resp ->> 'status')::int not in (200, 201) then
      raise exception 'failed to copy application video % (http %): %',
        v_video.storage_path, v_resp ->> 'status', v_resp -> 'body';
    end if;

    v_src_videos := array_append(v_src_videos, v_video.storage_path);

    -- Posters are jpgs. They live in the application HEADSHOTS bucket on the
    -- way in (actor-application-videos' MIME allowlist would reject them) and
    -- land in `actor-videos` on the way out, which DOES allow image/jpeg (032)
    -- - that is the arrangement migration 026 had to add to `creator-videos`
    -- retroactively after every poster silently vanished for months.
    -- `buildThumbnailPath` puts a poster in the same bucket as its footage, so
    -- the destination has to be the video bucket, not the headshot one.
    v_thumb := null;
    if v_video.thumbnail_path is not null then
      v_thumb := v_actor_id::text || '/video-'
              || regexp_replace(v_video.thumbnail_path, '^.*/', '');

      v_resp := storage_admin_request('POST', '/object/copy', jsonb_build_object(
        'bucketId',          'actor-application-headshots',
        'sourceKey',         v_video.thumbnail_path,
        'destinationBucket', 'actor-videos',
        'destinationKey',    v_thumb
      ));

      if (v_resp ->> 'status')::int not in (200, 201) then
        raise exception 'failed to copy application video thumbnail % (http %): %',
          v_video.thumbnail_path, v_resp ->> 'status', v_resp -> 'body';
      end if;

      v_src_images := array_append(v_src_images, v_video.thumbnail_path);
    end if;

    insert into actor_videos (
      actor_id, storage_path, thumbnail_path, title,
      sort_order, size_bytes, mime_type
    )
    values (
      v_actor_id, v_dest, v_thumb, v_video.title,
      v_video.sort_order, v_video.size_bytes, v_video.mime_type
    );
  end loop;

  -- --- stamp the application ------------------------------------------------
  update actor_applications
  set status      = 'approved',
      reviewed_by = v_reviewer,
      reviewed_at = now(),
      updated_at  = now()
  where id = application_id;

  -- --- source cleanup (best effort) -----------------------------------------
  -- Deliberately does NOT raise on failure. By this point the authoritative
  -- state is already correct and the copies exist; a leftover source object is
  -- inert (private bucket, staff-read-only). Raising here would roll the whole
  -- approval back over a cleanup failure and, worse, could leave sources
  -- half-deleted against an application that is pending again - a state a retry
  -- could not recover from. Warnings land in the Postgres logs.
  if array_length(v_src_images, 1) is not null then
    v_resp := storage_admin_request(
      'DELETE', '/object/actor-application-headshots',
      jsonb_build_object('prefixes', to_jsonb(v_src_images))
    );
    if (v_resp ->> 'status')::int <> 200 then
      raise warning 'approve_actor_application %: could not remove source images (http %): %',
        application_id, v_resp ->> 'status', v_resp -> 'body';
    end if;
  end if;

  if array_length(v_src_videos, 1) is not null then
    v_resp := storage_admin_request(
      'DELETE', '/object/actor-application-videos',
      jsonb_build_object('prefixes', to_jsonb(v_src_videos))
    );
    if (v_resp ->> 'status')::int <> 200 then
      raise warning 'approve_actor_application %: could not remove source videos (http %): %',
        application_id, v_resp ->> 'status', v_resp -> 'body';
    end if;
  end if;

  return v_actor_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_application(application_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '90s'
AS $function$
declare
  v_app        creator_applications%rowtype;
  v_reviewer   uuid;
  v_creator_id uuid;
  v_headshot   text;
  v_video      record;
  v_dest       text;
  v_thumb      text;
  v_resp       jsonb;
  v_src_images text[] := '{}';
  v_src_videos text[] := '{}';
begin
  -- `and active` is load-bearing. Migration 007 made deactivation the way a
  -- staff member loses access (public.has_role(auth.uid(), 'builder'::public.app_role) checks it, and the frontend
  -- AuthGuard reads it off link_current_app_user), but clearing app_users.active
  -- does NOT delete the Supabase auth user - a deactivated employee can still
  -- sign in and still holds the `authenticated` role, which is all this grant
  -- requires. Without this clause they could keep approving applications:
  -- creating creators and moving and deleting storage objects after offboarding.
  -- `and role <> 'viewer'` is migration 016: a viewer previously could approve
  -- applications (create a creator, move media) exactly like a producer could -
  -- the role existed but was never enforced beyond public.has_role(auth.uid(), 'builder'::public.app_role). Producer
  -- and admin both still pass; only viewer is newly blocked.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only an active signed-in staff user can approve an application'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verdanote logins are a different pool from the old dashboard, so the
  -- reviewer row is found by email. reviewed_by stays null when the signed-in
  -- staff member has no copied app_users row.
  select au.id into v_reviewer
  from app_users au
  join auth.users u on lower(u.email) = lower(au.email)
  where u.id = auth.uid()
    and au.active;

  -- FOR UPDATE + the status guard together make a double-approve impossible:
  -- the second caller blocks until the first commits, then reads 'approved'
  -- and refuses. Without the lock both could read 'pending' and each create a
  -- creator.
  select * into v_app
  from creator_applications
  where id = application_id
  for update;

  if not found then
    raise exception 'application % not found', application_id
      using errcode = 'no_data_found';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'application % has already been % and cannot be approved',
      application_id, v_app.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Minted up front so destination paths can be built before the row exists.
  v_creator_id := gen_random_uuid();

  -- --- media: copy first, delete last ---------------------------------------
  -- HTTP calls are not transactional. Ordering every copy before every delete
  -- means the worst case is an orphaned duplicate in the destination bucket
  -- (harmless, private, staff-read-only) rather than a source object deleted
  -- against a copy that never landed.
  if v_app.headshot_path is not null then
    v_headshot := v_creator_id::text || '/headshot-'
               || regexp_replace(v_app.headshot_path, '^.*/', '');

    v_resp := storage_admin_request('POST', '/object/copy', jsonb_build_object(
      'bucketId',          'creator-application-headshots',
      'sourceKey',         v_app.headshot_path,
      'destinationBucket', 'creator-headshots',
      'destinationKey',    v_headshot
    ));

    if (v_resp ->> 'status')::int not in (200, 201) then
      raise exception 'failed to copy application headshot (http %): %',
        v_resp ->> 'status', v_resp -> 'body';
    end if;

    v_src_images := array_append(v_src_images, v_app.headshot_path);
  end if;

  -- --- creators row ---------------------------------------------------------
  -- `socials` has no home on creators (003). Folded into contact_notes rather
  -- than dropped: it is the field a producer reads when working out how to
  -- reach someone, so the handles stay useful there. Adding a socials column to
  -- creators would be a schema change outside this story.
  insert into dashboard_creators (
    id, name, email, website, gender, categories, age_range, location,
    shipping_address, contact_notes, alcohol_ok, cbd_ok, thc_ok,
    family_inclusive_ok, headshot_path, source
  )
  values (
    v_creator_id,
    v_app.name,
    v_app.email,
    v_app.website,
    v_app.gender,
    v_app.categories,
    v_app.age_range,
    v_app.location,
    v_app.shipping_address,
    case when v_app.socials is not null and v_app.socials <> 'null'::jsonb
         then 'Socials (from portal application): ' || v_app.socials::text end,
    v_app.alcohol_ok,
    v_app.cbd_ok,
    v_app.thc_ok,
    v_app.family_inclusive_ok,
    v_headshot,
    'application'
  );

  -- --- videos ---------------------------------------------------------------
  -- sort_order carries across unchanged, so the order the applicant chose is
  -- the order the producer sees. Capped at 8 by creator_videos' own trigger
  -- (008), which the 3-8 limit on submit already respects.
  for v_video in
    select * from application_videos
    where application_videos.application_id = approve_application.application_id
    order by sort_order
  loop
    v_dest := v_creator_id::text || '/video-'
           || regexp_replace(v_video.storage_path, '^.*/', '');

    v_resp := storage_admin_request('POST', '/object/copy', jsonb_build_object(
      'bucketId',          'creator-application-videos',
      'sourceKey',         v_video.storage_path,
      'destinationBucket', 'creator-videos',
      'destinationKey',    v_dest
    ));

    if (v_resp ->> 'status')::int not in (200, 201) then
      raise exception 'failed to copy application video % (http %): %',
        v_video.storage_path, v_resp ->> 'status', v_resp -> 'body';
    end if;

    v_src_videos := array_append(v_src_videos, v_video.storage_path);

    -- Thumbnails are jpgs and so live in the headshots (image) bucket on both
    -- sides - creator-videos' MIME allowlist would not accept them.
    v_thumb := null;
    if v_video.thumbnail_path is not null then
      v_thumb := v_creator_id::text || '/video-'
              || regexp_replace(v_video.thumbnail_path, '^.*/', '');

      v_resp := storage_admin_request('POST', '/object/copy', jsonb_build_object(
        'bucketId',          'creator-application-headshots',
        'sourceKey',         v_video.thumbnail_path,
        'destinationBucket', 'creator-headshots',
        'destinationKey',    v_thumb
      ));

      if (v_resp ->> 'status')::int not in (200, 201) then
        raise exception 'failed to copy application video thumbnail % (http %): %',
          v_video.thumbnail_path, v_resp ->> 'status', v_resp -> 'body';
      end if;

      v_src_images := array_append(v_src_images, v_video.thumbnail_path);
    end if;

    insert into creator_videos (
      creator_id, storage_path, thumbnail_path, title,
      sort_order, size_bytes, mime_type
    )
    values (
      v_creator_id, v_dest, v_thumb, v_video.title,
      v_video.sort_order, v_video.size_bytes, v_video.mime_type
    );
  end loop;

  -- --- stamp the application ------------------------------------------------
  update creator_applications
  set status      = 'approved',
      reviewed_by = v_reviewer,
      reviewed_at = now(),
      updated_at  = now()
  where id = application_id;

  -- --- source cleanup (best effort) -----------------------------------------
  -- Deliberately does NOT raise on failure. By this point the authoritative
  -- state is already correct and the copies exist; a leftover source object is
  -- inert (private bucket, staff-read-only). Raising here would roll the whole
  -- approval back over a cleanup failure and, worse, could leave sources
  -- half-deleted against an application that is pending again - a state a
  -- retry could not recover from. Warnings land in the Postgres logs.
  if array_length(v_src_images, 1) is not null then
    v_resp := storage_admin_request(
      'DELETE', '/object/creator-application-headshots',
      jsonb_build_object('prefixes', to_jsonb(v_src_images))
    );
    if (v_resp ->> 'status')::int <> 200 then
      raise warning 'approve_application %: could not remove source images (http %): %',
        application_id, v_resp ->> 'status', v_resp -> 'body';
    end if;
  end if;

  if array_length(v_src_videos, 1) is not null then
    v_resp := storage_admin_request(
      'DELETE', '/object/creator-application-videos',
      jsonb_build_object('prefixes', to_jsonb(v_src_videos))
    );
    if (v_resp ->> 'status')::int <> 200 then
      raise warning 'approve_application %: could not remove source videos (http %): %',
        application_id, v_resp ->> 'status', v_resp -> 'body';
    end if;
  end if;

  return v_creator_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_crew_member(p_id uuid, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row crew_members%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can change whether a crew member is active.'
      using errcode = '42501';
  end if;

  update crew_members
  set active     = coalesce(p_active, false),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Crew member not found.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cast_actor_onto_shoot(p_actor_id uuid, p_shoot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shoot shoots%rowtype;
  v_assignment_id uuid;
  v_row actor_assignments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can cast an actor onto a shoot.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_actor_id is null then
    raise exception 'p_actor_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_shoot_id is null then
    raise exception 'p_shoot_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_shoot from shoots where id = p_shoot_id;
  if not found then
    raise exception 'Shoot not found.'
      using errcode = 'no_data_found';
  end if;

  -- The actor has to be real. Without this the insert below would raise a raw
  -- foreign-key violation, which is not a message anybody can act on.
  if not exists (select 1 from actors where id = p_actor_id) then
    raise exception 'Actor not found.'
      using errcode = 'no_data_found';
  end if;

  -- FIND. Locked, because the confirm below reads what this returns and a
  -- concurrent cast of the same actor onto a different shoot would otherwise
  -- interleave between the two statements.
  select id into v_assignment_id
  from actor_assignments
  where actor_id = p_actor_id
    and client_slug = v_shoot.client_slug
  for update;

  -- OR CREATE, at 'booked' - see this migration's header for why not 'sourced'.
  if v_assignment_id is null then
    insert into actor_assignments (actor_id, client_slug, stage)
    values (p_actor_id, v_shoot.client_slug, 'booked')
    returning id into v_assignment_id;
  end if;

  -- CONFIRM - byte-for-byte the same three columns, from the same source, that
  -- `confirm_actor_for_shoot` (058) writes. The month grid, the day view, call
  -- sheets, the availability check and the Google Calendar sync all read
  -- `scheduled_shoot_date`/`shoot_location`, so the two paths MUST agree here;
  -- if one is ever changed, change the other in the same migration.
  -- `stage` is deliberately absent: an existing assignment keeps its own.
  update actor_assignments
  set shoot_id             = p_shoot_id,
      scheduled_shoot_date = v_shoot.shoot_date,
      shoot_location       = v_shoot.location,
      updated_at           = now()
  where id = v_assignment_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_actor_for_shoot(p_assignment_id uuid, p_shoot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment actor_assignments%rowtype;
  v_shoot shoots%rowtype;
  v_row actor_assignments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can confirm an actor for a shoot.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_assignment_id is null then
    raise exception 'p_assignment_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_shoot_id is null then
    raise exception 'p_shoot_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_assignment from actor_assignments where id = p_assignment_id;
  if not found then
    raise exception 'Casting assignment not found.'
      using errcode = 'no_data_found';
  end if;

  select * into v_shoot from shoots where id = p_shoot_id;
  if not found then
    raise exception 'Shoot not found.'
      using errcode = 'no_data_found';
  end if;

  -- Defense in depth - see header comment. Nothing in the UI can construct
  -- this call with a mismatched client (the "Add actor" picker only offers
  -- assignments for the shoot's own client_slug), but the function must not
  -- trust the caller.
  if v_assignment.client_slug <> v_shoot.client_slug then
    raise exception 'This actor''s client does not match the shoot''s client.'
      using errcode = 'invalid_parameter_value';
  end if;

  update actor_assignments
  set shoot_id             = p_shoot_id,
      scheduled_shoot_date = v_shoot.shoot_date,
      shoot_location       = v_shoot.location,
      updated_at           = now()
  where id = p_assignment_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

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
  -- before talent is. See this migration's header.

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

CREATE OR REPLACE FUNCTION public.create_client(p_slug text, p_name text, p_does_creators boolean, p_does_production boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_slug text;
  v_name text;
  v_creators boolean := coalesce(p_does_creators, false);
  v_production boolean := coalesce(p_does_production, false);
  v_row clients%rowtype;
begin
  -- 066: was public.has_role(auth.uid(), 'builder'::public.app_role). Adding a client is day-to-day production
  -- bookkeeping - the same act, and now the same gate, as adding a location, a
  -- prop, a crew member or a shoot. SECURITY DEFINER bypasses RLS entirely, so
  -- this in-body re-check is the whole authorisation; `clients` has no write
  -- policy to fall back on. Viewers and deactivated staff are still refused,
  -- with the same 42501 an admin-gated refusal used.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can add clients.'
      using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Client name is required.'
      using errcode = '22023';
  end if;

  -- Checked in the function as well as by the CHECK constraint, so the caller
  -- gets a sentence rather than a raw constraint violation naming an internal
  -- constraint. Both lines on is explicitly fine and is not checked for.
  if not (v_creators or v_production) then
    raise exception 'A client must be on at least one service line - creators, production, or both.'
      using errcode = '22023';
  end if;

  -- Slug validation is SERVER-SIDE and normalising, not merely rejecting: the
  -- slug is this table's primary key and the `client_slug` foreign key every
  -- assignment, deliverable and approval board hangs off, and it appears in URLs
  -- (`/clients/:slug`, `?brand=`). Lowercasing and trimming here means the
  -- browser's own normalisation is a courtesy rather than the enforcement,
  -- exactly like `canEdit`.
  v_slug := lower(btrim(coalesce(p_slug, '')));
  if v_slug = '' then
    raise exception 'Client slug is required.'
      using errcode = '22023';
  end if;

  if length(v_slug) > 64 then
    raise exception 'Client slug must be 64 characters or fewer.'
      using errcode = '22023';
  end if;

  -- Lowercase letters, digits, single hyphens between segments. No leading or
  -- trailing hyphen, no double hyphen, no underscore, no dot, no slash, no
  -- percent - anything that would have to be escaped in a URL or would read as a
  -- path segment is out.
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Client slug must be lowercase letters, numbers and single hyphens (for example "acme-foods").'
      using errcode = '22023';
  end if;

  -- Checked explicitly rather than left to the primary key, so the caller gets a
  -- sentence naming the conflict instead of a raw constraint violation naming an
  -- internal index. 23505 is the honest code for it either way.
  if exists (select 1 from clients where slug = v_slug) then
    raise exception 'A client with the slug "%" already exists.', v_slug
      using errcode = '23505';
  end if;

  insert into clients (slug, name, status, does_creators, does_production, origin)
  values (v_slug, v_name, 'active', v_creators, v_production, 'manual')
  returning * into v_row;

  -- A single JSON object (not an array), same shape as set_client_active's
  -- return: the frontend reads `.name` straight off it for its success toast.
  return jsonb_build_object(
    'slug', v_row.slug,
    'name', v_row.name,
    'status', v_row.status,
    'active', v_row.active,
    'does_creators', v_row.does_creators,
    'does_production', v_row.does_production,
    'origin', v_row.origin
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_crew_member(p_name text, p_role text, p_rate_notes text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_role text;
  v_row  crew_members%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can add crew members.'
      using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Crew member name is required.'
      using errcode = '22023';
  end if;

  v_role := btrim(coalesce(p_role, ''));
  if v_role = '' then
    raise exception 'Crew member role is required.'
      using errcode = '22023';
  end if;

  insert into crew_members (name, role, rate_notes, phone, email, notes)
  values (
    v_name,
    v_role,
    nullif(btrim(coalesce(p_rate_notes, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_location(p_name text, p_listing_url text DEFAULT NULL::text, p_rental_type text DEFAULT NULL::text, p_neighborhood text DEFAULT NULL::text, p_cost numeric DEFAULT NULL::numeric, p_cost_period text DEFAULT NULL::text, p_rooms text[] DEFAULT '{}'::text[], p_attributes text[] DEFAULT '{}'::text[], p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_cost_period text;
  v_row locations%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can add locations.'
      using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Location name is required.'
      using errcode = '22023';
  end if;

  v_cost_period := nullif(btrim(coalesce(p_cost_period, '')), '');
  if v_cost_period is not null and v_cost_period not in ('hourly', 'daily') then
    raise exception 'Cost period must be "hourly" or "daily".'
      using errcode = '22023';
  end if;

  if p_cost is not null and p_cost < 0 then
    raise exception 'Cost cannot be negative.'
      using errcode = '22023';
  end if;

  insert into locations (
    name, listing_url, rental_type, neighborhood, cost, cost_period,
    rooms, attributes, notes
  )
  values (
    v_name,
    nullif(btrim(coalesce(p_listing_url, '')), ''),
    nullif(btrim(coalesce(p_rental_type, '')), ''),
    nullif(btrim(coalesce(p_neighborhood, '')), ''),
    p_cost,
    v_cost_period,
    coalesce(p_rooms, '{}'),
    coalesce(p_attributes, '{}'),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_prop(p_name text, p_store text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric, p_return_status text DEFAULT NULL::text, p_client text DEFAULT NULL::text, p_at_studio boolean DEFAULT false, p_client_supplied boolean DEFAULT false, p_bin_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_return_status text;
  v_row props%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can add a prop.'
      using errcode = '42501';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'Prop name is required.'
      using errcode = '22023';
  end if;

  v_return_status := nullif(btrim(coalesce(p_return_status, '')), '');
  if v_return_status is not null
     and v_return_status not in ('Returned', 'Thrown away', 'Kept') then
    raise exception 'Status must be Returned, Thrown away, or Kept.'
      using errcode = '22023';
  end if;

  insert into props (
    name, store, price, return_status, client, at_studio, client_supplied,
    bin_number, notes
  )
  values (
    v_name,
    nullif(btrim(coalesce(p_store, '')), ''),
    p_price,
    v_return_status,
    nullif(btrim(coalesce(p_client, '')), ''),
    coalesce(p_at_studio, false),
    coalesce(p_client_supplied, false),
    nullif(btrim(coalesce(p_bin_number, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_shoot(p_client_slug text, p_shoot_date date, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_slug text;
  v_location    text;
  v_row shoots%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can schedule a shoot.'
      using errcode = '42501';
  end if;

  v_client_slug := btrim(coalesce(p_client_slug, ''));
  if v_client_slug = '' then
    raise exception 'A client is required.'
      using errcode = '22023';
  end if;

  if not exists (select 1 from clients where slug = v_client_slug) then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  if p_shoot_date is null then
    raise exception 'A shoot date is required.'
      using errcode = '22023';
  end if;

  -- THE PRECEDENCE RULE, IN ONE PLACE. A linked roster location WINS: its own
  -- `name` becomes `shoots.location`, so the single human-readable line every
  -- existing reader already uses (the calendar tile, `actor_assignments.
  -- shoot_location`, the HQ Google Calendar sync, `get_call_sheet`'s
  -- `shoot_location`) can never disagree with the link. With no link it is
  -- whatever was typed, exactly as before this migration.
  v_location := nullif(btrim(coalesce(p_location, '')), '');
  if p_location_id is not null then
    select l.name into v_location from locations l where l.id = p_location_id;
    if not found then
      raise exception 'Location not found.'
        using errcode = 'P0002';
    end if;
  end if;

  insert into shoots (client_slug, shoot_date, location, location_id, notes)
  values (
    v_client_slug,
    p_shoot_date,
    v_location,
    p_location_id,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_shoot_schedule_block(p_shoot_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_actor_assignment_ids uuid[] DEFAULT '{}'::uuid[], p_crew_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shoot shoots%rowtype;
  v_label text;
  v_row   shoot_schedule_blocks%rowtype;
  v_bad   bigint;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can add a schedule block.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_shoot_id is null then
    raise exception 'p_shoot_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  v_label := btrim(coalesce(p_label, ''));
  if v_label = '' then
    raise exception 'A block label is required.'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(v_label) > 120 then
    raise exception 'A block label must be 120 characters or fewer.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_start_time is null or p_end_time is null then
    raise exception 'A block needs both a start time and an end time.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'A block must end after it starts. A block that runs past midnight is entered as two blocks.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_shoot from shoots where id = p_shoot_id;
  if not found then
    raise exception 'Shoot not found.'
      using errcode = 'no_data_found';
  end if;

  insert into shoot_schedule_blocks (
    shoot_id, label, start_time, end_time, location, notes
  )
  values (
    p_shoot_id,
    v_label,
    p_start_time,
    p_end_time,
    nullif(btrim(coalesce(p_location, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  if p_actor_assignment_ids is not null
     and array_length(p_actor_assignment_ids, 1) > 0 then
    -- ONLY ACTORS CONFIRMED ONTO THIS SHOOT. Defence in depth - the UI only
    -- ever offers this shoot's confirmed cast - and the thing that makes a
    -- block's talent a subset of the call sheet's talent by construction.
    select count(*) into v_bad
    from unnest(p_actor_assignment_ids) as aid
    where not exists (
      select 1 from actor_assignments aa
      where aa.id = aid and aa.shoot_id = p_shoot_id
    );
    if v_bad > 0 then
      raise exception 'Only actors confirmed onto this shoot can be called for one of its blocks (% not confirmed).', v_bad
        using errcode = 'invalid_parameter_value';
    end if;

    insert into shoot_schedule_block_talent (block_id, actor_assignment_id)
    select v_row.id, aid
    from unnest(p_actor_assignment_ids) as aid
    on conflict do nothing;
  end if;

  -- NO "is this person on the call sheet" CHECK, and the header says why at
  -- length: a block may legitimately predate the sheet. The FK is the whole
  -- validation - a crew_members id that does not exist raises 23503 - and
  -- `get_call_sheet` is where the subset is enforced, at read time, where the
  -- sheet definitely exists.
  if p_crew_member_ids is not null
     and array_length(p_crew_member_ids, 1) > 0 then
    insert into shoot_schedule_block_crew (block_id, crew_member_id)
    select v_row.id, cid
    from unnest(p_crew_member_ids) as cid
    on conflict do nothing;
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_studio_shipment(p_client_slug text, p_description text, p_carrier text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text, p_shipped_at date DEFAULT NULL::date, p_expected_delivery_at date DEFAULT NULL::date, p_delivered_at date DEFAULT NULL::date, p_delivery_notes text DEFAULT NULL::text, p_actor_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_description text;
  v_carrier text;
  v_tracking_number text;
  v_delivery_notes text;
  v_row studio_shipments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can add shipments.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from clients where slug = p_client_slug) then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  -- Fold an all-whitespace box to NULL, like set_client_details (038) and
  -- set_creator_assignment_delivery (044) - a column holding ' ' renders as a
  -- blank nothing distinguishes from empty.
  v_description := btrim(coalesce(p_description, ''));
  if v_description = '' then
    raise exception 'A description of what is in the shipment is required.'
      using errcode = '22023';
  end if;
  if length(v_description) > 300 then
    raise exception 'Description must be 300 characters or fewer.'
      using errcode = '22023';
  end if;

  v_carrier := nullif(btrim(coalesce(p_carrier, '')), '');
  if length(v_carrier) > 100 then
    raise exception 'Carrier must be 100 characters or fewer.'
      using errcode = '22023';
  end if;

  -- Same 100-character bound `set_creator_assignment_delivery` (044) puts on
  -- the creator lane's tracking number, so one page can render both lanes'
  -- values in one column without one of them overflowing.
  v_tracking_number := nullif(btrim(coalesce(p_tracking_number, '')), '');
  if length(v_tracking_number) > 100 then
    raise exception 'Tracking number must be 100 characters or fewer.'
      using errcode = '22023';
  end if;

  v_delivery_notes := nullif(btrim(coalesce(p_delivery_notes, '')), '');
  if length(v_delivery_notes) > 2000 then
    raise exception 'Delivery notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  -- The shoot link, when given, must belong to the SAME client. Without this
  -- a shipment for brand A could be filed against brand B's shoot, and the
  -- page would show a producer a box arriving for a shoot it has nothing to
  -- do with. The same class of check as `ca.client_slug = b.client_slug` on
  -- the approval boards, written here as an existence test because this is a
  -- staff RPC, not an anon-callable one.
  if p_actor_assignment_id is not null
     and not exists (
       select 1 from actor_assignments
       where id = p_actor_assignment_id
         and client_slug = p_client_slug
     ) then
    raise exception 'That shoot does not belong to this client.'
      using errcode = '22023';
  end if;

  insert into studio_shipments (
    client_slug,
    actor_assignment_id,
    description,
    carrier,
    tracking_number,
    shipped_at,
    expected_delivery_at,
    delivered_at,
    delivery_notes
  )
  values (
    p_client_slug,
    p_actor_assignment_id,
    v_description,
    v_carrier,
    v_tracking_number,
    p_shipped_at,
    p_expected_delivery_at,
    p_delivered_at,
    v_delivery_notes
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.creator_assignment_stage_follow_up()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_stage_changed boolean;
  v_date_written boolean;
  v_source_named boolean;
  v_offset integer;
  v_changed_on date;
begin
  if tg_op = 'INSERT' then
    v_stage_changed := true;
    v_date_written := new.next_follow_up_at is not null;
    v_source_named := new.next_follow_up_source is not null;
  else
    v_stage_changed := new.stage is distinct from old.stage;
    v_date_written := new.next_follow_up_at is distinct from old.next_follow_up_at;
    v_source_named := new.next_follow_up_source is distinct from old.next_follow_up_source;
  end if;

  -- STEP 1 - stage-entry tracking. The trigger owns this column OUTRIGHT: on a
  -- stage change it stamps now(), and on any other update it restores the old
  -- value. A caller therefore cannot forget to set it (the whole reason this is
  -- a trigger and not an RPC) and equally cannot forge it. `stage` and
  -- `stage_changed_at` are physically incapable of disagreeing after this.
  if v_stage_changed then
    new.stage_changed_at := now();
  elsif tg_op = 'UPDATE' then
    new.stage_changed_at := old.stage_changed_at;
  end if;

  -- STEP 2 - provenance of a date this statement wrote ITSELF.
  --
  -- If `next_follow_up_at` changed and the writer did NOT also name a source,
  -- a human wrote it: the card's date input, the queue's date input, or a
  -- snooze button. All of those are plain `.update()`s that send the date and
  -- nothing else, so "the date moved but the source did not" is precisely the
  -- signature of a manual write.
  --
  -- `set_creator_assignment_delivery` (044, replaced below) is the ONE writer
  -- that names its own source, and step 2 passes its 'delivery' straight
  -- through untouched. That is the whole mechanism by which 044 keeps behaving
  -- exactly as it did before this migration.
  --
  -- Clearing the date clears the source with it: a null date has no author.
  if v_date_written and not v_source_named then
    if new.next_follow_up_at is null then
      new.next_follow_up_source := null;
    else
      new.next_follow_up_source := 'manual';
    end if;
  end if;

  -- STEP 3 - the stage rule. Fires ONLY on an actual stage change, which is
  -- what makes a cleared date STAY cleared: emptying the box is not a stage
  -- change, so nothing re-applies. The next genuine stage entry is a new event
  -- and does generate a new task, which is the behaviour the owner asked for.
  if v_stage_changed then
    v_offset := stage_follow_up_offset_days(new.stage);
    v_changed_on := (new.stage_changed_at at time zone 'utc')::date;

    if v_offset is not null
      and v_changed_on is not null
      and (
        -- THE PRECEDENCE RULE, in one predicate: fill an empty date, or
        -- replace one an earlier stage rule put there. A 'manual' date, a
        -- 'delivery' date and a NULL-provenance date all fail this and are
        -- left exactly as they are.
        new.next_follow_up_at is null
        or new.next_follow_up_source is not distinct from 'stage_rule'
      )
    then
      new.next_follow_up_at := v_changed_on + v_offset;
      new.next_follow_up_source := 'stage_rule';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_location(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name  text;
  v_paths text[];
  v_resp  jsonb;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can delete locations.'
      using errcode = '42501';
  end if;

  select name into v_name from locations where id = p_id;
  if v_name is null then
    raise exception 'Location not found.'
      using errcode = 'P0002';
  end if;

  select coalesce(array_agg(storage_path), '{}')
  into v_paths
  from location_photos
  where location_id = p_id;

  if array_length(v_paths, 1) is not null then
    v_resp := storage_admin_request(
      'DELETE', '/object/location-photos',
      jsonb_build_object('prefixes', to_jsonb(v_paths))
    );
    if (v_resp ->> 'status')::int <> 200 then
      raise exception 'Could not delete this location''s photos (http %): %',
        v_resp ->> 'status', v_resp -> 'body';
    end if;
  end if;

  -- Cascades to location_photos rows.
  delete from locations where id = p_id;

  return jsonb_build_object('id', p_id, 'name', v_name);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_prop(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can delete props.'
      using errcode = '42501';
  end if;

  select name into v_name from props where id = p_id;
  if v_name is null then
    raise exception 'Prop not found.'
      using errcode = 'P0002';
  end if;

  delete from props where id = p_id;

  return jsonb_build_object('id', p_id, 'name', v_name);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_shoot(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row shoots%rowtype;
  v_confirmed_count int;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can delete a shoot.'
      using errcode = '42501';
  end if;

  select * into v_row from shoots where id = p_id;
  if not found then
    raise exception 'Shoot not found.'
      using errcode = 'P0002';
  end if;

  -- Friendly refusal before the FK (actor_assignments.shoot_id has no `on
  -- delete` action) raises a raw violation - see header comment. A producer
  -- must remove/reassign confirmed actors before a shoot record can go away,
  -- rather than have them silently un-confirmed by a cascade.
  select count(*) into v_confirmed_count
  from actor_assignments
  where shoot_id = p_id;

  if v_confirmed_count > 0 then
    raise exception 'This shoot still has % confirmed actor(s) - remove them before deleting it.', v_confirmed_count
      using errcode = '22023';
  end if;

  delete from shoots where id = p_id;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_shoot_schedule_block(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row shoot_schedule_blocks%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can delete a schedule block.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_id is null then
    raise exception 'p_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- No refusal for a block that has talent on it, unlike `delete_shoot`'s
  -- confirmed-actor refusal (058): removing a block does not un-cast anybody,
  -- it only says they are no longer called for that slice of the day. The
  -- join rows cascade.
  delete from shoot_schedule_blocks where id = p_id returning * into v_row;

  if not found then
    raise exception 'Schedule block not found.'
      using errcode = 'no_data_found';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_studio_shipment(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_description text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can delete shipments.'
      using errcode = '42501';
  end if;

  select description into v_description from studio_shipments where id = p_id;
  if v_description is null then
    raise exception 'Shipment not found.'
      using errcode = 'P0002';
  end if;

  delete from studio_shipments where id = p_id;

  return jsonb_build_object('id', p_id, 'description', v_description);
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_actor_application_video_cap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_count int;
begin
  -- Serialises concurrent inserts for one application so two transactions
  -- cannot each read count() = 7 and both commit a 9th row. Two-int form;
  -- hashtext() returns integer, so both args land on that overload.
  perform pg_advisory_xact_lock(
    hashtext('public.actor_application_videos'),
    hashtext(NEW.application_id::text)
  );

  select count(*) into v_count
  from actor_application_videos
  where application_id = NEW.application_id;

  if v_count >= 8 then
    raise exception
      'actor application % already has % videos (limit is 8)',
      NEW.application_id, v_count
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_actor_photo_cap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_count int;
begin
  -- The advisory lock serialises concurrent inserts for the same actor so two
  -- transactions cannot each read count() = 7 and both commit a 9th row.
  -- Two-int form: pg_advisory_xact_lock(int, int). hashtext() returns integer,
  -- so both args land on that overload. First arg namespaces the lock to this
  -- table, second keys it to the actor, so it never blocks another actor's
  -- inserts and never touches the actors row itself.
  perform pg_advisory_xact_lock(
    hashtext('public.actor_photos'),
    hashtext(NEW.actor_id::text)
  );

  select count(*) into v_count
  from actor_photos
  where actor_id = NEW.actor_id;

  if v_count >= 8 then
    raise exception
      'actor % already has % gallery photos (limit is 8)',
      NEW.actor_id, v_count
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_actor_video_cap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_count int;
begin
  -- The advisory lock serialises concurrent inserts for the same actor so two
  -- transactions cannot each read count() = 7 and both commit a 9th row.
  -- Two-int form: pg_advisory_xact_lock(int, int). hashtext() returns integer,
  -- so both args land on that overload. First arg namespaces the lock to this
  -- table, second keys it to the actor, so it never blocks another actor's
  -- inserts and never touches the actors row itself.
  perform pg_advisory_xact_lock(
    hashtext('public.actor_videos'),
    hashtext(NEW.actor_id::text)
  );

  select count(*) into v_count
  from actor_videos
  where actor_id = NEW.actor_id;

  if v_count >= 8 then
    raise exception
      'actor % already has % reel videos (limit is 8)',
      NEW.actor_id, v_count
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_application_video_cap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(
    hashtext('public.application_videos'),
    hashtext(NEW.application_id::text)
  );

  select count(*) into v_count
  from application_videos
  where application_id = NEW.application_id;

  if v_count >= 10 then
    raise exception
      'application % already has % portfolio videos (limit is 10)',
      NEW.application_id, v_count
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_creator_video_cap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_count int;
begin
  -- Two-int form: pg_advisory_xact_lock(int, int). hashtext() returns integer,
  -- so both args land on that overload. (There is no (bigint, int) overload -
  -- only (bigint) and (int, int).) First arg namespaces the lock to this
  -- table, second keys it to the creator.
  perform pg_advisory_xact_lock(
    hashtext('public.creator_videos'),
    hashtext(NEW.creator_id::text)
  );

  select count(*) into v_count
  from creator_videos
  where creator_id = NEW.creator_id;

  if v_count >= 10 then
    raise exception
      'creator % already has % portfolio videos (limit is 10)',
      NEW.creator_id, v_count
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_actor_application(application_id uuid, reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_app      actor_applications%rowtype;
  v_reviewer uuid;
  v_reason   text;
begin
  -- Required, not optional: a bare rejection with no reason gives the next
  -- reviewer looking at the row nothing to act on. Checked before reviewer
  -- resolution so a malformed call fails on the cheap check first.
  v_reason := btrim(coalesce(reason, ''));

  if v_reason = '' then
    raise exception 'a rejection reason is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only an active signed-in staff user can reject an application'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verdanote logins are a different pool from the old dashboard, so the
  -- reviewer row is found by email. reviewed_by stays null when the signed-in
  -- staff member has no copied app_users row.
  select au.id into v_reviewer
  from app_users au
  join auth.users u on lower(u.email) = lower(au.email)
  where u.id = auth.uid()
    and au.active;

  -- See approve_actor_application: SECURITY DEFINER bypasses RLS, so 016's
  -- viewer restriction has to be an in-function check.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'viewers cannot reject applications'
      using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE + the status guard together make a double-reject (and a
  -- reject-after-approve) impossible: the second caller blocks until the first
  -- commits, then reads the settled status and refuses.
  select * into v_app
  from actor_applications
  where id = application_id
  for update;

  if not found then
    raise exception 'application % not found', application_id
      using errcode = 'no_data_found';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'application % has already been % and cannot be rejected',
      application_id, v_app.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update actor_applications
  set status       = 'rejected',
      reviewed_by  = v_reviewer,
      reviewed_at  = now(),
      review_notes = v_reason,
      updated_at   = now()
  where id = application_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_application(application_id uuid, reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_app      creator_applications%rowtype;
  v_reviewer uuid;
  v_reason   text;
begin
  -- Required, not optional: a bare rejection with no reason gives the
  -- applicant (and the next reviewer looking at the row) nothing to act on.
  -- Checked before reviewer resolution so a malformed call fails on the cheap
  -- check first rather than after touching app_users.
  v_reason := btrim(coalesce(reason, ''));

  if v_reason = '' then
    raise exception 'a rejection reason is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Same as approve_application: the reviewer is resolved server-side from
  -- auth.uid() and is never a parameter, and `and active` is load-bearing -
  -- a deactivated staff member still holds the `authenticated` role and must
  -- not be able to reject applications after offboarding. `and role <>
  -- 'viewer'` is migration 016 - see approve_application for the rationale.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only an active signed-in staff user can reject an application'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verdanote logins are a different pool from the old dashboard, so the
  -- reviewer row is found by email. reviewed_by stays null when the signed-in
  -- staff member has no copied app_users row.
  select au.id into v_reviewer
  from app_users au
  join auth.users u on lower(u.email) = lower(au.email)
  where u.id = auth.uid()
    and au.active;

  -- FOR UPDATE + the status guard together make a double-reject (and a
  -- reject-after-approve) impossible: the second caller blocks until the
  -- first commits, then reads the settled status and refuses.
  select * into v_app
  from creator_applications
  where id = application_id
  for update;

  if not found then
    raise exception 'application % not found', application_id
      using errcode = 'no_data_found';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'application % has already been % and cannot be rejected',
      application_id, v_app.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update creator_applications
  set status       = 'rejected',
      reviewed_by  = v_reviewer,
      reviewed_at  = now(),
      review_notes = v_reason,
      updated_at   = now()
  where id = application_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_call_sheet(p_id uuid, p_revoked boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row call_sheets%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can change whether a call sheet is revoked.'
      using errcode = 'insufficient_privilege';
  end if;

  update call_sheets
  set revoked    = coalesce(p_revoked, true),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Call sheet not found.'
      using errcode = 'no_data_found';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_actor_shoot_schedule(p_assignment_id uuid, p_scheduled_shoot_date date, p_shoot_location text DEFAULT NULL::text)
 RETURNS actor_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row actor_assignments%rowtype;
  v_location text;
begin
  -- SECURITY DEFINER bypasses actor_assignments' RLS entirely, which also
  -- means the deactivation and viewer-role checks on that table's write
  -- policy never run for this call. Re-check explicitly, same predicate and
  -- same SQLSTATE as 036's apply_actor_approval_votes.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can schedule a shoot.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_assignment_id is null then
    raise exception 'p_assignment_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Same normalisation discipline as every courtesy/free-text field already in
  -- this schema (028/036's voted_by): trim, and an empty string becomes NULL
  -- rather than an empty-string row that reads as "has a location" everywhere
  -- that checks `is not null`.
  v_location := nullif(btrim(coalesce(p_shoot_location, '')), '');

  -- Setting AND clearing are the same statement, on purpose (the owner asked
  -- for one RPC that does both): passing null for the date and/or the
  -- location writes null, which is exactly how a producer un-schedules a
  -- shoot or removes a location without touching the other field.
  --
  -- ADDED BY 059 - the shoot_id line below, and nothing else in this
  -- function. Clearing the date must clear shoot_id in the SAME statement, or
  -- the row is left with shoot_id non-null and scheduled_shoot_date null: a
  -- state that drops out of useProductionShoots, takes its own unconfirm
  -- control off the screen with it, and blocks delete_shoot forever. Setting
  -- a NON-null date leaves shoot_id exactly as it was - editing a confirmed
  -- actor's own date is still allowed and still keeps them on their shoot,
  -- which is the pre-existing behaviour this migration deliberately preserves.
  update actor_assignments
  set scheduled_shoot_date = p_scheduled_shoot_date,
      shoot_location = v_location,
      shoot_id = case
                   when p_scheduled_shoot_date is null then null
                   else shoot_id
                 end,
      updated_at = now()
  where id = p_assignment_id
  returning * into v_row;

  if not found then
    raise exception 'Casting assignment not found.'
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_client_active(p_slug text, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row clients%rowtype;
begin
  -- Reuse migration 007's helper rather than re-deriving admin-ness here, so
  -- there is one definition of "active admin" across the schema.
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'Only admins can change which clients are active.'
      using errcode = '42501';
  end if;

  -- Writes `active` and `updated_at` ONLY. `status` is untouched by design.
  update clients
  set active = p_active,
      updated_at = now()
  where slug = p_slug
  returning * into v_row;

  if not found then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  -- A single JSON object (not an array) - the frontend reads `.name` straight
  -- off the result for its success toast, so `name` must be present. `status`
  -- rides along so the caller can see it did not change.
  return jsonb_build_object(
    'slug', v_row.slug,
    'name', v_row.name,
    'status', v_row.status,
    'active', v_row.active
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_client_details(p_slug text, p_service_type text DEFAULT NULL::text, p_strategist text DEFAULT NULL::text, p_contract_start date DEFAULT NULL::date, p_contract_end date DEFAULT NULL::date, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing clients%rowtype;
  v_service_type text;
  v_strategist text;
  v_status text;
  v_row clients%rowtype;
begin
  -- Migration 007's helper, reused rather than re-derived, so there is one
  -- definition of "active admin" across the schema. Same SQLSTATE and the same
  -- message shape as `set_client_active`'s. SECURITY DEFINER bypasses RLS, so
  -- this check is the enforcement and the frontend's `canEdit` is a courtesy.
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'Only admins can edit client details.'
      using errcode = '42501';
  end if;

  select * into v_existing from clients where slug = p_slug;
  if not found then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  -- THE ORIGIN GATE. Refused for the WHOLE call rather than per parameter,
  -- because every parameter this function has is a column `dashboard-sync`
  -- writes. There is no partially-legal version of this call on a synced row.
  -- Same SQLSTATE and the same "say where the value actually comes from" shape
  -- as `update_client`'s name refusal.
  if v_existing.origin <> 'manual' then
    raise exception 'This client is synced from Coda - change its service type, strategist, contract dates and status in the client knowledge file, not here.'
      using errcode = '22023';
  end if;

  -- Trim, and fold an all-whitespace box to NULL. A column holding ' ' renders
  -- as a blank the page cannot tell from empty and that no filter matches; the
  -- honest storage for "the admin cleared this" is null.
  v_service_type := nullif(btrim(coalesce(p_service_type, '')), '');
  v_strategist := nullif(btrim(coalesce(p_strategist, '')), '');

  -- Bounded because they are free text on a row that appears in every picker.
  -- 120 is generous against the live values ("Performance Creative" is 20
  -- characters, the longest strategist name is 17) and short enough that a
  -- pasted paragraph is refused with a sentence rather than stored.
  if length(v_service_type) > 120 then
    raise exception 'Service type must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(v_strategist) > 120 then
    raise exception 'Strategist must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  -- Null = leave the stored value alone, because `clients.status` is NOT NULL
  -- and has no empty state. Unlike the four columns above, this one cannot be
  -- cleared, only changed.
  if p_status is not null then
    v_status := btrim(p_status);
    if v_status not in ('active', 'draft', 'ending / transitioning', 'inactive / completed') then
      raise exception 'Status must be one of: active, draft, ending / transitioning, inactive / completed.'
        using errcode = '22023';
    end if;
  end if;

  -- Both dates supplied and the wrong way round is a typo, not a state. Checked
  -- against the OUTCOME (the two values this write is about to store), the same
  -- way `update_client` checks at-least-one-line against the outcome rather
  -- than against the parameters. Either date alone is fine - an open-ended
  -- retainer with a start and no end is the ordinary case on this table, and
  -- eight of the thirteen live rows look exactly like that.
  if p_contract_start is not null
     and p_contract_end is not null
     and p_contract_end < p_contract_start then
    raise exception 'Contract end cannot be before contract start.'
      using errcode = '22023';
  end if;

  -- The four nullable columns are written verbatim: this is an absolute write,
  -- so a null argument clears the column. `status` falls back to its stored
  -- value. `pct_complete`, `last_synced`, `active`, `origin`, `name`, `slug`,
  -- `does_creators`, `does_production`, `notes`, `month` and
  -- `verdanote_account_id` are not in this statement and must not be added to
  -- it - each is owned somewhere else, and the short column list is the whole
  -- reason this is a function rather than an RLS policy.
  update clients
  set service_type = v_service_type,
      strategist = v_strategist,
      contract_start = p_contract_start,
      contract_end = p_contract_end,
      status = coalesce(v_status, status),
      updated_at = now()
  where slug = p_slug
  returning * into v_row;

  -- A single JSON object, not an array - the same shape `set_client_active`,
  -- `create_client` and `update_client` all return, so the frontend reads
  -- `.name` straight off it for its success toast. The five written columns are
  -- echoed back so the form can re-sync its drafts from the server's own
  -- normalisation rather than from what it hoped it sent.
  return jsonb_build_object(
    'slug', v_row.slug,
    'name', v_row.name,
    'origin', v_row.origin,
    'status', v_row.status,
    'service_type', v_row.service_type,
    'strategist', v_row.strategist,
    'contract_start', v_row.contract_start,
    'contract_end', v_row.contract_end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_client_scope(p_slug text, p_scope text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope text;
  v_row clients%rowtype;
begin
  -- Same helper, same SQLSTATE, same message shape as every other writer on
  -- this table. SECURITY DEFINER bypasses RLS, so this check is the
  -- enforcement and the frontend's `canEdit` is a courtesy.
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'Only admins can edit a client''s scope.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from clients where slug = p_slug) then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  -- Deliberately NO origin check here - see the header comment. `scope` is
  -- not now, and must not become without adding it to `dashboard-sync`'s
  -- `ALLOWED_CLIENT_FIELDS` on the same day, a column any sync writer owns.
  -- Editable on a `coda` row exactly as freely as on a `manual` one.

  -- Trim, and fold an all-whitespace box to NULL - a column holding ' ' would
  -- render as a blank the page cannot tell from empty. Same idiom `038` uses
  -- for `service_type` / `strategist`.
  v_scope := nullif(btrim(coalesce(p_scope, '')), '');

  -- 240 is double `038`'s 120-character bound on `service_type` /
  -- `strategist`: a scope note routinely lists more than one line item ("2 UGC
  -- videos + 1 photoshoot, plus a quarterly whitepaper"), so it needs more
  -- room than a single job title, but it is still a quick-glance note, not a
  -- contract body - long enough for a real answer, short enough that a pasted
  -- paragraph is refused with a sentence instead of silently accepted.
  if length(v_scope) > 240 then
    raise exception 'Scope must be 240 characters or fewer.'
      using errcode = '22023';
  end if;

  -- Absolute write: null clears the column, matching `set_client_details`'
  -- convention for its own nullable columns and for the identical reason - a
  -- box that cannot be emptied again turns a typo into a permanent one.
  update clients
  set scope = v_scope,
      updated_at = now()
  where slug = p_slug
  returning * into v_row;

  -- Same single-JSON-object shape every writer on this table returns, so the
  -- frontend reads `.name` off it for a toast without special-casing this RPC.
  -- `origin` is deliberately NOT echoed back - this function's body has
  -- nothing to do with origin at all, and returning it would be the one word
  -- "origin" appearing in a function whose whole point is that it does not
  -- gate on it.
  return jsonb_build_object(
    'slug', v_row.slug,
    'name', v_row.name,
    'scope', v_row.scope
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_client_verdanote_account_id(p_slug text, p_account_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row clients%rowtype;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'Only admins can change a client''s Verdanote account link.'
      using errcode = '42501';
  end if;

  if p_account_id is not null and p_account_id !~ '^act_[0-9]+$' then
    raise exception 'Verdanote account id must look like "act_<digits>" (or be left blank to unlink).'
      using errcode = '22023';
  end if;

  update clients
  set verdanote_account_id = p_account_id,
      updated_at = now()
  where slug = p_slug
  returning * into v_row;

  if not found then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'slug', v_row.slug,
    'name', v_row.name,
    'verdanote_account_id', v_row.verdanote_account_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_creator_assignment_delivery(p_assignment_id uuid, p_tracking_number text DEFAULT NULL::text, p_product_delivered_at date DEFAULT NULL::date, p_delivery_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tracking_number text;
  v_delivery_notes text;
  v_next_follow_up_at date;
  v_next_follow_up_source text;
  v_existing_delivered_at date;
  v_existing_follow_up_at date;
  v_existing_follow_up_source text;
  v_row creator_assignments%rowtype;
begin
  -- SECURITY DEFINER bypasses creator_assignments' RLS entirely, so the
  -- existing "authenticated write all creator_assignments" policy's
  -- (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) check (016) never runs for this call. Re-checked
  -- explicitly here, same SQLSTATE and message shape as every other RPC that
  -- bypasses that policy (apply_approval_votes, create_prop, ...).
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can update tracking and delivery.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from creator_assignments where id = p_assignment_id) then
    raise exception 'Assignment not found.'
      using errcode = 'P0002';
  end if;

  -- Fold an all-whitespace box to NULL, like set_client_details (038) - a
  -- column holding ' ' renders as a blank nothing distinguishes from empty.
  v_tracking_number := nullif(btrim(coalesce(p_tracking_number, '')), '');
  v_delivery_notes := nullif(btrim(coalesce(p_delivery_notes, '')), '');

  if length(v_tracking_number) > 100 then
    raise exception 'Tracking number must be 100 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(v_delivery_notes) > 2000 then
    raise exception 'Delivery notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  -- THE CORRECTNESS PROPERTY: the follow-up fires off product_delivered_at
  -- BEING SET, by whatever means set it. Both UI paths - a typed-in date
  -- after a tracking lookup, and the one-click "mark delivered today" quick
  -- action for a creator self-report - call this same function with a
  -- non-null p_product_delivered_at, so both land on the identical formula
  -- below.
  --
  -- 054: the provenance is decided by the SAME condition, in the same
  -- if/else, so the date and the label it carries cannot drift apart. Naming
  -- the source here is also what tells 054's trigger to leave this write
  -- alone rather than relabelling it 'manual'.
  --
  -- 055 SPLITS THE OLD `else` IN TWO. A null p_product_delivered_at used to
  -- mean one thing; it actually means two, and only one of them is this
  -- function's business. Read the row's current state first, under a row
  -- lock - the lock is what closes the read-then-write window this read
  -- opens, so a concurrent call cannot commit a delivery date between the
  -- select and the update and have the preserve branch write a stale value
  -- back over it.
  select product_delivered_at, next_follow_up_at, next_follow_up_source
    into v_existing_delivered_at, v_existing_follow_up_at, v_existing_follow_up_source
  from creator_assignments
  where id = p_assignment_id
  for update;

  if p_product_delivered_at is not null then
    -- CASE 1 - a delivery date is being SET. 044's formula, 054's label,
    -- both unchanged.
    v_next_follow_up_at := p_product_delivered_at + 5;
    v_next_follow_up_source := 'delivery';
  elsif v_existing_delivered_at is not null then
    -- CASE 2 - a delivery date that WAS there is being CLEARED. 044's
    -- deliberate, documented behaviour, kept exactly: the derived date goes
    -- with the delivery that justified it rather than sitting on the board
    -- implying a delivery with no date behind it. The source goes too - a
    -- null date has no author, which is the same rule 054's trigger applies.
    v_next_follow_up_at := null;
    v_next_follow_up_source := null;
  else
    -- CASE 3 - THE BUG THIS MIGRATION EXISTS FOR. There was no delivery date
    -- before and there is none now, so there is NO delivery-derived value
    -- here to clear: whatever `next_follow_up_at` holds is a human's own
    -- choice and none of this function's business. Write both columns back
    -- unchanged, so the row is `is distinct from` itself in neither - which
    -- is also precisely what stops 054's trigger firing on them (its step 2
    -- keys on the date having CHANGED) and what stops a hand-typed date
    -- being relabelled 'delivery'. Mislabelling would be worse than the
    -- erase it replaces: 054's precedence rule reads that label to decide
    -- what the stage rule may overwrite.
    v_next_follow_up_at := v_existing_follow_up_at;
    v_next_follow_up_source := v_existing_follow_up_source;
  end if;

  update creator_assignments
  set tracking_number = v_tracking_number,
      product_delivered_at = p_product_delivered_at,
      delivery_notes = v_delivery_notes,
      next_follow_up_at = v_next_follow_up_at,
      next_follow_up_source = v_next_follow_up_source,
      updated_at = now()
  where id = p_assignment_id
  returning * into v_row;

  -- A single JSON object, echoing back the server's own normalisation
  -- (trimmed, all-whitespace folded to null, the derived follow-up date) -
  -- the same shape set_client_details/create_prop/update_prop return.
  return jsonb_build_object(
    'id', v_row.id,
    'tracking_number', v_row.tracking_number,
    'product_delivered_at', v_row.product_delivered_at,
    'delivery_notes', v_row.delivery_notes,
    'next_follow_up_at', v_row.next_follow_up_at,
    'next_follow_up_source', v_row.next_follow_up_source
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_location_capacity(p_id uuid, p_bedrooms integer DEFAULT NULL::integer, p_bathrooms numeric DEFAULT NULL::numeric, p_max_guests integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row locations%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can change a location.'
      using errcode = '42501';
  end if;

  if p_bedrooms is not null and p_bedrooms < 0 then
    raise exception 'Bedrooms cannot be negative.' using errcode = '22023';
  end if;
  if p_bathrooms is not null and p_bathrooms < 0 then
    raise exception 'Bathrooms cannot be negative.' using errcode = '22023';
  end if;
  if p_max_guests is not null and p_max_guests < 0 then
    raise exception 'Guests cannot be negative.' using errcode = '22023';
  end if;

  -- ABSOLUTE write - a null clears. See this migration's header.
  update locations
  set bedrooms   = p_bedrooms,
      bathrooms  = p_bathrooms,
      max_guests = p_max_guests,
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_location_entry_instructions(p_id uuid, p_entry_instructions text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row locations%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can change a location.'
      using errcode = '42501';
  end if;

  -- ABSOLUTE write - a null clears, and so does a blank box. Trimmed so a
  -- stray space does not count as "recorded".
  update locations
  set entry_instructions = nullif(btrim(p_entry_instructions), ''),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_prop_at_studio(p_id uuid, p_at_studio boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row props%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can change whether a prop is at the studio.'
      using errcode = '42501';
  end if;

  update props
  set at_studio = coalesce(p_at_studio, false),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Prop not found.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_prop_client_supplied(p_id uuid, p_client_supplied boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row props%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can change whether a prop was client-supplied.'
      using errcode = '42501';
  end if;

  update props
  set client_supplied = coalesce(p_client_supplied, false),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Prop not found.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_prop_return_status(p_id uuid, p_return_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_return_status text;
  v_row props%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can change a prop''s status.'
      using errcode = '42501';
  end if;

  v_return_status := nullif(btrim(coalesce(p_return_status, '')), '');
  if v_return_status is not null
     and v_return_status not in ('Returned', 'Thrown away', 'Kept') then
    raise exception 'Status must be Returned, Thrown away, or Kept.'
      using errcode = '22023';
  end if;

  update props
  set return_status = v_return_status,
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Prop not found.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_studio_shipment_delivered(p_id uuid, p_delivered_at date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row studio_shipments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can change whether a shipment has been delivered.'
      using errcode = '42501';
  end if;

  -- No derived follow-up date is computed here, and that is deliberate - see
  -- the header's "THERE IS NO +5-DAY DERIVATION ON THIS LANE" section. The
  -- creator lane's `set_creator_assignment_delivery` (044) does derive one,
  -- because on that lane somebody owes footage; here nobody does.
  update studio_shipments
  set delivered_at = p_delivered_at,
      updated_at   = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Shipment not found.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_studio_shipment_notes(p_id uuid, p_delivery_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_delivery_notes text;
  v_row studio_shipments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can edit shipment notes.'
      using errcode = '42501';
  end if;

  v_delivery_notes := nullif(btrim(coalesce(p_delivery_notes, '')), '');
  if length(v_delivery_notes) > 2000 then
    raise exception 'Delivery notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  update studio_shipments
  set delivery_notes = v_delivery_notes,
      updated_at     = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Shipment not found.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.stage_follow_up_offset_days(p_stage text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_stage
    when 'contract_sent'     then 2
    when 'contract_signed'   then 2
    when 'product_shipped'   then 5
    when 'brief_sent'        then 3
    when 'product_delivered' then 3
    else null
  end::integer;
$function$;

CREATE OR REPLACE FUNCTION public.storage_admin_request(p_method text, p_path text, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key  text;
  v_url  text;
  v_resp extensions.http_response;
  v_body jsonb;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'storage_signing_service_role_key';

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'storage_signing_project_url';

  if v_url is null or v_url = '' then
    raise exception
      'storage_signing_project_url is not present in vault.secrets'
      using errcode = 'config_file_error';
  end if;

  if v_key is null or v_key = '' then
    raise exception
      'storage_signing_service_role_key is not present in vault.secrets'
      using errcode = 'config_file_error';
  end if;

  -- Default is 5s, which a 100 MB-bucket copy can exceed. A timeout mid-copy
  -- is the one failure this function cannot make atomic, so give it room.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');

  select * into v_resp
  from extensions.http((
    p_method,
    rtrim(v_url, '/') || '/storage/v1' || p_path,
    array[
      extensions.http_header('Authorization', 'Bearer ' || v_key),
      extensions.http_header('apikey', v_key)
    ],
    'application/json',
    -- Storage rejects an empty body when content-type is application/json
    -- (confirmed live: "Body cannot be empty..."), so never send ''.
    coalesce(p_body, '{}'::jsonb)::text
  )::extensions.http_request);

  begin
    v_body := case
                when coalesce(v_resp.content, '') = '' then '{}'::jsonb
                else v_resp.content::jsonb
              end;
  exception when others then
    -- A gateway error page is not JSON. Surface it as text rather than
    -- throwing a cast error that hides the real status code.
    v_body := jsonb_build_object('raw', v_resp.content);
  end;

  return jsonb_build_object('status', v_resp.status, 'body', v_body);
end;
$function$;

CREATE OR REPLACE FUNCTION public.unconfirm_actor_from_shoot(p_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment actor_assignments%rowtype;
  v_row actor_assignments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can remove an actor from a shoot.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_assignment_id is null then
    raise exception 'p_assignment_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_assignment from actor_assignments where id = p_assignment_id;
  if not found then
    raise exception 'Casting assignment not found.'
      using errcode = 'no_data_found';
  end if;

  if v_assignment.shoot_id is null then
    raise exception 'This actor is not confirmed onto a shoot.'
      using errcode = 'invalid_parameter_value';
  end if;

  update actor_assignments
  set shoot_id             = null,
      scheduled_shoot_date = null,
      shoot_location       = null,
      updated_at           = now()
  where id = p_assignment_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_call_sheet(p_id uuid, p_call_time time without time zone DEFAULT NULL::time without time zone, p_wrap_time_estimate text DEFAULT NULL::text, p_general_notes text DEFAULT NULL::text, p_crew_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row call_sheets%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can edit a call sheet.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_id is null then
    raise exception 'p_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  update call_sheets
  set call_time          = p_call_time,
      wrap_time_estimate  = nullif(btrim(coalesce(p_wrap_time_estimate, '')), ''),
      general_notes       = nullif(btrim(coalesce(p_general_notes, '')), ''),
      updated_at          = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Call sheet not found.'
      using errcode = 'no_data_found';
  end if;

  delete from call_sheet_crew where call_sheet_id = p_id;

  if p_crew_member_ids is not null and array_length(p_crew_member_ids, 1) > 0 then
    insert into call_sheet_crew (call_sheet_id, crew_member_id)
    select p_id, cm_id
    from unnest(p_crew_member_ids) as cm_id;
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_client(p_slug text, p_name text DEFAULT NULL::text, p_does_creators boolean DEFAULT NULL::boolean, p_does_production boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing clients%rowtype;
  v_name text;
  v_creators boolean;
  v_production boolean;
  v_row clients%rowtype;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'Only admins can edit clients.'
      using errcode = '42501';
  end if;

  select * into v_existing from clients where slug = p_slug;
  if not found then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  if p_name is not null then
    v_name := btrim(p_name);
    if v_name = '' then
      raise exception 'Client name is required.'
        using errcode = '22023';
    end if;
    if v_existing.origin <> 'manual' then
      raise exception 'This client is synced from Coda - change its name in the client knowledge file, not here.'
        using errcode = '22023';
    end if;
  end if;

  -- Resolve what the row WOULD read after this write, so "at least one line" is
  -- checked against the outcome rather than against the parameters. Turning
  -- creators off is legal for a client who already has production on, and
  -- illegal for one who does not - the difference is only visible here, which is
  -- why the check must come AFTER the coalesce and not before it.
  v_creators := coalesce(p_does_creators, v_existing.does_creators);
  v_production := coalesce(p_does_production, v_existing.does_production);
  if not (v_creators or v_production) then
    raise exception 'A client must be on at least one service line - creators, production, or both.'
      using errcode = '22023';
  end if;

  update clients
  set name = coalesce(v_name, name),
      does_creators = v_creators,
      does_production = v_production,
      updated_at = now()
  where slug = p_slug
  returning * into v_row;

  return jsonb_build_object(
    'slug', v_row.slug,
    'name', v_row.name,
    'status', v_row.status,
    'active', v_row.active,
    'does_creators', v_row.does_creators,
    'does_production', v_row.does_production,
    'origin', v_row.origin
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_crew_member(p_id uuid, p_name text, p_role text, p_rate_notes text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_role text;
  v_row  crew_members%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can edit crew members.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from crew_members where id = p_id) then
    raise exception 'Crew member not found.'
      using errcode = 'P0002';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Crew member name is required.'
      using errcode = '22023';
  end if;

  v_role := btrim(coalesce(p_role, ''));
  if v_role = '' then
    raise exception 'Crew member role is required.'
      using errcode = '22023';
  end if;

  update crew_members
  set name       = v_name,
      role       = v_role,
      rate_notes = nullif(btrim(coalesce(p_rate_notes, '')), ''),
      phone      = nullif(btrim(coalesce(p_phone, '')), ''),
      email      = nullif(btrim(coalesce(p_email, '')), ''),
      notes      = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_location(p_id uuid, p_name text, p_listing_url text DEFAULT NULL::text, p_rental_type text DEFAULT NULL::text, p_neighborhood text DEFAULT NULL::text, p_cost numeric DEFAULT NULL::numeric, p_cost_period text DEFAULT NULL::text, p_rooms text[] DEFAULT '{}'::text[], p_attributes text[] DEFAULT '{}'::text[], p_notes text DEFAULT NULL::text, p_have_rented boolean DEFAULT false, p_dont_rent_again boolean DEFAULT false, p_contact_name text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_parking_instructions text DEFAULT NULL::text, p_wifi_name text DEFAULT NULL::text, p_wifi_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_cost_period text;
  v_row locations%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can edit locations.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from locations where id = p_id) then
    raise exception 'Location not found.'
      using errcode = 'P0002';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Location name is required.'
      using errcode = '22023';
  end if;

  v_cost_period := nullif(btrim(coalesce(p_cost_period, '')), '');
  if v_cost_period is not null and v_cost_period not in ('hourly', 'daily') then
    raise exception 'Cost period must be "hourly" or "daily".'
      using errcode = '22023';
  end if;

  if p_cost is not null and p_cost < 0 then
    raise exception 'Cost cannot be negative.'
      using errcode = '22023';
  end if;

  update locations
  set name                  = v_name,
      listing_url           = nullif(btrim(coalesce(p_listing_url, '')), ''),
      rental_type           = nullif(btrim(coalesce(p_rental_type, '')), ''),
      neighborhood          = nullif(btrim(coalesce(p_neighborhood, '')), ''),
      cost                  = p_cost,
      cost_period           = v_cost_period,
      rooms                 = coalesce(p_rooms, '{}'),
      attributes            = coalesce(p_attributes, '{}'),
      notes                 = nullif(btrim(coalesce(p_notes, '')), ''),
      have_rented           = coalesce(p_have_rented, false),
      dont_rent_again       = coalesce(p_dont_rent_again, false),
      contact_name          = nullif(btrim(coalesce(p_contact_name, '')), ''),
      contact_email         = nullif(btrim(coalesce(p_contact_email, '')), ''),
      parking_instructions  = nullif(btrim(coalesce(p_parking_instructions, '')), ''),
      wifi_name             = nullif(btrim(coalesce(p_wifi_name, '')), ''),
      wifi_password         = nullif(btrim(coalesce(p_wifi_password, '')), ''),
      updated_at            = now()
  where id = p_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_prop(p_id uuid, p_name text, p_store text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric, p_return_status text DEFAULT NULL::text, p_client text DEFAULT NULL::text, p_bin_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_return_status text;
  v_row props%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can edit a prop.'
      using errcode = '42501';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'Prop name is required.'
      using errcode = '22023';
  end if;

  v_return_status := nullif(btrim(coalesce(p_return_status, '')), '');
  if v_return_status is not null
     and v_return_status not in ('Returned', 'Thrown away', 'Kept') then
    raise exception 'Status must be Returned, Thrown away, or Kept.'
      using errcode = '22023';
  end if;

  update props
  set name = v_name,
      store = nullif(btrim(coalesce(p_store, '')), ''),
      price = p_price,
      return_status = v_return_status,
      client = nullif(btrim(coalesce(p_client, '')), ''),
      bin_number = nullif(btrim(coalesce(p_bin_number, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Prop not found.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_shoot(p_id uuid, p_shoot_date date, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_location text;
  v_row shoots%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can edit a shoot.'
      using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'p_id is required'
      using errcode = '22023';
  end if;

  if not exists (select 1 from shoots where id = p_id) then
    raise exception 'Shoot not found.'
      using errcode = 'P0002';
  end if;

  if p_shoot_date is null then
    raise exception 'A shoot date is required.'
      using errcode = '22023';
  end if;

  -- Same precedence rule as create_shoot above - a linked roster location
  -- wins and supplies the one displayed string.
  v_location := nullif(btrim(coalesce(p_location, '')), '');
  if p_location_id is not null then
    select l.name into v_location from locations l where l.id = p_location_id;
    if not found then
      raise exception 'Location not found.'
        using errcode = 'P0002';
    end if;
  end if;

  update shoots
  set shoot_date  = p_shoot_date,
      location    = v_location,
      location_id = p_location_id,
      notes       = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at  = now()
  where id = p_id
  returning * into v_row;

  -- ADDED BY 059 - the propagation this function was missing. 058's
  -- confirm_actor_for_shoot COPIES shoot_date/location onto every confirmed
  -- actor's own actor_assignments row (that copy-through is 058's entire
  -- design: it is what keeps call sheets, availability checks and the
  -- calendar working unchanged), and nothing re-copied when the shoot itself
  -- moved. Written FROM v_row rather than from the parameters, so a
  -- propagated actor can never hold a value the shoot row does not (the
  -- nullif/btrim normalisation above applies once, here and there). Rows with
  -- a null shoot_id - actors scheduled directly via set_actor_shoot_schedule,
  -- with no shoot record at all - are untouched, exactly as they should be.
  -- PRESERVED VERBATIM BY 062: v_row.location is now the resolved roster name
  -- when a location is linked, so every confirmed actor gets that same string.
  update actor_assignments
  set scheduled_shoot_date = v_row.shoot_date,
      shoot_location       = v_row.location,
      updated_at           = now()
  where shoot_id = p_id;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_shoot_schedule_block(p_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_actor_assignment_ids uuid[] DEFAULT '{}'::uuid[], p_crew_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_label text;
  v_row   shoot_schedule_blocks%rowtype;
  v_bad   bigint;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only an active, non-viewer staff member can edit a schedule block.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_id is null then
    raise exception 'p_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  v_label := btrim(coalesce(p_label, ''));
  if v_label = '' then
    raise exception 'A block label is required.'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(v_label) > 120 then
    raise exception 'A block label must be 120 characters or fewer.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_start_time is null or p_end_time is null then
    raise exception 'A block needs both a start time and an end time.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'A block must end after it starts. A block that runs past midnight is entered as two blocks.'
      using errcode = 'invalid_parameter_value';
  end if;

  update shoot_schedule_blocks
  set label      = v_label,
      start_time = p_start_time,
      end_time   = p_end_time,
      location   = nullif(btrim(coalesce(p_location, '')), ''),
      notes      = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Schedule block not found.'
      using errcode = 'no_data_found';
  end if;

  if p_actor_assignment_ids is not null
     and array_length(p_actor_assignment_ids, 1) > 0 then
    select count(*) into v_bad
    from unnest(p_actor_assignment_ids) as aid
    where not exists (
      select 1 from actor_assignments aa
      where aa.id = aid and aa.shoot_id = v_row.shoot_id
    );
    if v_bad > 0 then
      raise exception 'Only actors confirmed onto this shoot can be called for one of its blocks (% not confirmed).', v_bad
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- REPLACE, not merge: delete then insert, in one statement pair inside the
  -- function's own transaction, so an empty array genuinely means "nobody is
  -- called for this block".
  delete from shoot_schedule_block_talent where block_id = p_id;

  if p_actor_assignment_ids is not null
     and array_length(p_actor_assignment_ids, 1) > 0 then
    insert into shoot_schedule_block_talent (block_id, actor_assignment_id)
    select p_id, aid
    from unnest(p_actor_assignment_ids) as aid
    on conflict do nothing;
  end if;

  -- The crew set, replaced the same way and for the same reason.
  delete from shoot_schedule_block_crew where block_id = p_id;

  if p_crew_member_ids is not null
     and array_length(p_crew_member_ids, 1) > 0 then
    insert into shoot_schedule_block_crew (block_id, crew_member_id)
    select p_id, cid
    from unnest(p_crew_member_ids) as cid
    on conflict do nothing;
  end if;

  return to_jsonb(v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_studio_shipment(p_id uuid, p_client_slug text, p_description text, p_carrier text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text, p_shipped_at date DEFAULT NULL::date, p_expected_delivery_at date DEFAULT NULL::date, p_actor_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_description text;
  v_carrier text;
  v_tracking_number text;
  v_row studio_shipments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'Only active staff can edit shipments.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from studio_shipments where id = p_id) then
    raise exception 'Shipment not found.'
      using errcode = 'P0002';
  end if;

  if not exists (select 1 from clients where slug = p_client_slug) then
    raise exception 'Client not found.'
      using errcode = 'P0002';
  end if;

  v_description := btrim(coalesce(p_description, ''));
  if v_description = '' then
    raise exception 'A description of what is in the shipment is required.'
      using errcode = '22023';
  end if;
  if length(v_description) > 300 then
    raise exception 'Description must be 300 characters or fewer.'
      using errcode = '22023';
  end if;

  v_carrier := nullif(btrim(coalesce(p_carrier, '')), '');
  if length(v_carrier) > 100 then
    raise exception 'Carrier must be 100 characters or fewer.'
      using errcode = '22023';
  end if;

  v_tracking_number := nullif(btrim(coalesce(p_tracking_number, '')), '');
  if length(v_tracking_number) > 100 then
    raise exception 'Tracking number must be 100 characters or fewer.'
      using errcode = '22023';
  end if;

  if p_actor_assignment_id is not null
     and not exists (
       select 1 from actor_assignments
       where id = p_actor_assignment_id
         and client_slug = p_client_slug
     ) then
    raise exception 'That shoot does not belong to this client.'
      using errcode = '22023';
  end if;

  update studio_shipments
  set client_slug          = p_client_slug,
      actor_assignment_id  = p_actor_assignment_id,
      description          = v_description,
      carrier              = v_carrier,
      tracking_number      = v_tracking_number,
      shipped_at           = p_shipped_at,
      expected_delivery_at = p_expected_delivery_at,
      updated_at           = now()
  where id = p_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

-- triggers
CREATE TRIGGER actor_application_videos_enforce_cap BEFORE INSERT ON public.actor_application_videos FOR EACH ROW EXECUTE FUNCTION enforce_actor_application_video_cap();
CREATE TRIGGER actor_photos_enforce_cap BEFORE INSERT ON public.actor_photos FOR EACH ROW EXECUTE FUNCTION enforce_actor_photo_cap();
CREATE TRIGGER actor_videos_enforce_cap BEFORE INSERT ON public.actor_videos FOR EACH ROW EXECUTE FUNCTION enforce_actor_video_cap();
CREATE TRIGGER application_videos_enforce_cap BEFORE INSERT ON public.application_videos FOR EACH ROW EXECUTE FUNCTION enforce_application_video_cap();
CREATE TRIGGER creator_assignment_stage_follow_up_trg BEFORE INSERT OR UPDATE ON public.creator_assignments FOR EACH ROW EXECUTE FUNCTION creator_assignment_stage_follow_up();
CREATE TRIGGER creator_videos_enforce_cap BEFORE INSERT ON public.creator_videos FOR EACH ROW EXECUTE FUNCTION enforce_creator_video_cap();

-- function privileges
revoke all on function public.actor_application_tristate(p_payload jsonb, p_key text) from public, anon, authenticated;
revoke all on function public.application_flag(p_payload jsonb, p_key text) from public, anon, authenticated;
revoke all on function public.apply_actor_approval_votes(p_client_slug text, p_votes jsonb) from public, anon, authenticated;
grant execute on function public.apply_actor_approval_votes(p_client_slug text, p_votes jsonb) to authenticated;
revoke all on function public.apply_approval_votes(p_client_slug text, p_votes jsonb) from public, anon, authenticated;
grant execute on function public.apply_approval_votes(p_client_slug text, p_votes jsonb) to authenticated;
revoke all on function public.approve_actor_application(application_id uuid) from public, anon, authenticated;
grant execute on function public.approve_actor_application(application_id uuid) to authenticated;
revoke all on function public.approve_application(application_id uuid) from public, anon, authenticated;
grant execute on function public.approve_application(application_id uuid) to authenticated;
revoke all on function public.archive_crew_member(p_id uuid, p_active boolean) from public, anon, authenticated;
grant execute on function public.archive_crew_member(p_id uuid, p_active boolean) to authenticated;
revoke all on function public.cast_actor_onto_shoot(p_actor_id uuid, p_shoot_id uuid) from public, anon, authenticated;
grant execute on function public.cast_actor_onto_shoot(p_actor_id uuid, p_shoot_id uuid) to authenticated;
revoke all on function public.confirm_actor_for_shoot(p_assignment_id uuid, p_shoot_id uuid) from public, anon, authenticated;
grant execute on function public.confirm_actor_for_shoot(p_assignment_id uuid, p_shoot_id uuid) to authenticated;
revoke all on function public.create_call_sheet(p_shoot_id uuid, p_token text, p_call_time time without time zone, p_wrap_time_estimate text, p_general_notes text, p_crew_member_ids uuid[]) from public, anon, authenticated;
grant execute on function public.create_call_sheet(p_shoot_id uuid, p_token text, p_call_time time without time zone, p_wrap_time_estimate text, p_general_notes text, p_crew_member_ids uuid[]) to authenticated;
revoke all on function public.create_client(p_slug text, p_name text, p_does_creators boolean, p_does_production boolean) from public, anon, authenticated;
grant execute on function public.create_client(p_slug text, p_name text, p_does_creators boolean, p_does_production boolean) to authenticated;
revoke all on function public.create_crew_member(p_name text, p_role text, p_rate_notes text, p_phone text, p_email text, p_notes text) from public, anon, authenticated;
grant execute on function public.create_crew_member(p_name text, p_role text, p_rate_notes text, p_phone text, p_email text, p_notes text) to authenticated;
revoke all on function public.create_location(p_name text, p_listing_url text, p_rental_type text, p_neighborhood text, p_cost numeric, p_cost_period text, p_rooms text[], p_attributes text[], p_notes text) from public, anon, authenticated;
grant execute on function public.create_location(p_name text, p_listing_url text, p_rental_type text, p_neighborhood text, p_cost numeric, p_cost_period text, p_rooms text[], p_attributes text[], p_notes text) to authenticated;
revoke all on function public.create_prop(p_name text, p_store text, p_price numeric, p_return_status text, p_client text, p_at_studio boolean, p_client_supplied boolean, p_bin_number text, p_notes text) from public, anon, authenticated;
grant execute on function public.create_prop(p_name text, p_store text, p_price numeric, p_return_status text, p_client text, p_at_studio boolean, p_client_supplied boolean, p_bin_number text, p_notes text) to authenticated;
revoke all on function public.create_shoot(p_client_slug text, p_shoot_date date, p_location text, p_notes text, p_location_id uuid) from public, anon, authenticated;
grant execute on function public.create_shoot(p_client_slug text, p_shoot_date date, p_location text, p_notes text, p_location_id uuid) to authenticated;
revoke all on function public.create_shoot_schedule_block(p_shoot_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_location text, p_notes text, p_actor_assignment_ids uuid[], p_crew_member_ids uuid[]) from public, anon, authenticated;
grant execute on function public.create_shoot_schedule_block(p_shoot_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_location text, p_notes text, p_actor_assignment_ids uuid[], p_crew_member_ids uuid[]) to authenticated;
revoke all on function public.create_studio_shipment(p_client_slug text, p_description text, p_carrier text, p_tracking_number text, p_shipped_at date, p_expected_delivery_at date, p_delivered_at date, p_delivery_notes text, p_actor_assignment_id uuid) from public, anon, authenticated;
grant execute on function public.create_studio_shipment(p_client_slug text, p_description text, p_carrier text, p_tracking_number text, p_shipped_at date, p_expected_delivery_at date, p_delivered_at date, p_delivery_notes text, p_actor_assignment_id uuid) to authenticated;
revoke all on function public.creator_assignment_stage_follow_up() from public, anon, authenticated;
revoke all on function public.delete_location(p_id uuid) from public, anon, authenticated;
grant execute on function public.delete_location(p_id uuid) to authenticated;
revoke all on function public.delete_prop(p_id uuid) from public, anon, authenticated;
grant execute on function public.delete_prop(p_id uuid) to authenticated;
revoke all on function public.delete_shoot(p_id uuid) from public, anon, authenticated;
grant execute on function public.delete_shoot(p_id uuid) to authenticated;
revoke all on function public.delete_shoot_schedule_block(p_id uuid) from public, anon, authenticated;
grant execute on function public.delete_shoot_schedule_block(p_id uuid) to authenticated;
revoke all on function public.delete_studio_shipment(p_id uuid) from public, anon, authenticated;
grant execute on function public.delete_studio_shipment(p_id uuid) to authenticated;
revoke all on function public.enforce_actor_application_video_cap() from public, anon, authenticated;
revoke all on function public.enforce_actor_photo_cap() from public, anon, authenticated;
revoke all on function public.enforce_actor_video_cap() from public, anon, authenticated;
revoke all on function public.enforce_application_video_cap() from public, anon, authenticated;
revoke all on function public.enforce_creator_video_cap() from public, anon, authenticated;
revoke all on function public.reject_actor_application(application_id uuid, reason text) from public, anon, authenticated;
grant execute on function public.reject_actor_application(application_id uuid, reason text) to authenticated;
revoke all on function public.reject_application(application_id uuid, reason text) from public, anon, authenticated;
grant execute on function public.reject_application(application_id uuid, reason text) to authenticated;
revoke all on function public.revoke_call_sheet(p_id uuid, p_revoked boolean) from public, anon, authenticated;
grant execute on function public.revoke_call_sheet(p_id uuid, p_revoked boolean) to authenticated;
revoke all on function public.set_actor_shoot_schedule(p_assignment_id uuid, p_scheduled_shoot_date date, p_shoot_location text) from public, anon, authenticated;
grant execute on function public.set_actor_shoot_schedule(p_assignment_id uuid, p_scheduled_shoot_date date, p_shoot_location text) to authenticated;
revoke all on function public.set_client_active(p_slug text, p_active boolean) from public, anon, authenticated;
grant execute on function public.set_client_active(p_slug text, p_active boolean) to authenticated;
revoke all on function public.set_client_details(p_slug text, p_service_type text, p_strategist text, p_contract_start date, p_contract_end date, p_status text) from public, anon, authenticated;
grant execute on function public.set_client_details(p_slug text, p_service_type text, p_strategist text, p_contract_start date, p_contract_end date, p_status text) to authenticated;
revoke all on function public.set_client_scope(p_slug text, p_scope text) from public, anon, authenticated;
grant execute on function public.set_client_scope(p_slug text, p_scope text) to authenticated;
revoke all on function public.set_client_verdanote_account_id(p_slug text, p_account_id text) from public, anon, authenticated;
grant execute on function public.set_client_verdanote_account_id(p_slug text, p_account_id text) to authenticated;
revoke all on function public.set_creator_assignment_delivery(p_assignment_id uuid, p_tracking_number text, p_product_delivered_at date, p_delivery_notes text) from public, anon, authenticated;
grant execute on function public.set_creator_assignment_delivery(p_assignment_id uuid, p_tracking_number text, p_product_delivered_at date, p_delivery_notes text) to authenticated;
revoke all on function public.set_location_capacity(p_id uuid, p_bedrooms integer, p_bathrooms numeric, p_max_guests integer) from public, anon, authenticated;
grant execute on function public.set_location_capacity(p_id uuid, p_bedrooms integer, p_bathrooms numeric, p_max_guests integer) to authenticated;
revoke all on function public.set_location_entry_instructions(p_id uuid, p_entry_instructions text) from public, anon, authenticated;
grant execute on function public.set_location_entry_instructions(p_id uuid, p_entry_instructions text) to authenticated;
revoke all on function public.set_prop_at_studio(p_id uuid, p_at_studio boolean) from public, anon, authenticated;
grant execute on function public.set_prop_at_studio(p_id uuid, p_at_studio boolean) to authenticated;
revoke all on function public.set_prop_client_supplied(p_id uuid, p_client_supplied boolean) from public, anon, authenticated;
grant execute on function public.set_prop_client_supplied(p_id uuid, p_client_supplied boolean) to authenticated;
revoke all on function public.set_prop_return_status(p_id uuid, p_return_status text) from public, anon, authenticated;
grant execute on function public.set_prop_return_status(p_id uuid, p_return_status text) to authenticated;
revoke all on function public.set_studio_shipment_delivered(p_id uuid, p_delivered_at date) from public, anon, authenticated;
grant execute on function public.set_studio_shipment_delivered(p_id uuid, p_delivered_at date) to authenticated;
revoke all on function public.set_studio_shipment_notes(p_id uuid, p_delivery_notes text) from public, anon, authenticated;
grant execute on function public.set_studio_shipment_notes(p_id uuid, p_delivery_notes text) to authenticated;
revoke all on function public.stage_follow_up_offset_days(p_stage text) from public, anon, authenticated;
grant execute on function public.stage_follow_up_offset_days(p_stage text) to authenticated;
revoke all on function public.storage_admin_request(p_method text, p_path text, p_body jsonb) from public, anon, authenticated;
revoke all on function public.unconfirm_actor_from_shoot(p_assignment_id uuid) from public, anon, authenticated;
grant execute on function public.unconfirm_actor_from_shoot(p_assignment_id uuid) to authenticated;
revoke all on function public.update_call_sheet(p_id uuid, p_call_time time without time zone, p_wrap_time_estimate text, p_general_notes text, p_crew_member_ids uuid[]) from public, anon, authenticated;
grant execute on function public.update_call_sheet(p_id uuid, p_call_time time without time zone, p_wrap_time_estimate text, p_general_notes text, p_crew_member_ids uuid[]) to authenticated;
revoke all on function public.update_client(p_slug text, p_name text, p_does_creators boolean, p_does_production boolean) from public, anon, authenticated;
grant execute on function public.update_client(p_slug text, p_name text, p_does_creators boolean, p_does_production boolean) to authenticated;
revoke all on function public.update_crew_member(p_id uuid, p_name text, p_role text, p_rate_notes text, p_phone text, p_email text, p_notes text) from public, anon, authenticated;
grant execute on function public.update_crew_member(p_id uuid, p_name text, p_role text, p_rate_notes text, p_phone text, p_email text, p_notes text) to authenticated;
revoke all on function public.update_location(p_id uuid, p_name text, p_listing_url text, p_rental_type text, p_neighborhood text, p_cost numeric, p_cost_period text, p_rooms text[], p_attributes text[], p_notes text, p_have_rented boolean, p_dont_rent_again boolean, p_contact_name text, p_contact_email text, p_parking_instructions text, p_wifi_name text, p_wifi_password text) from public, anon, authenticated;
grant execute on function public.update_location(p_id uuid, p_name text, p_listing_url text, p_rental_type text, p_neighborhood text, p_cost numeric, p_cost_period text, p_rooms text[], p_attributes text[], p_notes text, p_have_rented boolean, p_dont_rent_again boolean, p_contact_name text, p_contact_email text, p_parking_instructions text, p_wifi_name text, p_wifi_password text) to authenticated;
revoke all on function public.update_prop(p_id uuid, p_name text, p_store text, p_price numeric, p_return_status text, p_client text, p_bin_number text, p_notes text) from public, anon, authenticated;
grant execute on function public.update_prop(p_id uuid, p_name text, p_store text, p_price numeric, p_return_status text, p_client text, p_bin_number text, p_notes text) to authenticated;
revoke all on function public.update_shoot(p_id uuid, p_shoot_date date, p_location text, p_notes text, p_location_id uuid) from public, anon, authenticated;
grant execute on function public.update_shoot(p_id uuid, p_shoot_date date, p_location text, p_notes text, p_location_id uuid) to authenticated;
revoke all on function public.update_shoot_schedule_block(p_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_location text, p_notes text, p_actor_assignment_ids uuid[], p_crew_member_ids uuid[]) from public, anon, authenticated;
grant execute on function public.update_shoot_schedule_block(p_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_location text, p_notes text, p_actor_assignment_ids uuid[], p_crew_member_ids uuid[]) to authenticated;
revoke all on function public.update_studio_shipment(p_id uuid, p_client_slug text, p_description text, p_carrier text, p_tracking_number text, p_shipped_at date, p_expected_delivery_at date, p_actor_assignment_id uuid) from public, anon, authenticated;
grant execute on function public.update_studio_shipment(p_id uuid, p_client_slug text, p_description text, p_carrier text, p_tracking_number text, p_shipped_at date, p_expected_delivery_at date, p_actor_assignment_id uuid) to authenticated;
