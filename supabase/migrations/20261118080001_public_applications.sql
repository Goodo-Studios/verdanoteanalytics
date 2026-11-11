-- Public links, part 3 (P8): creator and actor application forms on Verdanote.
--
-- Anyone can fill in the form, so there is no token to look up. What stands in for it:
--   * A draft. The form first asks the public-apply edge function to begin; that makes one row in
--     public_application_drafts (service only) and returns its id. Everything after that, the file
--     upload addresses and the final submit, needs that id, expires after two hours, and works once.
--   * Upload addresses are made by the function, not chosen by the browser: the path is
--     applications/<draft id>/(headshot|video)/<random name>, in the application's own buckets, so
--     an address can only write inside one application's folder. Size and file type are checked
--     before an address is made, and again by the bucket limits.
--   * Limits per address (hashed): drafts per hour, uploads per draft, submissions per hour.
--   * A hidden field and a minimum fill time catch simple bots. No CAPTCHA service.
--   * A second pending application for the same email is not inserted, and the form still says
--     thank you, so the form cannot be used to find out who has applied.
--
-- The staff pages read creator_applications, application_videos, actor_applications and
-- actor_application_videos exactly as before. Submissions arrive as status 'pending'. Nothing is
-- emailed. The service-only functions below are the only writers.

create table public.public_application_drafts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('creator', 'actor')),
  ip_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  headshots integer not null default 0,
  videos integer not null default 0,
  submitted_at timestamptz
);
create index public_application_drafts_ip_idx on public.public_application_drafts (ip_hash, created_at);
alter table public.public_application_drafts enable row level security;
revoke all on table public.public_application_drafts from public, anon, authenticated;

-- Starts a draft. Null when this address already started too many in the last hour.
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
  delete from public.public_application_drafts where created_at < now() - interval '2 days';
  return v_id;
end;
$$;
revoke all on function public.public_application_begin(text, text) from public, anon, authenticated;
grant execute on function public.public_application_begin(text, text) to service_role;

-- Reserves one file slot on a draft and says which bucket it goes in. Status: ok, not_found,
-- expired, used, too_many, too_large, bad_type.
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
  update public.public_application_drafts
     set headshots = headshots + (case when p_file_kind = 'headshot' then 1 else 0 end),
         videos = videos + (case when p_file_kind = 'video' then 1 else 0 end)
   where id = d.id;
  return jsonb_build_object('status', 'ok', 'bucket', v_bucket);
end;
$$;
revoke all on function public.public_application_reserve_file(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.public_application_reserve_file(uuid, text, text, bigint, text) to service_role;

-- Trims text and cuts it to a length, null when empty.
create or replace function public.public_application_text(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = public
as $$
  select left(nullif(btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]+', ' ', 'g')), ''), p_max);
$$;
revoke all on function public.public_application_text(text, integer) from public, anon, authenticated;
grant execute on function public.public_application_text(text, integer) to service_role;

-- Final submit. Returns ok, not_found, expired, used, too_fast, too_many (this address), invalid:<reason>.
-- A repeat of a pending application for the same email returns ok and writes nothing.
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
