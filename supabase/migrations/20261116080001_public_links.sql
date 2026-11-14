-- Public links, part 1 (P8): the shared framework, plus approval boards and casting links.
--
-- Links made in Verdanote open on Verdanote and read and write Verdanote's own database.
-- Nobody opens a table. A person with a link talks to the `public-link` edge function, which
-- uses the service role and the functions below. Every one of those functions is executable
-- by service_role only (revoked from public, anon and authenticated).
--
-- Tokens
--   Staff make a token in the browser from the secure random source (48 characters from a
--   64 character alphabet, 288 bits), the same as the old dashboard did, so links already sent
--   out keep working once their rows are copied here. The token column on the link table stays
--   as it is (staff-only row rules; staff copy a link from it). Every lookup from a link goes
--   through public_link_registry instead, which holds only the SHA-256 hash of the token. The
--   edge function hashes what it was given and the database looks that hash up, so what is
--   compared is a hash an attacker cannot steer, never the token.
--
-- Why a registry table and not a column on approval_boards
--   scripts/dashboard-copy.mjs copies the old rows with `insert ... select * from
--   jsonb_populate_recordset(null::public.<table>, ...)` with triggers off, and checks the
--   copy by hashing whole rows. A new column on a copied table would arrive as null and would
--   make every source and target row checksum differ. So the copied tables are not changed.
--   The registry trigger is ENABLE ALWAYS, which fires even with triggers off, so rows copied
--   in from the old dashboard get their hash row in the same statement.
--
-- Revoke and expiry
--   Both stay on the link row (revoked, expires_at), where the staff pages already set them.
--   The function reads them on every call, so a revoke takes effect on the next request.
--
-- Rate limits
--   public_link_rate_hit keeps fixed-window counters per key (a hashed client address, a token
--   hash). The edge function calls it before it does any work.

-- ---------------------------------------------------------------- registry
create table public.public_link_registry (
  link_type text not null,
  link_id uuid not null,
  token_hash text not null,
  open_count integer not null default 0,
  last_opened_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint public_link_registry_pkey primary key (link_type, link_id),
  constraint public_link_registry_type_check check (link_type in ('approval_board', 'location_board', 'call_sheet')),
  constraint public_link_registry_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);
create unique index public_link_registry_token_hash_key on public.public_link_registry (token_hash);

alter table public.public_link_registry enable row level security;
revoke all on table public.public_link_registry from public, anon, authenticated;
grant select on table public.public_link_registry to authenticated;
-- Staff read the open counts for the link pages. Nobody else reads it, and nobody but the
-- service role (and the trigger below) writes to it.
create policy "Staff read public_link_registry" on public.public_link_registry
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create table public.public_link_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  constraint public_link_rate_limits_pkey primary key (key, window_start)
);
alter table public.public_link_rate_limits enable row level security;
revoke all on table public.public_link_rate_limits from public, anon, authenticated;

-- ---------------------------------------------------------------- hashing and the trigger
create or replace function public.public_link_hash(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;
revoke all on function public.public_link_hash(text) from public, anon, authenticated;
grant execute on function public.public_link_hash(text) to service_role;

-- Keeps the registry in step with the link table: insert, token change, delete.
create or replace function public.public_link_registry_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := tg_argv[0];
begin
  if tg_op = 'DELETE' then
    delete from public.public_link_registry where link_type = v_type and link_id = old.id;
    return old;
  end if;
  insert into public.public_link_registry (link_type, link_id, token_hash)
  values (v_type, new.id, public.public_link_hash(new.token))
  on conflict (link_type, link_id) do update set token_hash = excluded.token_hash;
  return new;
end;
$$;
revoke all on function public.public_link_registry_sync() from public, anon, authenticated;

create trigger approval_boards_registry
  after insert or update of token or delete on public.approval_boards
  for each row execute function public.public_link_registry_sync('approval_board');
-- Fire even while a copy runs with triggers off (session_replication_role = replica).
alter table public.approval_boards enable always trigger approval_boards_registry;

-- Rows that already exist (the copy of the old dashboard on staging).
insert into public.public_link_registry (link_type, link_id, token_hash)
select 'approval_board', id, public.public_link_hash(token) from public.approval_boards
on conflict (link_type, link_id) do nothing;

-- Release check: adds any missing registry row for every link table and says how many it
-- had to add. After a copy from the old dashboard it must return 0.
create or replace function public.public_link_backfill_registry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval integer;
begin
  with ins as (
    insert into public.public_link_registry (link_type, link_id, token_hash)
    select 'approval_board', id, public.public_link_hash(token) from public.approval_boards
    on conflict (link_type, link_id) do nothing
    returning 1
  )
  select count(*) into v_approval from ins;
  return jsonb_build_object('approval_board', v_approval);
end;
$$;
revoke all on function public.public_link_backfill_registry() from public, anon, authenticated;
grant execute on function public.public_link_backfill_registry() to service_role;

-- ---------------------------------------------------------------- rate limit
-- True while the key is under its limit. p_cost 0 only looks, it does not count.
create or replace function public.public_link_rate_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  p_cost integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_key is null or length(p_key) > 200 or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_cost is null or p_cost < 0 then
    raise exception 'bad rate limit arguments' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  if p_cost = 0 then
    select hits into v_hits from public.public_link_rate_limits where key = p_key and window_start = v_start;
    return coalesce(v_hits, 0) < p_limit;
  end if;
  insert into public.public_link_rate_limits as t (key, window_start, hits)
  values (p_key, v_start, p_cost)
  on conflict (key, window_start) do update set hits = t.hits + p_cost
  returning hits into v_hits;
  if random() < 0.02 then
    delete from public.public_link_rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.public_link_rate_hit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.public_link_rate_hit(text, integer, integer, integer) to service_role;

-- ---------------------------------------------------------------- approval boards and casting
-- One function pair serves both board types: 'creators' (the approval link a brand opens) and
-- 'actors' (the casting link). A token of the other type answers not_found, the same as a
-- token that does not exist.
--
-- What the board shows is an explicit key list. It never returns a row, and never an email,
-- phone number, address, internal note, rate or do-not-use flag. The storage paths come back
-- for the edge function to sign and are removed before anything leaves it.

create or replace function public.public_board_get(
  p_token_hash text,
  p_board_type text,
  p_count_open boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.approval_boards%rowtype;
  v_client_name text;
  v_payload jsonb;
begin
  if p_token_hash is null or p_board_type not in ('creators', 'actors') then
    return jsonb_build_object('status', 'not_found');
  end if;

  select ab.* into b
  from public.public_link_registry r
  join public.approval_boards ab on ab.id = r.link_id
  where r.link_type = 'approval_board' and r.token_hash = p_token_hash and ab.board_type = p_board_type;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if b.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if now() > b.expires_at then
    return jsonb_build_object('status', 'expired');
  end if;

  if p_count_open then
    update public.public_link_registry
       set open_count = open_count + 1, last_opened_at = now()
     where link_type = 'approval_board' and link_id = b.id;
  end if;

  select name into v_client_name from public.clients where slug = b.client_slug;

  if p_board_type = 'creators' then
    v_payload := coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', ca.id,
        'name', c.name,
        'filming_location_photos', coalesce((
          select jsonb_agg(jsonb_build_object('id', cfl.id, 'label', cfl.label) order by cfl.sort_order, cfl.id)
          from public.creator_filming_locations cfl where cfl.creator_id = c.id
        ), '[]'::jsonb),
        'family_pet_photos', coalesce((
          select jsonb_agg(jsonb_build_object('id', cp.id, 'category', cp.category, 'caption', cp.caption)
                           order by cp.sort_order, cp.created_at, cp.id)
          from public.creator_photos cp where cp.creator_id = c.id
        ), '[]'::jsonb),
        'videos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', cv.id, 'title', cv.title, 'format', cv.format,
            'video_path', cv.storage_path, 'thumbnail_path', cv.thumbnail_path
          ) order by cv.sort_order, cv.id)
          from public.creator_videos cv where cv.creator_id = c.id
        ), '[]'::jsonb),
        'vote', v.vote
      ) order by c.name, ca.id)
      from public.creator_assignments ca
      join public.dashboard_creators c on c.id = ca.creator_id
      left join public.approval_votes v on v.board_id = b.id and v.assignment_id = ca.id
      where ca.client_slug = b.client_slug and ca.stage in ('shortlisted', 'client_approved')
    ), '[]'::jsonb);
  else
    v_payload := coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', aa.id,
        'name', a.name,
        'gender', a.gender,
        'age_range', a.age_range,
        'headshot_path', nullif(a.headshot_path, ''),
        'videos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', av.id, 'title', av.title,
            'video_path', av.storage_path, 'thumbnail_path', av.thumbnail_path
          ) order by av.sort_order, av.id)
          from public.actor_videos av where av.actor_id = a.id
        ), '[]'::jsonb),
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object('id', ap.id, 'caption', ap.caption) order by ap.sort_order, ap.created_at, ap.id)
          from public.actor_photos ap where ap.actor_id = a.id
        ), '[]'::jsonb),
        'social_url', case
          when a.social_url ~* '^[a-z][a-z0-9+.-]*:' and a.social_url !~* '^https?://' then null
          else nullif(btrim(a.social_url), '') end,
        'additional_social_url', case
          when a.additional_social_url ~* '^[a-z][a-z0-9+.-]*:' and a.additional_social_url !~* '^https?://' then null
          else nullif(btrim(a.additional_social_url), '') end,
        'vote', v.vote
      ) order by a.name, aa.id)
      from public.actor_assignments aa
      join public.actors a on a.id = aa.actor_id
      left join public.actor_approval_votes v on v.board_id = b.id and v.assignment_id = aa.id
      where aa.client_slug = b.client_slug and aa.stage in ('shortlisted', 'client_approved')
    ), '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'board_type', p_board_type,
    'client_name', coalesce(v_client_name, ''),
    'expires_at', b.expires_at,
    'people', v_payload
  );
end;
$$;
revoke all on function public.public_board_get(text, text, boolean) from public, anon, authenticated;
grant execute on function public.public_board_get(text, text, boolean) to service_role;

-- One thumbs up or down. 'ok' when written; otherwise not_found, revoked, expired or
-- invalid (a bad vote, or an assignment that is not on this board). The assignment has to
-- belong to the board's own client and be board material, or already voted on through this
-- board, so a token holder cannot reach another client's rows.
create or replace function public.public_board_vote(
  p_token_hash text,
  p_board_type text,
  p_assignment_id uuid,
  p_vote text,
  p_voted_by text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.approval_boards%rowtype;
  v_voted_by text;
begin
  if p_token_hash is null or p_board_type not in ('creators', 'actors') then
    return 'not_found';
  end if;
  select ab.* into b
  from public.public_link_registry r
  join public.approval_boards ab on ab.id = r.link_id
  where r.link_type = 'approval_board' and r.token_hash = p_token_hash and ab.board_type = p_board_type;
  if not found then
    return 'not_found';
  end if;
  if b.revoked then
    return 'revoked';
  end if;
  if now() > b.expires_at then
    return 'expired';
  end if;
  if p_vote is null or p_vote not in ('up', 'down') or p_assignment_id is null then
    return 'invalid';
  end if;

  -- A decorative label: control characters become spaces, runs of space collapse, trimmed,
  -- cut to 40 characters. Truncated, never rejected, so a vote is not lost over it.
  v_voted_by := left(nullif(btrim(regexp_replace(
    regexp_replace(coalesce(p_voted_by, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g')), ''), 40);

  if p_board_type = 'creators' then
    if not exists (
      select 1 from public.creator_assignments ca
      where ca.id = p_assignment_id and ca.client_slug = b.client_slug
        and (ca.stage in ('shortlisted', 'client_approved')
             or exists (select 1 from public.approval_votes v where v.board_id = b.id and v.assignment_id = ca.id))
    ) then
      return 'invalid';
    end if;
    insert into public.approval_votes (board_id, assignment_id, vote, voted_by)
    values (b.id, p_assignment_id, p_vote, v_voted_by)
    on conflict (board_id, assignment_id)
    do update set vote = excluded.vote, voted_at = now(), voted_by = excluded.voted_by;
  else
    if not exists (
      select 1 from public.actor_assignments aa
      where aa.id = p_assignment_id and aa.client_slug = b.client_slug
        and (aa.stage in ('shortlisted', 'client_approved')
             or exists (select 1 from public.actor_approval_votes v where v.board_id = b.id and v.assignment_id = aa.id))
    ) then
      return 'invalid';
    end if;
    insert into public.actor_approval_votes (board_id, assignment_id, vote, voted_by)
    values (b.id, p_assignment_id, p_vote, v_voted_by)
    on conflict (board_id, assignment_id)
    do update set vote = excluded.vote, voted_at = now(), voted_by = excluded.voted_by;
  end if;
  return 'ok';
end;
$$;
revoke all on function public.public_board_vote(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.public_board_vote(text, text, uuid, text, text) to service_role;

-- The storage path of one photo on a live board, for the edge function to sign. Only photos
-- of people who are on this board (the board's own client, board stage) resolve.
create or replace function public.public_board_media(
  p_token_hash text,
  p_board_type text,
  p_kind text,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.approval_boards%rowtype;
  v_path text;
  v_bucket text;
begin
  if p_token_hash is null or p_board_type not in ('creators', 'actors') or p_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select ab.* into b
  from public.public_link_registry r
  join public.approval_boards ab on ab.id = r.link_id
  where r.link_type = 'approval_board' and r.token_hash = p_token_hash and ab.board_type = p_board_type;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if b.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if now() > b.expires_at then
    return jsonb_build_object('status', 'expired');
  end if;

  if p_board_type = 'creators' and p_kind = 'photo' then
    v_bucket := 'creator-family-pet-photos';
    select cp.storage_path into v_path
    from public.creator_photos cp
    join public.creator_assignments ca on ca.creator_id = cp.creator_id
      and ca.client_slug = b.client_slug and ca.stage in ('shortlisted', 'client_approved')
    where cp.id = p_id limit 1;
  elsif p_board_type = 'creators' and p_kind = 'location' then
    v_bucket := 'creator-filming-locations';
    select cfl.storage_path into v_path
    from public.creator_filming_locations cfl
    join public.creator_assignments ca on ca.creator_id = cfl.creator_id
      and ca.client_slug = b.client_slug and ca.stage in ('shortlisted', 'client_approved')
    where cfl.id = p_id limit 1;
  elsif p_board_type = 'actors' and p_kind = 'photo' then
    v_bucket := 'actor-photos';
    select ap.storage_path into v_path
    from public.actor_photos ap
    join public.actor_assignments aa on aa.actor_id = ap.actor_id
      and aa.client_slug = b.client_slug and aa.stage in ('shortlisted', 'client_approved')
    where ap.id = p_id limit 1;
  else
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_path is null or v_path = '' then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok', 'bucket', v_bucket, 'path', v_path);
end;
$$;
revoke all on function public.public_board_media(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.public_board_media(text, text, text, uuid) to service_role;
