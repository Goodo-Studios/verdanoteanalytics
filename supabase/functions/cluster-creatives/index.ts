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
// BATCHING (audit 7.3, option B): every running ad is grouped, not just the newest 1,000.
// Complete linkage over one account (up to about 5,800 ads) needs an m by m matrix and is
// roughly cubic, so the account is read GROUPING_BATCH ads at a time, each batch is grouped on
// its own (clusterBatch), and the batch groups are merged by shared anchors and by complete
// linkage over their centres (mergeBatchGroups). See batched-grouping.ts.
//
// SCOPE: ACTIVE ads only. The Entity Report is a LIVE diversity signal — "is the
// content currently running in this account too similar or too diverse?" — so
// clustering only considers ad_status = 'ACTIVE'. Paused/old creatives are reset
// to cluster_id = null and excluded from the entity model. This also keeps each
// run small enough to finish comfortably (active set << full library).
//
// Auth: internal/service-role only. NOTE verify_jwt=false means the Supabase
// gateway does NOT enforce that — requireServiceRole() in the handler does.
// Body:
//   { account_id: string (required), threshold?: number (default 0.7) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import { GROUPING_BATCH, GROUPING_MAX_ADS, loadGroupingInputs } from "../_shared/grouping-inputs.ts";
import { loadAssetKeys } from "./asset-keys.ts";
import { saveEntities } from "./entity-writes.ts";
import { restampInSteps } from "./restamp.ts";
import { type ExistingEntityRow, loadExistingEntityRows, retireEntities } from "./entity-reads.ts";
import {
  clusterBatch,
  type GroupSummary,
  groupKey,
  mergeBatchGroups,
  type Participant,
  sharedDestination,
} from "./batched-grouping.ts";
import {
  blendedTier,
  type CandidateGroup,
  clusterLabel,
  clusterStats,
  effectiveEntities,
  type ExistingEntity,
  matchGroupsToEntities,
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

// Turn one batch of creative rows into participants: parse their embeddings, resolve asset ids to
// asset keys (the primary exact anchor), and keep only ads that can cluster (an embedding in any
// modality, or at least one anchor).
async function buildParticipants(
  creatives: Record<string, unknown>[],
  embeddings: Map<string, Record<string, unknown>>,
): Promise<Participant[]> {
  const embById = new Map<string, number[]>();
  const visualById = new Map<string, number[]>();
  const scriptById = new Map<string, number[]>();
  for (const [adId, row] of embeddings) {
    const e = parseEmbedding(row.embedding);
    if (e) embById.set(adId, e);
    const ve = parseEmbedding(row.visual_embedding);
    if (ve) visualById.set(adId, ve);
    const se = parseEmbedding(row.script_embedding);
    if (se) scriptById.set(adId, se);
  }

  const participants: Participant[] = [];
  const assetIdSet = new Set<string>();
  for (const row of creatives) {
    const adId = row.ad_id as string;
    if (row.thumb_asset_id) assetIdSet.add(row.thumb_asset_id as string);
    if (row.video_asset_id) assetIdSet.add(row.video_asset_id as string);
    participants.push({
      ad_id: adId,
      embedding: embById.get(adId) ?? null,
      visualEmb: visualById.get(adId) ?? null,
      scriptEmb: scriptById.get(adId) ?? null,
      destinationKey: (row.destination_key as string) ?? null,
      assetKeys: [], // filled after the media_assets lookup
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

  const assetKeyById = await loadAssetKeys(db, [...assetIdSet]);
  const byAd = new Map(creatives.map((c) => [c.ad_id as string, c]));
  for (const p of participants) {
    const raw = byAd.get(p.ad_id);
    const keys: string[] = [];
    const thumb = raw?.thumb_asset_id as string | null | undefined;
    const video = raw?.video_asset_id as string | null | undefined;
    if (thumb && assetKeyById.has(thumb)) keys.push(assetKeyById.get(thumb)!);
    if (video && assetKeyById.has(video)) keys.push(assetKeyById.get(video)!);
    p.assetKeys = keys;
  }

  return participants.filter(
    (p) =>
      p.embedding || p.visualEmb || p.scriptEmb ||
      p.assetKeys.length || p.metaVideoIds.length || p.metaImageHashes.length,
  );
}

Deno.serve(async (req) => {

  // verify_jwt = false: the Supabase gateway does NOT authenticate this endpoint,
  // so this check is the only gate. Live pg_cron jobs and function-to-function
  // calls forward the real service-role key. See _shared/internal-auth.ts.
  const authFailure = await requireServiceRole(req);
  if (authFailure) return authFailure;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const accountId: string | undefined = body.account_id;
  if (!accountId) return json({ error: "account_id required" }, 400);
  const threshold: number = Number.isFinite(body.threshold) ? Number(body.threshold) : 0.7;

  // 1-3. Read the account's running ads one batch at a time, newest first, and group each batch
  //      on its own. Only a small summary of each group is kept, so a batch's embeddings (note,
  //      visual and script vectors, US-003/US-006) are released before the next batch loads.
  const columns =
    "ad_id, ad_name, spend, roas, ctr, cpa, tag_source, ad_type, person, style, product, hook, theme, meta_video_ids, meta_image_hashes, thumb_asset_id, video_asset_id, destination_key";
  const batchGroups: GroupSummary[] = [];
  const seenAds = new Set<string>();
  let participantCount = 0;
  let batchCount = 0;
  let hitCeiling = false;
  for (let offset = 0; ; offset += GROUPING_BATCH) {
    if (offset >= GROUPING_MAX_ADS) { hitCeiling = true; break; }
    let inputs;
    try {
      inputs = await loadGroupingInputs(db, accountId, columns, GROUPING_BATCH, offset);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
    batchCount++;
    // New ads arriving mid-run shift the pages; an ad seen in an earlier batch is skipped.
    const fresh = inputs.creatives.filter((c) => !seenAds.has(String(c.ad_id)));
    for (const c of fresh) seenAds.add(String(c.ad_id));

    let items: Participant[];
    try {
      items = await buildParticipants(fresh, inputs.embeddings);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
    participantCount += items.length;
    batchGroups.push(...clusterBatch(items, threshold));

    if (inputs.creatives.length < GROUPING_BATCH) break;
  }
  if (batchGroups.length === 0) {
    return json({ ok: true, clusters: 0, clustered: 0, effective_entities: 0, note: "no embeddings/anchors for account" });
  }

  // Merge the batches: shared anchors are one unit, the rest by complete linkage over centres.
  const groups = mergeBatchGroups(batchGroups, threshold);

  // 4. Existing entities for the account (for match-not-regenerate).
  //    Paged, so accounts with more than 1,000 groups see all of them (7.3 follow-up).
  let existRows: ExistingEntityRow[];
  try {
    existRows = await loadExistingEntityRows(db, accountId);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
  const existing: ExistingEntity[] = existRows.map((r) => {
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
  const built = groups.map((g) => ({
    group: g,
    key: groupKey(g),
    // Centroid for identity re-match prefers the note embedding, then visual, then script,
    // whichever the members carry (so matching is stable across runs).
    centroid: g.noteCentroid ?? g.visualCentroid ?? g.scriptCentroid,
    sharedDestination: sharedDestination(g),
  }));

  const candidates: CandidateGroup[] = built.map((g) => ({
    key: g.key, size: g.group.memberIds.length, centroid: g.centroid,
    assetKeys: g.group.assetKeys, metaVideoIds: g.group.metaVideoIds, metaImageHashes: g.group.metaImageHashes,
  }));
  const matched = matchGroupsToEntities(candidates, existing, threshold);

  // 6. Upsert entities in place (persistent ids), then restamp members. restampInSteps
  //    changes only creatives whose stamp differs, a few hundred per database call, so
  //    the largest accounts stay under the 8 second statement limit (7.3 follow-up).
  //    A failure part way never leaves the account unclustered (audit 5.10): every
  //    creative keeps either its previous stamp or its new one, and both entities
  //    still exist because stale entities are only retired in step 7.
  const stamps: Array<{ ad_id: string; cluster_id: string; confidence: string }> = [];
  const entityRows: Record<string, unknown>[] = [];

  const assignedIds: string[] = [];
  const clusterSpends: number[] = [];
  let clusteredCount = 0;
  let reused = 0, minted = 0;
  const tierCounts: Record<string, number> = { exact: 0, corroborated: 0, probable: 0, visual_only: 0 };
  const nowIso = new Date().toISOString();

  for (let gi = 0; gi < built.length; gi++) {
    const g = built[gi];
    const members = g.group.metrics;
    const stats = clusterStats(members);
    const tier = blendedTier({
      isExact: g.group.isExact,
      visualCoherent: g.group.visualCoherent,
      scriptCoherent: g.group.scriptCoherent,
      hasManual: stats.manual_tag_frac > 0,
      nMembers: members.length,
      sharedDestination: g.sharedDestination,
    });
    const totalSpend = members.reduce((s, m) => s + m.spend, 0);
    const repId = representativeAdId(members);
    const adNameById = new Map(g.group.adNames);
    const label = clusterLabel(members, repId ? adNameById.get(repId) : undefined);

    const entityId = matched[gi] ?? crypto.randomUUID();
    if (matched[gi]) reused++; else minted++;
    assignedIds.push(entityId);

    entityRows.push({
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
      asset_keys: g.group.assetKeys,
      meta_video_ids: g.group.metaVideoIds,
      meta_image_hashes: g.group.metaImageHashes,
      last_seen_at: nowIso,
    });

    for (const adId of g.group.memberIds) stamps.push({ ad_id: adId, cluster_id: entityId, confidence: tier });

    clusterSpends.push(totalSpend);
    clusteredCount += members.length;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }

  // Groups are saved in chunks of 50 (entity-writes.ts), before any member is restamped.
  try {
    await saveEntities(db, entityRows);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  try {
    await restampInSteps(db, accountId, stamps);
  } catch (e) {
    return json({ error: `member stamp: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  // 7. Retire entities not seen this run (empty). Ids are UUIDs — never reused.
  const assignedSet = new Set(assignedIds);
  const staleIds = existing.map((e) => e.id).filter((id) => !assignedSet.has(id));
  let retired: number;
  try {
    retired = await retireEntities(db, staleIds);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  return json({
    ok: true,
    threshold,
    participants: participantCount,
    batches: batchCount,
    capped: hitCeiling,
    clustered: clusteredCount,
    clusters: assignedIds.length,
    entities_reused: reused,
    entities_minted: minted,
    entities_retired: retired,
    effective_entities: Math.round(effectiveEntities(clusterSpends) * 100) / 100,
    tier_counts: tierCounts,
  });
});
