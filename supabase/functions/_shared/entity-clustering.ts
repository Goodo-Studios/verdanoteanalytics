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
  // Rich analysis fields (analyze-creative → creatives, vault-parity columns).
  // Folded into the feature text so clustering can see the identity-bearing
  // signals the flat v1 blob ignored (brand, audience, narrative structure,
  // visual hook, format). All optional; absent ones are simply omitted.
  brand_name?: string | null;
  target_audience?: string | null;
  value_structure?: string | null;
  hook_visual?: string | null;
  hook_type?: string | null;
  industry?: string | null;
  ad_format?: string | null;
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

export type ConfidenceTier = "exact" | "corroborated" | "probable" | "visual_only";

// ─── Feature text ────────────────────────────────────────────────────────────

const TAG_KEYS: (keyof CreativeTags)[] = [
  "ad_type", "person", "style", "product", "hook", "theme",
];

// Rich analysis fields, in the order they enter the feature text. These are the
// identity-bearing signals from the upgraded analyze-creative output — a shared
// brand / audience / narrative structure / visual hook is exactly what makes two
// edits of the same ad concept cluster together. Ordered brand→format from most
// to least discriminative.
const RICH_KEYS: (keyof CreativeFeatureInput)[] = [
  "brand_name", "target_audience", "value_structure", "hook_visual",
  "hook_type", "ad_format", "industry",
];

/**
 * Build the text blob embedded for a creative. Combines ai_visual_notes, the rich
 * analysis fields (brand / audience / structure / visual hook / format), and the
 * six parsed tag dimensions — all labeled so the embedder sees structure. Returns
 * `null` when there is nothing meaningful to embed — callers SKIP these creatives
 * and surface them as coverage loss.
 *
 * v2 adds the RICH_KEYS block: the flat v1 blob was ai_visual_notes + tags only,
 * which starved clustering of the identity signals now available from the upgraded
 * analyze-creative output. Re-embedding with this richer text is what lets same-
 * concept variations resolve to one entity instead of scattering into singletons.
 */
export function buildFeatureText(c: CreativeFeatureInput): string | null {
  const parts: string[] = [];
  const notes = (c.ai_visual_notes ?? "").trim();
  if (notes) parts.push(notes);

  const richParts: string[] = [];
  for (const k of RICH_KEYS) {
    const v = (c[k] ?? "").toString().trim();
    if (v) richParts.push(`${k}: ${v}`);
  }
  if (richParts.length) parts.push(richParts.join("\n"));

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
// ─── Persistent entity identity (US-005 / US-015) ────────────────────────────
// The resolver below maps freshly-formed groups back to EXISTING entity ids
// (stable UUIDs) instead of regenerating them each run, so an entity keeps its id
// (and its history/tags/notes) across clustering passes.

export interface EntityAnchors {
  assetKeys: string[];       // media_assets.asset_key — PRIMARY within-account exact anchor
  metaVideoIds: string[];    // secondary exact anchors (US-014)
  metaImageHashes: string[];
}

// ─── Blended multi-signal confidence (US-006) ────────────────────────────────
// A modality (visual OR script embeddings) is "coherent" for a group when it has
// >=2 members carrying that embedding and every one sits within `threshold` of the
// modality centroid — i.e. the members genuinely agree on that axis.
export function modalityCoherent(embeddings: number[][], threshold: number): boolean {
  const vs = embeddings.filter((e) => Array.isArray(e) && e.length > 0);
  if (vs.length < 2) return false;
  const c = centroid(vs);
  if (!c) return false;
  return vs.every((v) => cosineSimilarity(v, c) >= threshold);
}

/**
 * Blend the signals into one honest confidence tier (US-006), most-trusted first:
 *   • exact        — grouped by a shared underlying asset (US-005); ground truth.
 *   • corroborated — BOTH visual AND script modalities agree (independent signals
 *     concur), optionally reinforced by a shared destination.
 *   • probable     — a single modality agrees (visual OR script), or a lone
 *     manual-tagged member; a shared destination can reinforce but is NEVER the
 *     sole basis for a merge.
 *   • visual_only  — weakest: clustered without two-signal corroboration (also the
 *     tier for singletons).
 */
export function blendedTier(opts: {
  isExact: boolean;
  visualCoherent: boolean;
  scriptCoherent: boolean;
  hasManual: boolean;
  nMembers: number;
  sharedDestination?: boolean; // all members land on one destination — weak tiebreak only
}): ConfidenceTier {
  if (opts.isExact) return "exact";
  if (opts.nMembers < 2) return opts.hasManual ? "probable" : "visual_only";
  if (opts.visualCoherent && opts.scriptCoherent) return "corroborated";
  if (opts.visualCoherent || opts.scriptCoherent) return "probable";
  // Same-destination is a WEAK corroborator: it can lift an otherwise-uncorroborated
  // multi-member group off the floor, but never to 'corroborated' and never as the
  // basis for the merge itself.
  if (opts.sharedDestination) return "probable";
  return "visual_only";
}

export interface ExistingEntity extends EntityAnchors {
  id: string;
  centroid: number[] | null; // stored mean embedding, for centroid fallback matching
}

export interface CandidateGroup extends EntityAnchors {
  key: string;               // deterministic group key (e.g. min ad_id) for stable ordering
  size: number;
  centroid: number[] | null;
}

// Mean of equal-length vectors → the entity centroid. null for empty input.
export function centroid(vectors: number[][]): number[] | null {
  const vs = vectors.filter((v) => Array.isArray(v) && v.length > 0);
  if (vs.length === 0) return null;
  const dim = vs[0].length;
  const acc = new Array(dim).fill(0);
  for (const v of vs) {
    for (let i = 0; i < dim; i++) acc[i] += v[i] ?? 0;
  }
  for (let i = 0; i < dim; i++) acc[i] /= vs.length;
  return acc;
}

function anchorsOverlap(a: EntityAnchors, b: EntityAnchors): boolean {
  const sets = [
    [a.assetKeys, b.assetKeys],
    [a.metaVideoIds, b.metaVideoIds],
    [a.metaImageHashes, b.metaImageHashes],
  ] as const;
  for (const [x, y] of sets) {
    if (x.length && y.length) {
      const s = new Set(x);
      if (y.some((v) => s.has(v))) return true;
    }
  }
  return false;
}

/**
 * Map each candidate group to an EXISTING entity id, or null when it should mint a
 * new one. Resolution order per group (US-015): (1) shared exact anchor
 * (asset_key / meta video id / image hash) with an existing entity; (2) else
 * nearest existing centroid within simThreshold; (3) else new. Each existing
 * entity is claimed by at most ONE group (prevents two groups grabbing the same
 * id). Deterministic: groups are processed largest-first then by key, so a re-run
 * over unchanged data reproduces the SAME assignments — the core stability
 * guarantee behind the persistent entity_id.
 */
export function matchGroupsToEntities(
  groups: CandidateGroup[],
  existing: ExistingEntity[],
  simThreshold = 0.7,
): (string | null)[] {
  const ordered = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (b.g.size - a.g.size) || a.g.key.localeCompare(b.g.key));

  const claimed = new Set<string>();
  const result: (string | null)[] = new Array(groups.length).fill(null);

  for (const { g, i } of ordered) {
    // (1) exact anchor overlap with an unclaimed entity.
    let match: string | null = null;
    for (const e of existing) {
      if (!claimed.has(e.id) && anchorsOverlap(g, e)) {
        match = e.id;
        break;
      }
    }
    // (2) nearest unclaimed centroid within threshold.
    if (!match && g.centroid) {
      let best: { id: string; sim: number } | null = null;
      for (const e of existing) {
        if (claimed.has(e.id) || !e.centroid) continue;
        const sim = cosineSimilarity(g.centroid, e.centroid);
        if (sim >= simThreshold && (!best || sim > best.sim)) best = { id: e.id, sim };
      }
      if (best) match = best.id;
    }
    if (match) {
      claimed.add(match);
      result[i] = match;
    }
  }
  return result;
}

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
