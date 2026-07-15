// cluster-creatives — Entity Report (Feature 2), v1 TEXT clustering, step 2.
//
// Reads creative_embeddings + delivery metrics for one account, runs cosine
// single-linkage agglomeration (threshold ~0.7), computes confidence tiers from
// within-cluster delivery cohesion + tag homogeneity + manual-tag presence, then
// (re)writes creative_clusters and stamps cluster_id / cluster_confidence back
// onto creatives.
//
// Auth model: internal / service-role only (mirrors backfill-* + vault-embed).
// Invoked by the orchestrator with the service-role bearer; NOT linked from any
// client. Registered verify_jwt = false. No pg_cron wiring in v1 (invokable only).
//
// Body: { account_id: string (required), threshold?: number (default 0.7) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import {
  agglomerativeClusters,
  clusterLabel,
  clusterStats,
  confidenceTier,
  type CreativeMetrics,
  effectiveEntities,
  type EmbeddedCreative,
  representativeAdId,
} from "../_shared/entity-clustering.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "openai/text-embedding-3-small";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// pgvector columns come back over PostgREST as a JSON string like "[0.1,0.2,...]".
function parseEmbedding(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const accountId: string | undefined = body.account_id;
  if (!accountId) return json({ error: "account_id required" }, 400);
  const threshold: number = Number.isFinite(body.threshold) ? Number(body.threshold) : 0.7;

  // 1. Embeddings for the account.
  const { data: embRows, error: embErr } = await db
    .from("creative_embeddings")
    .select("ad_id, embedding")
    .eq("account_id", accountId);
  if (embErr) return json({ error: embErr.message }, 500);

  const embedded: EmbeddedCreative[] = [];
  for (const r of embRows ?? []) {
    const e = parseEmbedding((r as { embedding: unknown }).embedding);
    if (e) embedded.push({ ad_id: (r as { ad_id: string }).ad_id, embedding: e });
  }
  if (embedded.length === 0) {
    return json({ ok: true, clusters: 0, clustered: 0, effective_entities: 0,
      note: "no embeddings for account — run creative-embed first" });
  }

  // 2. Delivery metrics + tags for cohesion / confidence.
  const adIds = embedded.map((e) => e.ad_id);
  const metricsById = new Map<string, CreativeMetrics>();
  const adNameById = new Map<string, string>();
  // Chunk the IN() filter to stay under PostgREST URL limits.
  for (let i = 0; i < adIds.length; i += 500) {
    const chunk = adIds.slice(i, i + 500);
    const { data: rows, error } = await db
      .from("creatives")
      .select("ad_id, ad_name, spend, roas, ctr, cpa, tag_source, ad_type, person, style, product, hook, theme")
      .in("ad_id", chunk);
    if (error) return json({ error: error.message }, 500);
    for (const c of rows ?? []) {
      const row = c as Record<string, unknown>;
      metricsById.set(row.ad_id as string, {
        ad_id: row.ad_id as string,
        spend: Number(row.spend) || 0,
        roas: Number(row.roas) || 0,
        ctr: Number(row.ctr) || 0,
        cpa: Number(row.cpa) || 0,
        tag_source: (row.tag_source as string) ?? null,
        tags: {
          ad_type: row.ad_type as string, person: row.person as string,
          style: row.style as string, product: row.product as string,
          hook: row.hook as string, theme: row.theme as string,
        },
      });
      if (row.ad_name) adNameById.set(row.ad_id as string, row.ad_name as string);
    }
  }

  // 3. Cluster.
  const groups = agglomerativeClusters(embedded, threshold);

  // 4. Reset prior assignments for the account (idempotent re-run).
  await db.from("creatives")
    .update({ cluster_id: null, cluster_confidence: null })
    .eq("account_id", accountId);
  await db.from("creative_clusters").delete().eq("account_id", accountId);

  // 5. Build + insert clusters, then stamp members.
  const clusterSpends: number[] = [];
  let clusteredCount = 0;
  const tierCounts = { corroborated: 0, probable: 0, visual_only: 0 };

  for (const group of groups) {
    const members = group
      .map((id) => metricsById.get(id))
      .filter((m): m is CreativeMetrics => !!m);
    if (members.length === 0) continue;

    const stats = clusterStats(members);
    const tier = confidenceTier(stats);
    const totalSpend = members.reduce((s, m) => s + m.spend, 0);
    const repId = representativeAdId(members);
    const label = clusterLabel(members, repId ? adNameById.get(repId) : undefined);

    const { data: inserted, error: insErr } = await db
      .from("creative_clusters")
      .insert({
        account_id: accountId,
        label,
        n_creatives: members.length,
        total_spend: totalSpend,
        cv_roas: stats.cv_roas,
        cv_ctr: stats.cv_ctr,
        cv_cpa: stats.cv_cpa,
        tag_homogeneity: stats.tag_homogeneity,
        manual_tag_frac: stats.manual_tag_frac,
        confidence_tier: tier,
        representative_ad_id: repId,
        threshold,
        model: MODEL,
      })
      .select("id")
      .single();
    if (insErr) return json({ error: `cluster insert: ${insErr.message}` }, 500);

    const clusterId = (inserted as { id: string }).id;
    const memberIds = members.map((m) => m.ad_id);
    for (let i = 0; i < memberIds.length; i += 500) {
      const chunk = memberIds.slice(i, i + 500);
      const { error: upErr } = await db
        .from("creatives")
        .update({ cluster_id: clusterId, cluster_confidence: tier })
        .in("ad_id", chunk);
      if (upErr) return json({ error: `member stamp: ${upErr.message}` }, 500);
    }

    clusterSpends.push(totalSpend);
    clusteredCount += members.length;
    tierCounts[tier]++;
  }

  return json({
    ok: true,
    threshold,
    embedded_creatives: embedded.length,
    clustered: clusteredCount,
    clusters: clusterSpends.length,
    effective_entities: Math.round(effectiveEntities(clusterSpends) * 100) / 100,
    tier_counts: tierCounts,
  });
});
