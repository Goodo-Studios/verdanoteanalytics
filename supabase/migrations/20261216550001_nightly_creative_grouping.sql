-- Nightly creative grouping for the Entity Report (audit plan item 7.3).
--
-- Nothing scheduled cluster-creatives, so entities were last refreshed on 2026-07-24. Matthew's
-- decision (2026-11-16): run it nightly for every account with running ads, grouping each
-- account's newest 1,000 running ads (the cap lives in _shared/grouping-inputs.ts).
--
-- queue_creative_grouping() sends one request per account through pg_net with the service role
-- key from the vault, to public.edge_function_url('cluster-creatives').
--
-- Verify after applying:
--   select jobname, schedule, active from cron.job where jobname = 'creative-grouping-nightly';
--   select account_id, count(*), max(last_seen_at) from public.creative_clusters group by 1;
--
-- Rollback: select cron.unschedule('creative-grouping-nightly');
--           drop function public.queue_creative_grouping();

create extension if not exists pg_net with schema extensions;

create or replace function public.queue_creative_grouping()
returns integer
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_account text;
  v_url text;
  v_auth text;
  v_count integer := 0;
begin
  v_url := public.edge_function_url('cluster-creatives');
  v_auth := 'Bearer ' || coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1), '');

  for v_account in
    select distinct c.account_id
      from public.creatives c
     where c.ad_status = 'ACTIVE'
       and c.account_id is not null
     order by c.account_id
  loop
    perform net.http_post(
      url                  := v_url,
      body                 := jsonb_build_object('account_id', v_account),
      headers              := jsonb_build_object('Authorization', v_auth, 'Content-Type', 'application/json'),
      timeout_milliseconds := 150000
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.queue_creative_grouping() from public, anon, authenticated;
grant execute on function public.queue_creative_grouping() to service_role;

comment on function public.queue_creative_grouping() is
  'Queues cluster-creatives for every account with running ads (audit 7.3). Run nightly by cron. Service role only.';

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'creative-grouping-nightly') then
    perform cron.unschedule('creative-grouping-nightly');
  end if;
end;
$$;

-- 09:20 UTC is early morning US time, after the overnight syncs.
select cron.schedule(
  'creative-grouping-nightly',
  '20 9 * * *',
  $$ select public.queue_creative_grouping() $$
);
