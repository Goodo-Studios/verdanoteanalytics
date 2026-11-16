-- Ready Vault items get search embeddings (audit plan item 4.5).
--
-- Nothing ever called vault-embed, so item_embeddings stayed empty and Vault's semantic search
-- (match_items / vault-search) returned nothing. Production on 2026-11-15 (read-only check):
-- 1,338 ready items, 0 embeddings.
--
-- 1. inspiration_items.embed_attempts / embed_last_attempt_at track how often an item was sent
--    to vault-embed, so an item that cannot be embedded (no text, provider error) stops after
--    3 tries instead of costing money on every run.
-- 2. When an item leaves 'ready' (re-analyze), its embedding is removed and the attempt count
--    resets, so the new content is embedded once the item is ready again.
-- 3. queue_vault_embeddings(p_limit) sends one pg_net request to vault-embed per ready item that
--    has no embedding, oldest first, at most p_limit per call, retrying an item no sooner than an
--    hour after its last try. pg_net sends the requests from Postgres, so they do not depend on
--    an edge function staying alive. Service role only.
-- 4. A pg_cron job runs it every 10 minutes with a cap of 25: the 1,338-item backfill finishes in
--    about 9 hours. Cost estimate: about 600 characters (~150 tokens) per item with
--    text-embedding-3-small at $0.02 per million tokens is about $0.004 for the whole backfill,
--    and new items add a fraction of a cent per month.
--
-- The function URL is production's, like poke_analyze_creative (20260723000003).
-- scripts/staging-lockdown.sql unschedules every cron job on staging.
--
-- Rollback: select cron.unschedule('vault-embed-missing');
--           drop function public.queue_vault_embeddings(integer);
--           drop trigger inspiration_items_reset_embedding on public.inspiration_items;
--           drop function public.inspiration_items_reset_embedding();
--           alter table public.inspiration_items drop column embed_attempts, drop column embed_last_attempt_at;

create extension if not exists pg_net with schema extensions;

alter table public.inspiration_items
  add column if not exists embed_attempts integer not null default 0,
  add column if not exists embed_last_attempt_at timestamptz;

create or replace function public.inspiration_items_reset_embedding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'ready' and new.status is distinct from 'ready' then
    delete from public.item_embeddings where item_id = new.id;
    new.embed_attempts := 0;
    new.embed_last_attempt_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.inspiration_items_reset_embedding() from public, anon, authenticated;

drop trigger if exists inspiration_items_reset_embedding on public.inspiration_items;
create trigger inspiration_items_reset_embedding
  before update of status on public.inspiration_items
  for each row execute function public.inspiration_items_reset_embedding();

create or replace function public.queue_vault_embeddings(p_limit integer default 25)
returns integer
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_auth text;
begin
  select array_agg(id) into v_ids
  from (
    select i.id
    from public.inspiration_items i
    where i.status = 'ready'
      and i.embed_attempts < 3
      and (i.embed_last_attempt_at is null or i.embed_last_attempt_at < now() - interval '1 hour')
      and not exists (select 1 from public.item_embeddings e where e.item_id = i.id)
    order by i.created_at
    limit greatest(coalesce(p_limit, 0), 0)
    for update of i skip locked
  ) picked;

  if v_ids is null then
    return 0;
  end if;

  v_auth := 'Bearer ' || coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1), '');

  update public.inspiration_items
     set embed_attempts = embed_attempts + 1,
         embed_last_attempt_at = now()
   where id = any(v_ids);

  foreach v_id in array v_ids loop
    perform net.http_post(
      url                  := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/vault-embed',
      body                 := jsonb_build_object('item_id', v_id),
      headers              := jsonb_build_object('Authorization', v_auth, 'Content-Type', 'application/json'),
      timeout_milliseconds := 30000
    );
  end loop;

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

revoke execute on function public.queue_vault_embeddings(integer) from public;
revoke execute on function public.queue_vault_embeddings(integer) from anon;
revoke execute on function public.queue_vault_embeddings(integer) from authenticated;
grant execute on function public.queue_vault_embeddings(integer) to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'vault-embed-missing' loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'vault-embed-missing',
  '*/10 * * * *',
  $$ select public.queue_vault_embeddings(25) $$
);

-- Verify after applying:
--   select jobname, schedule, active from cron.job where jobname = 'vault-embed-missing';
--   select count(*) from public.item_embeddings;   -- climbs by up to 25 every 10 minutes
--   select status_code, left(content, 120) from net._http_response order by created desc limit 5;
