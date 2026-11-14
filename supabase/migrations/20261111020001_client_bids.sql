-- Step 6: read-only BID viewer (consolidation plan, "BID Builder: read-only BID viewer in
-- Verdanote"). The BID Builder worker (repos/private/bid-builder) keeps producing each
-- client's Brand Intelligence Document as markdown outside Verdanote; this stores finished
-- BIDs so staff can read them inside Verdanote.
--
--   client_bids   one finished BID version per row: client, version, title, the markdown
--                 body with its sha256 fingerprint, where it came from (source, source
--                 reference, made up or real) and when it was generated and imported.
--                 Immutable: a new BID is a new version.
--
-- Read-only in the app: staff read every row; clients read nothing (a BID is internal
-- strategy, including about their own brand; a client view is phase 2). Nobody signed in can
-- write. BIDs arrive only through import_client_bid, which only the service role can call
-- (an import script with the service key); importing the same body again returns the
-- existing version, so an import can be re-run safely. There is no edit function and no
-- editing UI.
--
-- Staging holds only the made-up demo BID written by scripts/seed-staging-bids.mjs. Loading
-- real BIDs is an owner decision (decision 10).
-- Tests: supabase/tests/client_bids_test.sql.

create table public.client_bids (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete restrict,
  version integer not null check (version >= 1),
  title text not null check (length(btrim(title)) between 1 and 200),
  body_markdown text not null check (length(btrim(body_markdown)) between 1 and 400000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('bid-builder', 'staging-seed')),
  source_ref text not null check (length(btrim(source_ref)) between 1 and 500),
  data_origin text not null check (data_origin in ('made_up', 'real')),
  generated_at timestamptz not null,
  imported_at timestamptz not null default now(),
  unique (client_slug, version),
  unique (client_slug, body_sha256)
);
create index client_bids_client_idx on public.client_bids (client_slug, version desc);

comment on table public.client_bids is 'Finished client BIDs (Brand Intelligence Documents) for the read-only staff viewer. Staff read; written only by import_client_bid (service role). Immutable.';

create or replace function public.prevent_client_bid_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'a client BID version is immutable; import a new version instead' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_client_bid_rewrite() from public, anon, authenticated;

create trigger client_bids_immutable before update or delete on public.client_bids
  for each row execute function public.prevent_client_bid_rewrite();
create trigger client_bids_no_truncate before truncate on public.client_bids
  for each statement execute function public.prevent_client_bid_rewrite();

alter table public.client_bids enable row level security;
revoke all on table public.client_bids from public, anon, authenticated;
grant select on table public.client_bids to authenticated;
grant all on table public.client_bids to service_role;

create policy "Builder/employee can read client_bids" on public.client_bids
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- Service role only: import one finished BID. The fingerprint is computed here from the body.
-- The same body for the same client returns the existing version; otherwise the next
-- version is written. Returns the version.
create or replace function public.import_client_bid(
  p_client_slug text,
  p_title text,
  p_body_markdown text,
  p_source text,
  p_source_ref text,
  p_data_origin text,
  p_generated_at timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sha text;
  v_version integer;
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200
     or p_body_markdown is null or length(btrim(p_body_markdown)) not between 1 and 400000
     or p_source is null or p_source not in ('bid-builder', 'staging-seed')
     or p_source_ref is null or length(btrim(p_source_ref)) not between 1 and 500
     or p_data_origin is null or p_data_origin not in ('made_up', 'real')
     or p_generated_at is null then
    raise exception 'check the BID fields' using errcode = '22023';
  end if;
  if p_source = 'staging-seed' and p_data_origin <> 'made_up' then
    raise exception 'a staging seed BID must be made up' using errcode = '22023';
  end if;
  perform 1 from public.clients where slug = p_client_slug for share;
  if not found then
    raise exception 'client not found' using errcode = 'P0002';
  end if;
  v_sha := encode(sha256(convert_to(p_body_markdown, 'UTF8')), 'hex');
  select version into v_version from public.client_bids where client_slug = p_client_slug and body_sha256 = v_sha;
  if v_version is not null then
    return v_version;
  end if;
  -- One import per client at a time, so version numbers never collide.
  perform pg_advisory_xact_lock(hashtext('client_bids:' || p_client_slug));
  select version into v_version from public.client_bids where client_slug = p_client_slug and body_sha256 = v_sha;
  if v_version is not null then
    return v_version;
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.client_bids where client_slug = p_client_slug;
  insert into public.client_bids (client_slug, version, title, body_markdown, body_sha256, source, source_ref, data_origin, generated_at)
  values (p_client_slug, v_version, btrim(p_title), p_body_markdown, v_sha, p_source, btrim(p_source_ref), p_data_origin, p_generated_at);
  return v_version;
end;
$$;

revoke all on function public.import_client_bid(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.import_client_bid(text, text, text, text, text, text, timestamptz) to service_role;
