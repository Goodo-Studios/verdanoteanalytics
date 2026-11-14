-- P9: client progress ingest. The HQ processes that used to write client progress to the old
-- dashboard database (run-cycle, deliver, sync-performance, update-client-knowledge and the client
-- seed) now push it to Verdanote through the ingest-client-progress edge function.
--
-- What is new
--   ingest_tokens   hashed ingest tokens. A token is a credential for one HQ process family, not a
--                   role and not a login. Only the sha256 hash is stored; the raw token is returned
--                   once, by create_ingest_token, and never again. No row is readable or writable
--                   by anon, employee, client or builder through the API: builders use the checked
--                   functions below, the edge function uses the service role.
--   ingest_audit    one row per authenticated call to the function: who (token), when, which process,
--                   how many clients were received, applied and refused, and why. Counts and client
--                   slugs only, never row contents, never a person's data.
--
-- Functions (all SECURITY DEFINER, EXECUTE revoked from public, anon and authenticated except the
-- four builder calls, which check has_role(auth.uid(), 'builder') in their body):
--   create_ingest_token(name, scope)   builder: makes a token, returns it once
--   revoke_ingest_token(id)            builder: switches a token off at once
--   list_ingest_tokens()               builder: names, dates and state, never a hash
--   list_ingest_audit(limit)           builder: the latest calls
--   apply_client_progress(...)         service role only: the batched, idempotent write
--
-- What apply_client_progress writes: only existing clients that the HQ sync owns (origin is not
-- 'manual'; a hand-made client is refused, the rule the old sync had). Unknown slugs are refused,
-- the function never creates a client. clients.name, status, service_type, strategist, pct_complete,
-- contract_start, contract_end, month and notes are written only when the call names them; last_synced
-- is set by the database clock on every applied client; active, origin, service_line, scope and
-- verdanote_account_id are never touched. deliverables upsert on (client_slug, month, type), so
-- sending the same batch again leaves the same rows.
--
-- Tests: supabase/tests/client_progress_ingest_test.sql, supabase/functions/ingest-client-progress/.

create table public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  scope text not null default 'client_progress' check (scope in ('client_progress')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.ingest_tokens is
  'Hashed ingest tokens for the HQ client progress feed. Credential, not a role. Service role and the builder functions only.';

create table public.ingest_audit (
  id uuid primary key default gen_random_uuid(),
  token_id uuid references public.ingest_tokens(id) on delete set null,
  called_at timestamptz not null default now(),
  source text,
  outcome text not null check (outcome in ('ok', 'partial', 'rejected', 'error')),
  client_count integer not null default 0,
  applied_count integer not null default 0,
  rejected_count integer not null default 0,
  deliverable_count integer not null default 0,
  request_bytes integer,
  error_code text,
  rejected jsonb not null default '[]'::jsonb
);

create index ingest_audit_token_called_idx on public.ingest_audit (token_id, called_at desc);
create index ingest_audit_called_idx on public.ingest_audit (called_at desc);

comment on table public.ingest_audit is
  'One row per authenticated call to ingest-client-progress. Counts and client slugs only.';

alter table public.ingest_tokens enable row level security;
alter table public.ingest_audit enable row level security;
-- No policy on either table: with row rules on and no policy, no API role reads or writes a row.
revoke all on table public.ingest_tokens from public, anon, authenticated;
revoke all on table public.ingest_audit from public, anon, authenticated;
grant all on table public.ingest_tokens to service_role;
grant all on table public.ingest_audit to service_role;

-- ------------------------------------------------------------------ builder functions

create or replace function public.create_ingest_token(p_name text, p_scope text default 'client_progress')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_token text;
  v_id uuid;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can create an ingest token' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'give the token a name of 1 to 80 characters' using errcode = '22023';
  end if;
  if p_scope is distinct from 'client_progress' then
    raise exception 'unknown token scope' using errcode = '22023';
  end if;
  if (select count(*) from public.ingest_tokens where revoked_at is null) >= 20 then
    raise exception 'too many active tokens; revoke one first' using errcode = '54000';
  end if;
  v_token := 'vni_' || encode(gen_random_bytes(32), 'hex');
  insert into public.ingest_tokens (name, scope, token_hash, created_by)
  values (v_name, p_scope, encode(digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'scope', p_scope, 'token', v_token);
end;
$$;

create or replace function public.revoke_ingest_token(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can revoke an ingest token' using errcode = '42501';
  end if;
  update public.ingest_tokens set revoked_at = now() where id = p_id and revoked_at is null;
  if not found then
    raise exception 'no active token with that id' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.list_ingest_tokens()
returns table (id uuid, name text, scope text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can list ingest tokens' using errcode = '42501';
  end if;
  return query
    select t.id, t.name, t.scope, t.created_at, t.last_used_at, t.revoked_at
      from public.ingest_tokens t
     order by (t.revoked_at is not null), t.created_at desc;
end;
$$;

create or replace function public.list_ingest_audit(p_limit integer default 20)
returns table (
  id uuid, called_at timestamptz, token_name text, source text, outcome text,
  client_count integer, applied_count integer, rejected_count integer, deliverable_count integer, error_code text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can read the ingest audit' using errcode = '42501';
  end if;
  return query
    select a.id, a.called_at, t.name, a.source, a.outcome,
           a.client_count, a.applied_count, a.rejected_count, a.deliverable_count, a.error_code
      from public.ingest_audit a
      left join public.ingest_tokens t on t.id = a.token_id
     order by a.called_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

-- ------------------------------------------------------------------ the write (service role only)

create or replace function public.apply_client_progress(
  p_token_id uuid,
  p_source text,
  p_items jsonb,
  p_request_bytes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_d jsonb;
  v_slug text;
  v_origin text;
  v_received integer := 0;
  v_applied integer := 0;
  v_deliverables integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_outcome text;
begin
  -- A token revoked between the function's check and this call is refused here too.
  if not exists (select 1 from public.ingest_tokens where id = p_token_id and revoked_at is null) then
    raise exception 'token is not active' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_received := v_received + 1;
    v_slug := v_item ->> 'slug';
    select c.origin into v_origin from public.clients c where c.slug = v_slug for update;
    if not found then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('slug', v_slug, 'reason', 'unknown_client'));
      continue;
    end if;
    if v_origin = 'manual' then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('slug', v_slug, 'reason', 'manual_client'));
      continue;
    end if;

    update public.clients c set
      name = case when v_item ? 'name' then v_item ->> 'name' else c.name end,
      status = case when v_item ? 'status' then v_item ->> 'status' else c.status end,
      service_type = case when v_item ? 'service_type' then v_item ->> 'service_type' else c.service_type end,
      strategist = case when v_item ? 'strategist' then v_item ->> 'strategist' else c.strategist end,
      pct_complete = case when v_item ? 'pct_complete' then (v_item ->> 'pct_complete')::integer else c.pct_complete end,
      contract_start = case when v_item ? 'contract_start' then (v_item ->> 'contract_start')::date else c.contract_start end,
      contract_end = case when v_item ? 'contract_end' then (v_item ->> 'contract_end')::date else c.contract_end end,
      month = case when v_item ? 'month' then v_item ->> 'month' else c.month end,
      notes = case when v_item ? 'notes' then v_item ->> 'notes' else c.notes end,
      last_synced = now(),
      updated_at = now()
    where c.slug = v_slug;

    for v_d in select value from jsonb_array_elements(coalesce(v_item -> 'deliverables', '[]'::jsonb)) loop
      insert into public.deliverables (client_slug, month, type, status, file_path)
      values (v_slug, v_d ->> 'month', v_d ->> 'type', v_d ->> 'status', v_d ->> 'file_path')
      on conflict (client_slug, month, type) do update set
        status = excluded.status,
        file_path = case when v_d ? 'file_path' then excluded.file_path else public.deliverables.file_path end,
        updated_at = now();
      v_deliverables := v_deliverables + 1;
    end loop;

    v_applied := v_applied + 1;
  end loop;

  v_outcome := case
    when v_received = 0 or jsonb_array_length(v_rejected) = 0 then 'ok'
    when v_applied = 0 then 'rejected'
    else 'partial'
  end;

  update public.ingest_tokens set last_used_at = now() where id = p_token_id;
  insert into public.ingest_audit
    (token_id, source, outcome, client_count, applied_count, rejected_count, deliverable_count, request_bytes, rejected)
  values
    (p_token_id, left(p_source, 60), v_outcome, v_received, v_applied, jsonb_array_length(v_rejected), v_deliverables, p_request_bytes, v_rejected);
  -- Keep the audit to about half a year.
  delete from public.ingest_audit where called_at < now() - interval '180 days';

  return jsonb_build_object(
    'received', v_received,
    'applied', v_applied,
    'rejected', v_rejected,
    'deliverables_upserted', v_deliverables,
    'recorded_at', now()
  );
end;
$$;

revoke all on function public.create_ingest_token(text, text) from public, anon, authenticated;
revoke all on function public.revoke_ingest_token(uuid) from public, anon, authenticated;
revoke all on function public.list_ingest_tokens() from public, anon, authenticated;
revoke all on function public.list_ingest_audit(integer) from public, anon, authenticated;
revoke all on function public.apply_client_progress(uuid, text, jsonb, integer) from public, anon, authenticated;
-- The four builder calls are executable by a login; each refuses a non-builder in its body.
grant execute on function public.create_ingest_token(text, text) to authenticated;
grant execute on function public.revoke_ingest_token(uuid) to authenticated;
grant execute on function public.list_ingest_tokens() to authenticated;
grant execute on function public.list_ingest_audit(integer) to authenticated;
grant execute on function public.create_ingest_token(text, text) to service_role;
grant execute on function public.revoke_ingest_token(uuid) to service_role;
grant execute on function public.list_ingest_tokens() to service_role;
grant execute on function public.list_ingest_audit(integer) to service_role;
-- Only the edge function (service role) writes progress.
grant execute on function public.apply_client_progress(uuid, text, jsonb, integer) to service_role;
