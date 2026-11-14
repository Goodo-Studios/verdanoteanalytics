-- Public application uploads: byte caps, a discard marker, and the data the cleanup function needs.
--
-- Before this migration nothing deleted the files of a draft that expired or was never submitted
-- (public-apply hands out signed upload addresses for videos up to 250 MB), the total bytes per
-- draft and per address were not capped, and the "same email is already pending" branch of
-- public_application_submit marked the draft used and left its files in storage forever.
--
--   reserved_bytes   sum of the sizes reserved on a draft. A draft is capped at 1 GiB in total, and
--                    one address at 3 GiB in any 24 hours (status too_large and quota).
--   discarded_at     set when a submit was dropped because the email already has a pending
--                    application. Its files belong to nobody, so they are cleaned like an expired draft.
--   cleaned_at       set by the cleanup function once the draft's objects are deleted.
--
-- Rows of public_application_begin's tidy-up: it used to delete every draft older than two days.
-- That would erase the only record of which folders still hold files. It now deletes only drafts
-- whose files are cleaned, or that were submitted and kept (their files belong to an application).
--
-- Cleanup candidates are drafts that were never submitted and expired more than 3 hours ago (the
-- signed upload address lives two hours past issue, so nothing can still arrive), or that were
-- discarded more than 3 hours ago. A draft is never a candidate when an application with its id
-- exists, or when any application video, headshot or thumbnail path points into its folder.
--
-- public_application_unprotected_ids is for folders in storage that no draft row remembers
-- (drafts older than two days were deleted by the previous tidy-up): it returns the ids that have no
-- draft row, no application and no path reference, so those folders can be removed too.
--
-- All functions here are service role only. The edge function is cleanup-application-uploads.
-- Tests: supabase/tests/public_application_cleanup_test.sql.

alter table public.public_application_drafts
  add column if not exists reserved_bytes bigint not null default 0,
  add column if not exists discarded_at timestamptz,
  add column if not exists cleaned_at timestamptz;

create index if not exists public_application_drafts_cleanup_idx
  on public.public_application_drafts (expires_at)
  where cleaned_at is null;

-- Starts a draft. Same as before except for the tidy-up at the end (see the header).
create or replace function public.public_application_begin(p_kind text, p_ip_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_kind not in ('creator', 'actor') or p_ip_hash is null or length(p_ip_hash) > 128 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('public_application_drafts'), hashtext(p_ip_hash));
  if (select count(*) from public.public_application_drafts where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10 then
    return null;
  end if;
  insert into public.public_application_drafts (kind, ip_hash) values (p_kind, p_ip_hash) returning id into v_id;
  delete from public.public_application_drafts
   where created_at < now() - interval '2 days'
     and (cleaned_at is not null or (submitted_at is not null and discarded_at is null));
  return v_id;
end;
$$;
revoke all on function public.public_application_begin(text, text) from public, anon, authenticated;
grant execute on function public.public_application_begin(text, text) to service_role;

-- Reserves one file slot on a draft and says which bucket it goes in. Status: ok, not_found,
-- expired, used, too_many, too_large (a file, or the draft's total bytes), quota (this address's
-- bytes in 24 hours), bad_type.
create or replace function public.public_application_reserve_file(
  p_draft_id uuid,
  p_kind text,
  p_file_kind text,
  p_size bigint,
  p_mime text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.public_application_drafts%rowtype;
  v_bucket text;
  v_max bigint;
  v_ok_mime text[];
  v_draft_cap constant bigint := 1073741824;
  v_address_cap constant bigint := 3221225472;
begin
  select * into d from public.public_application_drafts where id = p_draft_id and kind = p_kind for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if d.submitted_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if now() > d.expires_at then
    return jsonb_build_object('status', 'expired');
  end if;
  if p_size is null or p_size < 1 then
    return jsonb_build_object('status', 'too_large');
  end if;
  if p_file_kind = 'headshot' then
    v_bucket := case p_kind when 'creator' then 'creator-application-headshots' else 'actor-application-headshots' end;
    v_max := 5242880;
    v_ok_mime := array['image/jpeg', 'image/png', 'image/webp'];
    if d.headshots >= 9 then return jsonb_build_object('status', 'too_many'); end if;
  elsif p_file_kind = 'video' then
    v_bucket := case p_kind when 'creator' then 'creator-application-videos' else 'actor-application-videos' end;
    v_max := 262144000;
    v_ok_mime := array['video/mp4', 'video/quicktime', 'video/webm'];
    if d.videos >= 8 then return jsonb_build_object('status', 'too_many'); end if;
  else
    return jsonb_build_object('status', 'bad_type');
  end if;
  if p_mime is null or not (p_mime = any (v_ok_mime)) then
    return jsonb_build_object('status', 'bad_type');
  end if;
  if p_size > v_max then
    return jsonb_build_object('status', 'too_large');
  end if;
  if d.reserved_bytes + p_size > v_draft_cap then
    return jsonb_build_object('status', 'too_large');
  end if;
  -- One address at a time, so two drafts from the same address cannot both pass the check.
  perform pg_advisory_xact_lock(hashtext('public_application_bytes'), hashtext(d.ip_hash));
  if (select coalesce(sum(x.reserved_bytes), 0)
        from public.public_application_drafts x
       where x.ip_hash = d.ip_hash and x.created_at > now() - interval '24 hours') + p_size > v_address_cap then
    return jsonb_build_object('status', 'quota');
  end if;
  update public.public_application_drafts
     set headshots = headshots + (case when p_file_kind = 'headshot' then 1 else 0 end),
         videos = videos + (case when p_file_kind = 'video' then 1 else 0 end),
         reserved_bytes = reserved_bytes + p_size
   where id = d.id;
  return jsonb_build_object('status', 'ok', 'bucket', v_bucket);
end;
$$;
revoke all on function public.public_application_reserve_file(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.public_application_reserve_file(uuid, text, text, bigint, text) to service_role;

-- Final submit. Same as before, except that a repeat of a pending application for the same email
-- marks the draft discarded so the cleanup can delete the files it uploaded.
create or replace function public.public_application_submit(
  p_kind text,
  p_draft_id uuid,
  p_ip_hash text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.public_application_drafts%rowtype;
  v_name text;
  v_email text;
  v_prefix text;
  v_headshot text;
  v_video jsonb;
  v_path text;
  v_thumb text;
  v_count integer;
  v_index integer := 0;
  v_ages text[];
  v_shape text := '[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?';
begin
  select * into d from public.public_application_drafts where id = p_draft_id and kind = p_kind for update;
  if not found then return 'not_found'; end if;
  if d.submitted_at is not null then return 'used'; end if;
  if now() > d.expires_at then return 'expired'; end if;
  -- Nobody fills in the form in under three seconds from opening it.
  if now() - d.created_at < interval '3 seconds' then return 'too_fast'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return 'invalid:payload'; end if;

  perform pg_advisory_xact_lock(hashtext('public_application_submit'), hashtext(p_ip_hash));
  if (select count(*) from public.public_application_drafts where ip_hash = p_ip_hash and submitted_at > now() - interval '1 hour') >= 3 then
    return 'too_many';
  end if;

  v_name := public.public_application_text(p_payload ->> 'name', 200);
  v_email := lower(public.public_application_text(p_payload ->> 'email', 254));
  if v_name is null then return 'invalid:name'; end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return 'invalid:email'; end if;
  if jsonb_typeof(p_payload -> 'videos') <> 'array' then return 'invalid:videos'; end if;
  v_count := jsonb_array_length(p_payload -> 'videos');
  if p_kind = 'creator' and (v_count < 3 or v_count > 8) then return 'invalid:videos'; end if;
  if p_kind = 'actor' and (v_count < 1 or v_count > 8) then return 'invalid:videos'; end if;

  v_ages := case when jsonb_typeof(p_payload -> 'age_range') = 'array'
                 then array(select left(btrim(value), 40) from jsonb_array_elements_text(p_payload -> 'age_range') as t(value) where btrim(value) <> '' limit 10)
                 else '{}'::text[] end;
  if p_kind = 'actor' then
    if public.public_application_text(p_payload ->> 'gender', 40) is null then return 'invalid:gender'; end if;
    if array_length(v_ages, 1) is null then return 'invalid:age_range'; end if;
  end if;

  v_prefix := 'applications/' || d.id::text || '/';
  v_headshot := public.public_application_text(p_payload ->> 'headshot_path', 300);
  if v_headshot is not null and v_headshot !~ ('^' || v_prefix || 'headshot/' || v_shape || '$') then return 'invalid:headshot'; end if;
  for v_video in select value from jsonb_array_elements(p_payload -> 'videos') loop
    if jsonb_typeof(v_video) <> 'object' then return 'invalid:videos'; end if;
    v_path := public.public_application_text(v_video ->> 'storage_path', 300);
    if v_path is null or v_path !~ ('^' || v_prefix || 'video/' || v_shape || '$') then return 'invalid:videos'; end if;
    v_thumb := public.public_application_text(v_video ->> 'thumbnail_path', 300);
    if v_thumb is not null and v_thumb !~ ('^' || v_prefix || 'headshot/' || v_shape || '$') then return 'invalid:videos'; end if;
  end loop;

  -- Mark the draft used first: a second submit with the same draft writes nothing.
  update public.public_application_drafts set submitted_at = now() where id = d.id;

  if p_kind = 'creator' then
    if exists (select 1 from public.creator_applications where lower(email) = v_email and status = 'pending') then
      update public.public_application_drafts set discarded_at = now() where id = d.id;
      return 'ok';
    end if;
    insert into public.creator_applications (
      id, name, email, socials, website, categories, age_range, gender, location, shipping_address,
      alcohol_ok, cbd_ok, thc_ok, family_inclusive_ok, headshot_path, submitter_ip_hash
    ) values (
      d.id, v_name, v_email,
      case when jsonb_typeof(p_payload -> 'socials') = 'object' and length((p_payload -> 'socials')::text) <= 4000 then p_payload -> 'socials' end,
      public.public_application_text(p_payload ->> 'website', 300),
      case when jsonb_typeof(p_payload -> 'categories') = 'array'
           then array(select left(btrim(value), 60) from jsonb_array_elements_text(p_payload -> 'categories') as t(value) where btrim(value) <> '' limit 20)
           else '{}'::text[] end,
      v_ages,
      public.public_application_text(p_payload ->> 'gender', 40),
      public.public_application_text(p_payload ->> 'location', 200),
      public.public_application_text(p_payload ->> 'shipping_address', 500),
      public.application_flag(p_payload, 'alcohol_ok'), public.application_flag(p_payload, 'cbd_ok'),
      public.application_flag(p_payload, 'thc_ok'), public.application_flag(p_payload, 'family_inclusive_ok'),
      v_headshot, p_ip_hash
    );
    for v_video in select value from jsonb_array_elements(p_payload -> 'videos') loop
      v_index := v_index + 1;
      insert into public.application_videos (application_id, storage_path, thumbnail_path, title, sort_order, size_bytes, mime_type)
      values (d.id, btrim(v_video ->> 'storage_path'), public.public_application_text(v_video ->> 'thumbnail_path', 300),
              public.public_application_text(v_video ->> 'title', 200), v_index,
              case when jsonb_typeof(v_video -> 'size_bytes') = 'number' then (v_video ->> 'size_bytes')::bigint end,
              public.public_application_text(v_video ->> 'mime_type', 100));
    end loop;
  else
    if exists (select 1 from public.actor_applications where lower(email) = v_email and status = 'pending') then
      update public.public_application_drafts set discarded_at = now() where id = d.id;
      return 'ok';
    end if;
    insert into public.actor_applications (
      id, name, email, phone, gender, age_range, notes, dog_owner, kids_in_videos, social_url, additional_social_url, headshot_path, submitter_ip_hash
    ) values (
      d.id, v_name, v_email,
      public.public_application_text(p_payload ->> 'phone', 40),
      public.public_application_text(p_payload ->> 'gender', 40),
      v_ages,
      public.public_application_text(p_payload ->> 'notes', 2000),
      public.actor_application_tristate(p_payload, 'dog_owner'),
      public.public_application_text(p_payload ->> 'kids_in_videos', 200),
      public.public_application_text(p_payload ->> 'social_url', 300),
      public.public_application_text(p_payload ->> 'additional_social_url', 300),
      v_headshot, p_ip_hash
    );
    for v_video in select value from jsonb_array_elements(p_payload -> 'videos') loop
      v_index := v_index + 1;
      insert into public.actor_application_videos (application_id, storage_path, thumbnail_path, title, sort_order, size_bytes, mime_type)
      values (d.id, btrim(v_video ->> 'storage_path'), public.public_application_text(v_video ->> 'thumbnail_path', 300),
              public.public_application_text(v_video ->> 'title', 200), v_index,
              case when jsonb_typeof(v_video -> 'size_bytes') = 'number' then (v_video ->> 'size_bytes')::bigint end,
              public.public_application_text(v_video ->> 'mime_type', 100));
    end loop;
  end if;
  return 'ok';
end;
$$;
revoke all on function public.public_application_submit(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.public_application_submit(text, uuid, text, jsonb) to service_role;

-- True when anything keeps the folder of draft p_id: an application with that id, or an application
-- video, headshot or thumbnail path inside the folder.
create or replace function public.public_application_folder_in_use(p_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.creator_applications where id = p_id)
      or exists (select 1 from public.actor_applications where id = p_id)
      or exists (select 1 from public.application_videos
                  where storage_path like 'applications/' || p_id::text || '/%'
                     or thumbnail_path like 'applications/' || p_id::text || '/%')
      or exists (select 1 from public.actor_application_videos
                  where storage_path like 'applications/' || p_id::text || '/%'
                     or thumbnail_path like 'applications/' || p_id::text || '/%')
      or exists (select 1 from public.creator_applications where headshot_path like 'applications/' || p_id::text || '/%')
      or exists (select 1 from public.actor_applications where headshot_path like 'applications/' || p_id::text || '/%');
$$;
revoke all on function public.public_application_folder_in_use(uuid) from public, anon, authenticated;
grant execute on function public.public_application_folder_in_use(uuid) to service_role;

-- Drafts whose files can be deleted now. At most p_limit (1 to 100), oldest first.
create or replace function public.public_application_cleanup_candidates(p_limit integer)
returns table (draft_id uuid, kind text)
language sql
stable
set search_path = public
as $$
  select d.id, d.kind
    from public.public_application_drafts d
   where d.cleaned_at is null
     and ((d.submitted_at is null and d.expires_at < now() - interval '3 hours')
          or (d.discarded_at is not null and d.discarded_at < now() - interval '3 hours'))
     and not public.public_application_folder_in_use(d.id)
   order by d.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;
revoke all on function public.public_application_cleanup_candidates(integer) from public, anon, authenticated;
grant execute on function public.public_application_cleanup_candidates(integer) to service_role;

-- Records that these drafts' files are deleted. Only drafts that are still eligible are marked.
create or replace function public.public_application_cleanup_mark(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.public_application_drafts d
     set cleaned_at = now()
   where d.id = any (coalesce(p_ids, '{}'::uuid[]))
     and d.cleaned_at is null
     and ((d.submitted_at is null and d.expires_at < now() - interval '3 hours')
          or (d.discarded_at is not null and d.discarded_at < now() - interval '3 hours'))
     and not public.public_application_folder_in_use(d.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.public_application_cleanup_mark(uuid[]) from public, anon, authenticated;
grant execute on function public.public_application_cleanup_mark(uuid[]) to service_role;

-- Of the given folder ids, the ones that no draft row remembers and nothing keeps in use.
create or replace function public.public_application_unprotected_ids(p_ids uuid[])
returns setof uuid
language sql
stable
set search_path = public
as $$
  select x
    from unnest(coalesce(p_ids, '{}'::uuid[])) as t(x)
   where not exists (select 1 from public.public_application_drafts d where d.id = x)
     and not public.public_application_folder_in_use(x);
$$;
revoke all on function public.public_application_unprotected_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.public_application_unprotected_ids(uuid[]) to service_role;
