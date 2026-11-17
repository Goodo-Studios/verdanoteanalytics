-- Stepped cluster restamp (audit plan item 7.3 follow-up).
--
-- restamp_creative_clusters cleared every stamped creative in the account and then
-- stamped every group member, all in one statement. creatives has 46 indexes and a
-- statement-level trigger that joins the old and new row sets, so on the four largest
-- accounts (2,000 to 3,300 rows to rewrite) the call ran past the API's 8 second
-- statement limit and grouping failed for those accounts.
--
-- restamp_creative_clusters_step compares the wanted stamps with what is stored,
-- updates at most p_limit rows that differ (rows that already match are not touched),
-- and returns how many still differ. cluster-creatives calls it until that is 0.
-- Each call is its own transaction, so an interrupted run leaves every creative with
-- either its old or its new stamp. Both groups still exist then, because
-- cluster-creatives retires stale groups only after the restamp finishes.
--
-- restamp_creative_clusters stays in place for now; nothing calls it after this
-- release. Dropping it is a separate cleanup.

create or replace function public.restamp_creative_clusters_step(
  p_account_id text,
  p_stamps jsonb,
  p_limit integer default 300
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_left integer;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be at least 1' using errcode = '22023';
  end if;

  with wanted as (
    select distinct on (s.ad_id) s.ad_id, s.cluster_id, s.confidence
      from jsonb_to_recordset(coalesce(p_stamps, '[]'::jsonb))
             as s(ad_id text, cluster_id uuid, confidence text)
     order by s.ad_id
  ),
  diff as (
    select c.ad_id, w.cluster_id, w.confidence
      from public.creatives c
      left join wanted w on w.ad_id = c.ad_id
     where c.account_id = p_account_id
       and (c.cluster_id is distinct from w.cluster_id
            or c.cluster_confidence is distinct from w.confidence)
  ),
  picked as (
    select d.ad_id, d.cluster_id, d.confidence
      from diff d
     order by d.ad_id
     limit p_limit
  ),
  done as (
    update public.creatives c
       set cluster_id = p.cluster_id,
           cluster_confidence = p.confidence
      from picked p
     where c.ad_id = p.ad_id
       and c.account_id = p_account_id
    returning 1
  )
  select (select count(*) from diff) - (select count(*) from done)
    into v_left;

  return v_left;
end;
$$;

revoke all on function public.restamp_creative_clusters_step(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.restamp_creative_clusters_step(text, jsonb, integer) to service_role;

comment on function public.restamp_creative_clusters_step(text, jsonb, integer) is
  'Moves an account''s creative cluster stamps toward p_stamps, changing at most p_limit rows that differ. Returns how many rows still differ. Service role only; called in a loop by cluster-creatives.';
