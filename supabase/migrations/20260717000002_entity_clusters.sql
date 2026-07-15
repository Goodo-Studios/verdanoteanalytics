-- =============================================================================
-- Entity Report (Feature 2) — v1 TEXT clustering
-- Migration 2/2: creative_clusters table, cluster_id/confidence on creatives,
--                match helper + entity-report read RPC (SECURITY DEFINER)
-- =============================================================================
-- Placeholder prefix; orchestrator renumbers + db push manually (see MIGRATIONS.md).
-- Idempotent + additive only.
-- =============================================================================

-- ─── Additive cluster columns on creatives ──────────────────────────────────
-- cluster_id points at the entity a creative was assigned to (nullable: untagged
-- / un-embedded creatives are never assigned).  confidence_tier is denormalized
-- from the parent cluster for cheap per-creative filtering in the browser.
alter table public.creatives
  add column if not exists cluster_id uuid;
alter table public.creatives
  add column if not exists cluster_confidence text
    check (cluster_confidence is null
           or cluster_confidence in ('corroborated','probable','visual_only'));

create index if not exists idx_creatives_cluster on public.creatives(cluster_id)
  where cluster_id is not null;

-- ─── creative_clusters — one row per detected "entity" per account ───────────
create table if not exists public.creative_clusters (
  id                uuid primary key default gen_random_uuid(),
  account_id        text not null references public.ad_accounts(id) on delete cascade,
  -- Deterministic label so re-clustering a stable dataset is stable-ish; the
  -- clustering fn writes a human label from the modal tag combo.
  label             text,
  n_creatives       int  not null default 0,
  total_spend       numeric not null default 0,
  -- Delivery cohesion: coefficient of variation (stddev/mean) of the members'
  -- ROAS / CTR / CPA. Lower CV == tighter delivery == stronger corroboration.
  cv_roas           numeric,
  cv_ctr            numeric,
  cv_cpa            numeric,
  -- Fraction of members sharing the cluster's modal tag combo (0..1).
  tag_homogeneity   numeric,
  -- Fraction of members whose tags were manually confirmed (tag_source='manual').
  manual_tag_frac   numeric,
  confidence_tier   text not null default 'visual_only'
                      check (confidence_tier in ('corroborated','probable','visual_only')),
  -- Representative creative for the thumbnail (highest-spend member).
  representative_ad_id text,
  -- Clustering params for provenance / reproducibility.
  threshold         numeric,
  model             text,
  created_at        timestamptz not null default now()
);

create index if not exists creative_clusters_account_idx
  on public.creative_clusters(account_id);
create index if not exists creative_clusters_account_spend_idx
  on public.creative_clusters(account_id, total_spend desc);

alter table public.creative_clusters enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='creative_clusters'
      and policyname='Builder/employee manage creative_clusters'
  ) then
    create policy "Builder/employee manage creative_clusters"
      on public.creative_clusters for all
      using (has_role(auth.uid(), 'builder'::app_role)
             or has_role(auth.uid(), 'employee'::app_role));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='creative_clusters'
      and policyname='Client view linked creative_clusters'
  ) then
    create policy "Client view linked creative_clusters"
      on public.creative_clusters for select
      using (has_role(auth.uid(), 'client'::app_role)
             and account_id in (select get_user_account_ids(auth.uid())));
  end if;
end $$;

-- ─── match_creatives — cosine nearest-neighbours within one account ──────────
-- Used by the clustering edge fn (threshold agglomeration) via the service-role
-- client. SECURITY DEFINER + scoped to a single account arg; NOT exposed to the
-- browser (the read path is the RPC below, wrapped by an edge fn).
create or replace function public.match_creatives(
  p_account_id     text,
  p_query_embedding vector(512),
  p_match_threshold float default 0.7,
  p_match_count     int   default 200,
  p_exclude_ad_id   text  default null
)
returns table(ad_id text, similarity float)
language sql
stable
security definer
set search_path = public
as $$
  select ce.ad_id,
         1 - (ce.embedding <=> p_query_embedding) as similarity
  from public.creative_embeddings ce
  where ce.account_id = p_account_id
    and ce.embedding is not null
    and (p_exclude_ad_id is null or ce.ad_id <> p_exclude_ad_id)
    and 1 - (ce.embedding <=> p_query_embedding) >= p_match_threshold
  order by ce.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- ─── rpc_entity_report — the read model for the cluster browser ──────────────
-- Returns:
--   • a single-row headline (total creatives, embedded coverage %, distinct
--     entities, spend-weighted "effective entities" via inverse Herfindahl),
--   • per-cluster rows (ranked by spend, with confidence tier + representative).
-- Effective entities = 1 / sum(share_i^2) over per-cluster spend shares — the
-- diversity number that collapses toward 1 when spend concentrates in one entity
-- (matching the competitor's "84 ads → 11 entities → 4.2 effective" framing).
--
-- SECURITY DEFINER and TRUSTS p_account_id → authenticated EXECUTE is REVOKED
-- below (IDOR guard). Only the service-role caller (the entity-report edge fn,
-- which verifies the session JWT + account ownership first) may invoke it.
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

  select count(*) into v_clustered
    from public.creatives
    where account_id = p_account_id and cluster_id is not null;

  select count(*), coalesce(sum(total_spend), 0)
    into v_n_clusters, v_cluster_spend
    from public.creative_clusters where account_id = p_account_id;

  -- Effective entities = inverse Herfindahl of spend shares. Guard div-by-zero:
  -- when there is no cluster spend, effective entities is just the cluster count
  -- (or 0 when there are none).
  if v_cluster_spend > 0 then
    select 1.0 / nullif(sum(power(total_spend / v_cluster_spend, 2)), 0)
      into v_effective
      from public.creative_clusters
      where account_id = p_account_id and total_spend > 0;
  else
    v_effective := v_n_clusters;
  end if;

  v_headline := jsonb_build_object(
    'total_creatives',   v_total_creatives,
    'embedded_creatives', v_embedded,
    'clustered_creatives', v_clustered,
    'coverage_pct',      case when v_total_creatives > 0
                              then round(100.0 * v_embedded / v_total_creatives, 1)
                              else 0 end,
    'distinct_entities', v_n_clusters,
    'effective_entities', round(coalesce(v_effective, 0), 2),
    'cluster_spend',     v_cluster_spend
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
             case when v_cluster_spend > 0
                  then round(100.0 * cl.total_spend / v_cluster_spend, 1)
                  else 0 end as spend_share_pct
      from public.creative_clusters cl
      left join public.creatives rep on rep.ad_id = cl.representative_ad_id
      where cl.account_id = p_account_id
    ) c;

  return jsonb_build_object('headline', v_headline, 'clusters', v_clusters);
end;
$$;

-- ─── rpc_entity_cluster_members — drill-in: members of one cluster ───────────
-- Also SECURITY DEFINER + account-scoped; authenticated EXECUTE revoked. The
-- edge fn re-verifies the cluster belongs to the authorized account.
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
           c.tag_source, c.ai_visual_notes
    from public.creatives c
    where c.account_id = p_account_id
      and c.cluster_id = p_cluster_id
  ) m;
$$;

-- ─── IDOR guard: these SECURITY DEFINER fns trust p_account_id, so the
-- authenticated role must NOT be able to call them directly. Mirrors migration
-- 20260530210000 (rpc_hook_angle_leaderboard). Service role only; the
-- entity-report edge fn verifies JWT + account ownership then invokes.
revoke execute on function public.rpc_entity_report(text) from authenticated, anon;
revoke execute on function public.rpc_entity_cluster_members(text, uuid) from authenticated, anon;
revoke execute on function public.match_creatives(text, vector, float, int, text) from authenticated, anon;
