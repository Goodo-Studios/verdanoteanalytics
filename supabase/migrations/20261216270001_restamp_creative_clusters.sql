-- Audit plan item 5.10: cluster restamp in one step.
--
-- cluster-creatives used to clear cluster_id / cluster_confidence on every creative in
-- the account, then re-stamp group by group with separate updates. A failure part way
-- left the account partly or fully unclustered until the next run. This function does
-- the clear and the re-stamp inside one call (one transaction), so the stamps change
-- whole or not at all.
--
-- p_stamps: [{"ad_id": text, "cluster_id": uuid, "confidence": text}, ...]
-- Only creatives of p_account_id are touched, even if another account's ad id is passed.
-- Returns the number of creatives stamped.
--
-- Service role only (the edge function). Additive: no table or policy changes.

create or replace function public.restamp_creative_clusters(p_account_id text, p_stamps jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_stamped integer;
begin
  update public.creatives c
     set cluster_id = null, cluster_confidence = null
   where c.account_id = p_account_id
     and c.cluster_id is not null;

  update public.creatives c
     set cluster_id = s.cluster_id,
         cluster_confidence = s.confidence
    from jsonb_to_recordset(coalesce(p_stamps, '[]'::jsonb))
           as s(ad_id text, cluster_id uuid, confidence text)
   where c.ad_id = s.ad_id
     and c.account_id = p_account_id;
  get diagnostics v_stamped = row_count;

  return v_stamped;
end;
$$;

revoke all on function public.restamp_creative_clusters(text, jsonb) from public, anon, authenticated;
grant execute on function public.restamp_creative_clusters(text, jsonb) to service_role;

comment on function public.restamp_creative_clusters(text, jsonb) is
  'Clears and re-applies creative cluster stamps for one account in one call (audit 5.10). Service role only.';
