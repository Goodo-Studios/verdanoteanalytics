// entity-clustering — pure, testable helpers for the Entity Report (Feature 2).
//
// v1 is TEXT-based: each creative's feature text (ai_visual_notes + parsed tags)
// is embedded via the vault-embed OpenRouter path, stored in creative_embeddings,
// then clustered here by cosine similarity with single-linkage agglomeration at a
// threshold (~0.7). Confidence tiers come from within-cluster delivery cohesion
// (CV of ROAS/CTR/CPA) + tag homogeneity + manual-tag presence.
//
// No Deno / network imports — kept import-free so `deno test` runs it directly.

export interface CreativeTags {
  ad_type?: string | null;
  person?: string | null;
  style?: string | null;
  product?: string | null;
  hook?: string | null;
  theme?: string | null;
}

export interface CreativeFeatureInput extends CreativeTags {
  ad_id: string;
  ai_visual_notes?: string | null;
  tag_source?: string | null;
}

export interface CreativeMetrics {
  ad_id: string;
  spend: number;
  roas: number;
  ctr: number;
  cpa: number;
  tag_source?: string | null;
  tags: CreativeTags;
}

export type ConfidenceTier = "corroborated" | "probable" | "visual_only";

// ─── Feature text ────────────────────────────────────────────────────────────

const TAG_KEYS: (keyof CreativeTags)[] = [
  "ad_type", "person", "style", "product", "hook", "theme",
];

/**
 * Build the text blob embedded for a creative. Combines ai_visual_notes with the
 * six parsed tag dimensions (labeled, so the embedder sees structure). Returns
 * `null` when there is nothing meaningful to embed — callers SKIP these creatives
 * (v1 does not cluster untagged/unnoted ads) and surface them as coverage loss.
 */
export function buildFeatureText(c: CreativeFeatureInput): string | null {
  const parts: string[] = [];
  const notes = (c.ai_visual_notes ?? "").trim();
  if (notes) parts.push(notes);

  const tagParts: string[] = [];
  for (const k of TAG_KEYS) {
    const v = (c[k] ?? "").toString().trim();
    if (v) tagParts.push(`${k}: ${v}`);
  }
  if (tagParts.length) parts.push(tagParts.join(", "));

  if (parts.length === 0) return null;
  // token budget guard, mirrors vault-embed's 8000-char slice
  return parts.join("\n\n").slice(0, 8000);
}

// ─── Vector math ───────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("vector length mismatch");
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── Agglomerative (single-linkage) clustering at a cosine threshold ─────────

export interface EmbeddedCreative {
  ad_id: string;
  embedding: number[];
}

/**
 * Single-linkage agglomerative clustering via union-find: any two creatives with
 * cosine similarity >= threshold end up in the same cluster (transitively).
 * O(n^2) in pairwise comparisons — fine for a builder account's creative count
 * (hundreds to low-thousands); Phase 2 can swap in ANN if needed.
 *
 * Returns clusters as arrays of ad_ids, ordered largest-first for determinism.
 */
export function agglomerativeClusters(
  items: EmbeddedCreative[],
  threshold = 0.7,
): string[][] {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSimilarity(items[i].embedding, items[j].embedding) >= threshold) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(items[i].ad_id);
  }

  return [...groups.values()].sort((a, b) => b.length - a.length);
}

// ─── Statistics ──────────────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Coefficient of variation = stddev / mean (population stddev). Returns null when
 * the metric is undefined for cohesion (empty, or mean ~0 so CV is meaningless).
 * Lower CV == tighter within-cluster delivery == stronger corroboration.
 */
export function coefficientOfVariation(xs: number[]): number | null {
  const valid = xs.filter((x) => Number.isFinite(x));
  if (valid.length < 2) return null;
  const m = mean(valid);
  if (Math.abs(m) < 1e-9) return null;
  const variance = mean(valid.map((x) => (x - m) ** 2));
  return Math.sqrt(variance) / Math.abs(m);
}

// ─── Tag homogeneity ─────────────────────────────────────────────────────────

function tagKey(t: CreativeTags): string {
  return TAG_KEYS.map((k) => (t[k] ?? "").toString().trim().toLowerCase()).join("|");
}

/**
 * Fraction (0..1) of members that share the cluster's single most common tag
 * combination. 1.0 == every member carries identical tags.
 */
export function tagHomogeneity(members: CreativeMetrics[]): number {
  if (members.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const m of members) {
    const key = tagKey(m.tags);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const modal = Math.max(...counts.values());
  return modal / members.length;
}

export function manualTagFraction(members: CreativeMetrics[]): number {
  if (members.length === 0) return 0;
  const manual = members.filter((m) => m.tag_source === "manual").length;
  return manual / members.length;
}

// ─── Confidence tiers ────────────────────────────────────────────────────────

export interface ClusterStats {
  cv_roas: number | null;
  cv_ctr: number | null;
  cv_cpa: number | null;
  tag_homogeneity: number;
  manual_tag_frac: number;
  n_creatives: number;
}

/**
 * Compute cohesion stats for a cluster's members.
 */
export function clusterStats(members: CreativeMetrics[]): ClusterStats {
  return {
    cv_roas: coefficientOfVariation(members.map((m) => m.roas)),
    cv_ctr: coefficientOfVariation(members.map((m) => m.ctr)),
    cv_cpa: coefficientOfVariation(members.map((m) => m.cpa)),
    tag_homogeneity: tagHomogeneity(members),
    manual_tag_frac: manualTagFraction(members),
    n_creatives: members.length,
  };
}

// Thresholds — CV below this counts as "cohesive" delivery. Chosen conservatively
// for v1; tune once builder-account clusters are eyeballed.
const CV_COHESION_MAX = 0.5;
const HOMOGENEITY_MIN = 0.6;

/**
 * Assign a confidence tier from cohesion stats:
 *   • corroborated — delivery is cohesive (majority of available CVs are low)
 *     AND tags are homogeneous. The visual/text cluster is backed by both tag
 *     agreement and consistent delivery behavior.
 *   • probable     — one signal holds (either cohesive delivery OR homogeneous
 *     tags, or manual tags are present) but not the full corroboration.
 *   • visual_only  — clustered on text/tags alone with no corroborating signal
 *     (also the tier for singletons, which have no within-cluster variance).
 */
export function confidenceTier(stats: ClusterStats): ConfidenceTier {
  // Singletons cannot be corroborated by within-cluster cohesion.
  if (stats.n_creatives < 2) {
    return stats.manual_tag_frac >= 1 ? "probable" : "visual_only";
  }

  const cvs = [stats.cv_roas, stats.cv_ctr, stats.cv_cpa].filter(
    (v): v is number => v !== null,
  );
  const cohesiveCount = cvs.filter((v) => v <= CV_COHESION_MAX).length;
  const deliveryCohesive = cvs.length > 0 && cohesiveCount >= Math.ceil(cvs.length / 2);
  const tagsHomogeneous = stats.tag_homogeneity >= HOMOGENEITY_MIN;
  const hasManual = stats.manual_tag_frac > 0;

  if (deliveryCohesive && tagsHomogeneous) return "corroborated";
  if (deliveryCohesive || tagsHomogeneous || hasManual) return "probable";
  return "visual_only";
}

// ─── Cluster labeling & representative selection ─────────────────────────────

/**
 * Human label from the modal tag combo (theme / hook / product preferred, since
 * those read as an "entity"). Falls back to the highest-spend member's ad_name.
 */
export function clusterLabel(members: CreativeMetrics[], fallbackName?: string): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    const bits = [m.tags.theme, m.tags.product, m.tags.hook]
      .map((x) => (x ?? "").toString().trim())
      .filter(Boolean);
    const key = bits.join(" · ");
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return fallbackName?.trim() || "Untitled entity";
}

/** Highest-spend member becomes the representative thumbnail. */
export function representativeAdId(members: CreativeMetrics[]): string | null {
  if (members.length === 0) return null;
  return members.reduce((best, m) => (m.spend > best.spend ? m : best)).ad_id;
}

/**
 * Spend-weighted "effective entities" = inverse Herfindahl of per-cluster spend
 * shares. Collapses toward 1 when spend concentrates in a single entity; equals
 * the cluster count when spend is perfectly even. Mirrors the SQL in
 * rpc_entity_report so the batch fn and the read RPC agree.
 */
export function effectiveEntities(clusterSpends: number[]): number {
  const total = clusterSpends.reduce((s, x) => s + x, 0);
  if (total <= 0) return clusterSpends.length;
  const sumSq = clusterSpends
    .filter((s) => s > 0)
    .reduce((acc, s) => acc + (s / total) ** 2, 0);
  return sumSq > 0 ? 1 / sumSq : clusterSpends.length;
}
