-- =============================================================================
-- Creative Intelligence (WS3 / US-007) — Entity Report: blended read model
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- Numbered off the REMOTE frontier (20260718000002 was the highest applied on
-- prod at authoring time; parallel media work pushed 000001/000002). Per the
-- verdanote-supabase-ledger-drift-reconcile-with-db-push rule, a new CI migration
-- must sit ahead of the frontier, not behind it.
--
-- US-006 gave cluster-creatives a blended, persistent entity model: a new 'exact'
-- confidence tier (shared-asset anchor), a stored centroid, and anchor sets
-- (asset_keys / meta_video_ids / meta_image_hashes). The shipped rpc_entity_report
-- (migration 20260714000019) predates all of that — it passes confidence_tier
-- through (so 'exact' rows already surface) but exposes NO per-cluster analysis
-- coverage and NO explanation of WHICH signals grouped an entity, and its headline
-- coverage counts note-embeddings only (ai_visual_notes era), not analysis.
--
-- This migration CREATE OR REPLACEs the two read RPCs to add, without changing
-- their signatures or the IDOR posture:
--   • headline: analyzed_creatives + analysis_coverage_pct (analysis, not just
--     embeddings) alongside the existing embedding coverage.
--   • per cluster: member coverage (analyzed / visual-embedded / script-embedded
--     counts + coverage_pct) and a derived `signals` array
--     (exact | visual | script | destination) explaining the grouping.
--   • drill-in members: analysis_status + destination_key surfaced.
-- Aggregation stays entirely in SQL (single source of truth); the frontend only
-- renders. 'exact' is now a first-class tier everywhere.
-- =============================================================================

create or replace function public.rpc_entity_report(p_account_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total_creatives  int;
  v_embedded         int;
  v_analyzed         int;
  v_clustered        int;
  v_n_clusters       int;
  v_cluster_spend    numeric;
  v_effective        numeric;
  v_headline         jsonb;
  v_clusters         jsonb;
begin
  select count(*) into v_total_creatives
    from public.creatives where account_id = p_account_id;

  select count(*) into v_embedded
    from public.creative_embeddings
    where account_id = p_account_id and embedding is not null;

  -- Analysis coverage: creatives the analyze-creative pipeline has completed.
  select count(*) into v_analyzed
    from public.creatives
    where account_id = p_account_id and analysis_status = 'done';

  select count(*) into v_clustered
    from public.creatives
    where account_id = p_account_id and cluster_id is not null;

  select count(*), coalesce(sum(total_spend), 0)
    into v_n_clusters, v_cluster_spend
    from public.creative_clusters where account_id = p_account_id;

  -- Effective entities = inverse Herfindahl of spend shares. Guard div-by-zero:
  -- when there is no cluster spend, effective entities is just the cluster count.
  if v_cluster_spend > 0 then
    select 1.0 / nullif(sum(power(total_spend / v_cluster_spend, 2)), 0)
      into v_effective
      from public.creative_clusters
      where account_id = p_account_id and total_spend > 0;
  else
    v_effective := v_n_clusters;
  end if;

  v_headline := jsonb_build_object(
    'total_creatives',     v_total_creatives,
    'embedded_creatives',  v_embedded,
    'analyzed_creatives',  v_analyzed,
    'clustered_creatives', v_clustered,
    'coverage_pct',        case when v_total_creatives > 0
                                then round(100.0 * v_embedded / v_total_creatives, 1)
                                else 0 end,
    'analysis_coverage_pct', case when v_total_creatives > 0
                                then round(100.0 * v_analyzed / v_total_creatives, 1)
                                else 0 end,
    'distinct_entities',   v_n_clusters,
    'effective_entities',  round(coalesce(v_effective, 0), 2),
    'cluster_spend',       v_cluster_spend
  );

  select coalesce(jsonb_agg(row_to_json(c) order by c.total_spend desc), '[]'::jsonb)
    into v_clusters
    from (
      select cl.id,
             cl.label,
             cl.n_creatives,
             cl.total_spend,
             cl.confidence_tier,
             cl.cv_roas, cl.cv_ctr, cl.cv_cpa,
             cl.tag_homogeneity, cl.manual_tag_frac,
             cl.representative_ad_id,
             rep.thumbnail_url as representative_thumbnail,
             rep.ad_name       as representative_ad_name,
             cov.analyzed_members,
             cov.visual_members,
             cov.script_members,
             case when cl.n_creatives > 0
                  then round(100.0 * cov.analyzed_members / cl.n_creatives, 1)
                  else 0 end as coverage_pct,
             -- Signals that GROUPED this entity, honest about what agreed. Tied to
             -- what actually merged members, not to mere anchor presence (every
             -- entity carries its own asset_key, so anchor-presence would fire on
             -- singletons and mean nothing):
             --   exact       — the exact tier: a shared underlying asset anchor
             --                 (asset_key / meta video id / image hash) merged ≥2
             --                 creatives at zero model cost.
             --   visual      — at least one member carries a visual embedding.
             --   script      — at least one member carries a script embedding.
             --   destination — a multi-member entity whose members all point at
             --                 the SAME landing destination (weak corroborator,
             --                 never a merge basis — mirrors the clustering spec).
             to_jsonb(array_remove(array[
               case when cl.confidence_tier = 'exact' then 'exact' end,
               case when cov.visual_members > 0 then 'visual' end,
               case when cov.script_members > 0 then 'script' end,
               case when cl.n_creatives > 1
                        and cov.dest_members = cl.n_creatives
                        and cov.distinct_destinations = 1
                    then 'destination' end
             ], null)) as signals,
             case when v_cluster_spend > 0
                  then round(100.0 * cl.total_spend / v_cluster_spend, 1)
                  else 0 end as spend_share_pct
      from public.creative_clusters cl
      left join lateral (
        select
          count(*) filter (where c2.analysis_status = 'done')     as analyzed_members,
          count(*) filter (where ce.visual_embedding is not null) as visual_members,
          count(*) filter (where ce.script_embedding is not null) as script_members,
          count(*) filter (where c2.destination_key is not null)  as dest_members,
          count(distinct c2.destination_key)                      as distinct_destinations
        from public.creatives c2
        left join public.creative_embeddings ce
          on ce.ad_id = c2.ad_id and ce.account_id = c2.account_id
        where c2.account_id = cl.account_id and c2.cluster_id = cl.id
      ) cov on true
      left join public.creatives rep
        on rep.ad_id = cl.representative_ad_id and rep.account_id = cl.account_id
      where cl.account_id = p_account_id
    ) c;

  return jsonb_build_object('headline', v_headline, 'clusters', v_clusters);
end;
$$;

-- Drill-in: members of one cluster, now with analysis_status + destination so the
-- dialog can show which members are analyzed and where they point.
create or replace function public.rpc_entity_cluster_members(
  p_account_id text,
  p_cluster_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(m) order by m.spend desc), '[]'::jsonb)
  from (
    select c.ad_id, c.ad_name, c.thumbnail_url, c.preview_url,
           c.spend, c.roas, c.ctr, c.cpa,
           c.ad_type, c.person, c.style, c.product, c.hook, c.theme,
           c.tag_source, c.ai_visual_notes,
           c.analysis_status, c.destination_key
    from public.creatives c
    where c.account_id = p_account_id
      and c.cluster_id = p_cluster_id
  ) m;
$$;

-- ─── Re-assert the IDOR guard (create-or-replace preserves ACLs, but be explicit).
-- These SECURITY DEFINER fns trust p_account_id; only the service-role caller (the
-- entity-report edge fn, which verifies JWT + account ownership) may invoke them.
revoke execute on function public.rpc_entity_report(text) from authenticated, anon;
revoke execute on function public.rpc_entity_cluster_members(text, uuid) from authenticated, anon;
