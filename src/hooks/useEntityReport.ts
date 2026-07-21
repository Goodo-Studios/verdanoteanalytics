import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// ─── Response shapes (mirror rpc_entity_report / rpc_entity_cluster_members) ──

export type ConfidenceTier = "exact" | "corroborated" | "probable" | "visual_only";

/** Signals that grouped an entity (from the blended clusterer). */
export type EntitySignal = "exact" | "visual" | "script" | "destination";

export interface EntityHeadline {
  total_creatives: number;
  embedded_creatives: number;
  analyzed_creatives: number;
  clustered_creatives: number;
  coverage_pct: number;
  analysis_coverage_pct: number;
  distinct_entities: number;
  effective_entities: number;
  cluster_spend: number;
}

export interface EntityCluster {
  id: string;
  label: string | null;
  n_creatives: number;
  total_spend: number;
  confidence_tier: ConfidenceTier;
  cv_roas: number | null;
  cv_ctr: number | null;
  cv_cpa: number | null;
  tag_homogeneity: number | null;
  manual_tag_frac: number | null;
  representative_ad_id: string | null;
  representative_thumbnail: string | null;
  representative_ad_name: string | null;
  // Per-cluster analysis coverage (US-007): how many members are analyzed /
  // carry a visual or script embedding, and analyzed % of the cluster.
  analyzed_members: number;
  visual_members: number;
  script_members: number;
  coverage_pct: number;
  // Signals that grouped this entity, in priority order (exact > visual/script
  // > destination). May be empty for an unanalyzed singleton.
  signals: EntitySignal[];
  spend_share_pct: number;
}

export interface EntityReport {
  headline: EntityHeadline | null;
  clusters: EntityCluster[];
}

export interface EntityClusterMember {
  ad_id: string;
  ad_name: string;
  thumbnail_url: string | null;
  preview_url: string | null;
  spend: number;
  roas: number;
  ctr: number;
  cpa: number;
  ad_type: string | null;
  person: string | null;
  style: string | null;
  product: string | null;
  hook: string | null;
  theme: string | null;
  tag_source: string | null;
  ai_visual_notes: string | null;
  analysis_status: string | null;
  destination_key: string | null;
}

// ─── Session-authed GET against the entity-report edge fn ────────────────────
// The edge fn verifies the JWT + account ownership, then invokes the
// IDOR-guarded SECURITY DEFINER RPCs. We always send the session access token.
async function entityFetch<T>(params: Record<string, string>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/entity-report?${qs}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `Entity report error: ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

/** Headline + ranked clusters for one account. */
export function useEntityReport(accountId?: string) {
  return useQuery<EntityReport>({
    queryKey: ["entity-report", accountId ?? "none"],
    queryFn: () => entityFetch<EntityReport>({ account_id: accountId! }),
    enabled: !!accountId,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Drill-in: members of a single cluster (lazy — only when a cluster is opened). */
export function useEntityClusterMembers(accountId?: string, clusterId?: string) {
  return useQuery<EntityClusterMember[]>({
    queryKey: ["entity-cluster-members", accountId ?? "none", clusterId ?? "none"],
    queryFn: async () => {
      const res = await entityFetch<{ members: EntityClusterMember[] }>({
        account_id: accountId!,
        cluster_id: clusterId!,
      });
      return res.members ?? [];
    },
    enabled: !!accountId && !!clusterId,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
