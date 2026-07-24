// cluster-creatives — Entity Report (Feature 2), step 2. WS3 rewrite (US-005 +
// US-015): PERSISTENT entity identity.
//
// The v1 version deleted every cluster for the account and re-inserted with fresh
// gen_random_uuid()s each run, so an entity's id (and any history/tags/notes
// attached to it) was ephemeral. This version RESOLVES creatives to EXISTING
// entities instead of regenerating:
//   1. exact-anchor grouping (US-005) — creatives sharing an underlying asset
//      (media_assets.asset_key) or a Meta video_id / image_hash are one entity,
//      tier='exact', at zero model cost;
//   2. embedding agglomeration (cosine single-linkage, threshold ~0.7) merges the
//      rest, as before;
//   3. each resulting group is matched back to an existing entity by shared anchor
//      then by centroid similarity (matchGroupsToEntities) — same entity → SAME
//      id; only genuinely new groups mint a new id. Entity rows are upserted in
//      place (centroid + anchors + last_seen refreshed); entities no longer seen
//      are retired. A re-run with no new creatives reproduces identical entity ids.
//
// SCOPE: ACTIVE ads only. The Entity Report is a LIVE diversity signal — "is the
// content currently running in this account too similar or too diverse?" — so
// clustering only considers ad_status = 'ACTIVE'. Paused/old creatives are reset
// to cluster_id = null and excluded from the entity model. This also keeps each
// run small enough to finish comfortably (active set << full library).
//
// Auth: internal/service-role only (verify_jwt=false). Body:
//   { account_id: string (required), threshold?: number (default 0.7) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import {
  blendedTier,
  type CandidateGroup,
  centroid,
  clusterLabel,
  clusterStats,
  cosineSimilarity,
  type CreativeMetrics,
  effectiveEntities,
  type ExistingEntity,
  matchGroupsToEntities,
  modalityCoherent,
  representativeAdId,
} from "../_shared/entity-clustering.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "openai/text-embedding-3-small";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// pgvector columns come back over PostgREST as a JSON string "[0.1,0.2,...]".
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

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? (v as unknown[]).map(String).filter(Boolean) : [];

// Union-find over an index space.
function makeUF(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

interface Participant {
  ad_id: string;
  embedding: number[] | null;
  visualEmb: number[] | null;
  scriptEmb: number[] | null;
  destinationKey: string | null;
  assetKeys: string[];
  metaVideoIds: string[];
  metaImageHashes: string[];
  metrics: CreativeMetrics;
  ad_name?: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const accountId: string | undefined = body.account_id;
  if (!accountId) return json({ error: "account_id required" }, 400);
  const threshold: number = Number.isFinite(body.threshold) ? Number(body.threshold) : 0.7;

  // 1. Embeddings for the account — note (v1), plus the multi-modal visual + script
  //    vectors (US-003) that US-006 blends.
  const { data: embRows, error: embErr } = await db
    .from("creative_embeddings")
    .select("ad_id, embedding, visual_embedding, script_embedding")
    .eq("account_id", accountId);
  if (embErr) return json({ error: embErr.message }, 500);
  const embById = new Map<string, number[]>();
  const visualById = new Map<string, number[]>();
  const scriptById = new Map<string, number[]>();
  for (const r of embRows ?? []) {
    const row = r as Record<string, unknown>;
    const adId = row.ad_id as string;
    const e = parseEmbedding(row.embedding);
    if (e) embById.set(adId, e);
    const ve = parseEmbedding(row.visual_embedding);
    if (ve) visualById.set(adId, ve);
    const se = parseEmbedding(row.script_embedding);
    if (se) scriptById.set(adId, se);
  }

  // 2. Creatives (metrics + anchors) for the whole account, chunked.
  const participants: Participant[] = [];
  const assetIdSet = new Set<string>();
  const rawByAd = new Map<string, { thumb_asset_id?: string | null; video_asset_id?: string | null }>();
  {
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data: rows, error } = await db
        .from("creatives")
        .select("ad_id, ad_name, spend, roas, ctr, cpa, tag_source, ad_type, person, style, product, hook, theme, meta_video_ids, meta_image_hashes, thumb_asset_id, video_asset_id, destination_key")
        .eq("account_id", accountId)
        // LIVE diversity signal: cluster only currently-active creative. Paused/old
        // ads are reset to cluster_id = null (below) and stay out of the entity model.
        .eq("ad_status", "ACTIVE")
        .range(from, from + PAGE - 1);
      if (error) return json({ error: error.message }, 500);
      const batch = rows ?? [];
      for (const c of batch) {
        const row = c as Record<string, unknown>;
        const adId = row.ad_id as string;
        if (row.thumb_asset_id) assetIdSet.add(row.thumb_asset_id as string);
        if (row.video_asset_id) assetIdSet.add(row.video_asset_id as string);
        rawByAd.set(adId, {
          thumb_asset_id: row.thumb_asset_id as string | null,
          video_asset_id: row.video_asset_id as string | null,
        });
        participants.push({
          ad_id: adId,
          embedding: embById.get(adId) ?? null,
          visualEmb: visualById.get(adId) ?? null,
          scriptEmb: scriptById.get(adId) ?? null,
          destinationKey: (row.destination_key as string) ?? null,
          assetKeys: [], // filled after media_assets lookup
          metaVideoIds: arr(row.meta_video_ids),
          metaImageHashes: arr(row.meta_image_hashes),
          ad_name: (row.ad_name as string) ?? undefined,
          metrics: {
            ad_id: adId,
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
          },
        });
      }
      if (batch.length < PAGE) break;
      from += PAGE;
    }
  }

  // 2b. Resolve asset ids -> asset_key (the primary exact anchor).
  const assetKeyById = new Map<string, string>();
  const assetIds = [...assetIdSet];
  for (let i = 0; i < assetIds.length; i += 500) {
    const chunk = assetIds.slice(i, i + 500);
    const { data: assets } = await db.from("media_assets").select("id, asset_key").in("id", chunk);
    for (const a of assets ?? []) assetKeyById.set((a as { id: string }).id, (a as { asset_key: string }).asset_key);
  }
  for (const p of participants) {
    const raw = rawByAd.get(p.ad_id);
    const keys: string[] = [];
    if (raw?.thumb_asset_id && assetKeyById.has(raw.thumb_asset_id)) keys.push(assetKeyById.get(raw.thumb_asset_id)!);
    if (raw?.video_asset_id && assetKeyById.has(raw.video_asset_id)) keys.push(assetKeyById.get(raw.video_asset_id)!);
    p.assetKeys = keys;
  }

  // Only creatives that can cluster: any embedding modality OR at least one anchor.
  const items = participants.filter(
    (p) =>
      p.embedding || p.visualEmb || p.scriptEmb ||
      p.assetKeys.length || p.metaVideoIds.length || p.metaImageHashes.length,
  );
  if (items.length === 0) {
    return json({ ok: true, clusters: 0, clustered: 0, effective_entities: 0, note: "no embeddings/anchors for account" });
  }

  // 3. Grouping. Combined union-find + a parallel anchors-ONLY union-find (for the
  //    'exact' tier: a group whose every member is anchor-connected).
  const n = items.length;
  const combined = makeUF(n);
  const anchorOnly = makeUF(n);

  // 3a. Anchor unions (O(total anchors)): first index seen for an anchor value
  //     unions with every subsequent index carrying it.
  const firstForAnchor = new Map<string, number>();
  const anchorTag = (kind: string, v: string) => `${kind}:${v}`;
  items.forEach((p, i) => {
    const tags = [
      ...p.assetKeys.map((k) => anchorTag("a", k)),
      ...p.metaVideoIds.map((k) => anchorTag("v", k)),
      ...p.metaImageHashes.map((k) => anchorTag("h", k)),
    ];
    for (const t of tags) {
      if (firstForAnchor.has(t)) {
        combined.union(firstForAnchor.get(t)!, i);
        anchorOnly.union(firstForAnchor.get(t)!, i);
      } else {
        firstForAnchor.set(t, i);
      }
    }
  });

  // 3b. Embedding unions (O(m^2) per modality). Two creatives merge when they are
  //     similar on ANY modality — note (v1), visual, or script (US-006). The
  //     resulting group's TIER (below) then reflects HOW MANY modalities agreed.
  const unionByModality = (pick: (p: Participant) => number[] | null) => {
    const withEmb = items.map((p, i) => (pick(p) ? i : -1)).filter((i) => i >= 0);
    for (let a = 0; a < withEmb.length; a++) {
      for (let b = a + 1; b < withEmb.length; b++) {
        const i = withEmb[a], j = withEmb[b];
        if (cosineSimilarity(pick(items[i])!, pick(items[j])!) >= threshold) combined.union(i, j);
      }
    }
  };
  unionByModality((p) => p.embedding);
  unionByModality((p) => p.visualEmb);
  unionByModality((p) => p.scriptEmb);

  // Collect final groups.
  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = combined.find(i);
    if (!groupMap.has(r)) groupMap.set(r, []);
    groupMap.get(r)!.push(i);
  }
  const groups = [...groupMap.values()];

  // 4. Existing entities for the account (for match-not-regenerate).
  const { data: existRows, error: existErr } = await db
    .from("creative_clusters")
    .select("id, centroid, asset_keys, meta_video_ids, meta_image_hashes")
    .eq("account_id", accountId);
  if (existErr) return json({ error: existErr.message }, 500);
  const existing: ExistingEntity[] = (existRows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      centroid: parseEmbedding(row.centroid),
      assetKeys: arr(row.asset_keys),
      metaVideoIds: arr(row.meta_video_ids),
      metaImageHashes: arr(row.meta_image_hashes),
    };
  });

  // 5. Build candidate groups (anchors + centroid + stable key) and match.
  const built = groups.map((memberIdxs) => {
    const members = memberIdxs.map((i) => items[i]);
    const key = members.map((m) => m.ad_id).sort()[0];
    const assetKeys = [...new Set(members.flatMap((m) => m.assetKeys))];
    const metaVideoIds = [...new Set(members.flatMap((m) => m.metaVideoIds))];
    const metaImageHashes = [...new Set(members.flatMap((m) => m.metaImageHashes))];
    // Centroid for identity re-match prefers the note embedding, then visual, then
    // script — whichever the members carry (so matching is stable across runs).
    const cen = centroid(members.map((m) => m.embedding).filter((e): e is number[] => !!e)) ??
      centroid(members.map((m) => m.visualEmb).filter((e): e is number[] => !!e)) ??
      centroid(members.map((m) => m.scriptEmb).filter((e): e is number[] => !!e));
    // 'exact' iff >=2 members AND all members share one anchor-only component.
    const anchorRoots = new Set(memberIdxs.map((i) => anchorOnly.find(i)));
    const isExact = members.length >= 2 && anchorRoots.size === 1 &&
      (assetKeys.length > 0 || metaVideoIds.length > 0 || metaImageHashes.length > 0);
    // US-006 signal agreement: does each modality independently cohere?
    const visualCoherent = modalityCoherent(
      members.map((m) => m.visualEmb).filter((e): e is number[] => !!e), threshold);
    const scriptCoherent = modalityCoherent(
      members.map((m) => m.scriptEmb).filter((e): e is number[] => !!e), threshold);
    // Weak tiebreak: all members land on ONE non-null destination.
    const dests = new Set(members.map((m) => m.destinationKey).filter(Boolean));
    const sharedDestination = members.length >= 2 && dests.size === 1;
    return {
      members, key, assetKeys, metaVideoIds, metaImageHashes, centroid: cen,
      isExact, visualCoherent, scriptCoherent, sharedDestination,
    };
  });

  const candidates: CandidateGroup[] = built.map((g) => ({
    key: g.key, size: g.members.length, centroid: g.centroid,
    assetKeys: g.assetKeys, metaVideoIds: g.metaVideoIds, metaImageHashes: g.metaImageHashes,
  }));
  const matched = matchGroupsToEntities(candidates, existing, threshold);

  // 6. Reset denormalized member stamps (re-applied below), then upsert entities
  //    in place (persistent ids) and stamp members.
  await db.from("creatives").update({ cluster_id: null, cluster_confidence: null }).eq("account_id", accountId);

  const assignedIds: string[] = [];
  const clusterSpends: number[] = [];
  let clusteredCount = 0;
  let reused = 0, minted = 0;
  const tierCounts: Record<string, number> = { exact: 0, corroborated: 0, probable: 0, visual_only: 0 };
  const nowIso = new Date().toISOString();

  for (let gi = 0; gi < built.length; gi++) {
    const g = built[gi];
    const members = g.members.map((p) => p.metrics);
    const stats = clusterStats(members);
    const tier = blendedTier({
      isExact: g.isExact,
      visualCoherent: g.visualCoherent,
      scriptCoherent: g.scriptCoherent,
      hasManual: stats.manual_tag_frac > 0,
      nMembers: members.length,
      sharedDestination: g.sharedDestination,
    });
    const totalSpend = members.reduce((s, m) => s + m.spend, 0);
    const repId = representativeAdId(members);
    const adNameById = new Map(g.members.map((p) => [p.ad_id, p.ad_name]));
    const label = clusterLabel(members, repId ? adNameById.get(repId) : undefined);

    const entityId = matched[gi] ?? crypto.randomUUID();
    if (matched[gi]) reused++; else minted++;
    assignedIds.push(entityId);

    const { error: upErr } = await db.from("creative_clusters").upsert({
      id: entityId,
      account_id: accountId,
      label,
      n_creatives: members.length,
      total_spend: totalSpend,
      cv_roas: stats.cv_roas, cv_ctr: stats.cv_ctr, cv_cpa: stats.cv_cpa,
      tag_homogeneity: stats.tag_homogeneity, manual_tag_frac: stats.manual_tag_frac,
      confidence_tier: tier,
      representative_ad_id: repId,
      threshold, model: MODEL,
      centroid: g.centroid,
      asset_keys: g.assetKeys,
      meta_video_ids: g.metaVideoIds,
      meta_image_hashes: g.metaImageHashes,
      last_seen_at: nowIso,
    }, { onConflict: "id" });
    if (upErr) return json({ error: `entity upsert: ${upErr.message}` }, 500);

    const memberIds = g.members.map((p) => p.ad_id);
    for (let i = 0; i < memberIds.length; i += 500) {
      const chunk = memberIds.slice(i, i + 500);
      const { error: stampErr } = await db.from("creatives")
        .update({ cluster_id: entityId, cluster_confidence: tier }).in("ad_id", chunk);
      if (stampErr) return json({ error: `member stamp: ${stampErr.message}` }, 500);
    }

    clusterSpends.push(totalSpend);
    clusteredCount += members.length;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }

  // 7. Retire entities not seen this run (empty). Ids are UUIDs — never reused.
  let retired = 0;
  const staleIds = existing.map((e) => e.id).filter((id) => !assignedIds.includes(id));
  if (staleIds.length) {
    for (let i = 0; i < staleIds.length; i += 200) {
      const chunk = staleIds.slice(i, i + 200);
      const { error: delErr } = await db.from("creative_clusters").delete().in("id", chunk);
      if (!delErr) retired += chunk.length;
    }
  }

  return json({
    ok: true,
    threshold,
    participants: items.length,
    clustered: clusteredCount,
    clusters: assignedIds.length,
    entities_reused: reused,
    entities_minted: minted,
    entities_retired: retired,
    effective_entities: Math.round(effectiveEntities(clusterSpends) * 100) / 100,
    tier_counts: tierCounts,
  });
});
