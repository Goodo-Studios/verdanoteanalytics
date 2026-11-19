// Turns one batch of creative rows into grouping participants (audit plan item 7.3 follow-up).
//
// The raw embedding rows hold pgvector values as long JSON text (about 45 MB for a batch of 500
// ads with all three embedding types). Once a row is parsed its text is not needed again, so the
// rows are removed from the map as they are read. Holding them for the whole request was one of
// the causes of WORKER_RESOURCE_LIMIT on the two largest accounts.

import { loadAssetKeys } from "./asset-keys.ts";
import type { Participant } from "./batched-grouping.ts";

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

// pgvector columns come back over PostgREST as a JSON string "[0.1,0.2,...]".
export function parseEmbedding(v: unknown): number[] | null {
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

export const arr = (v: unknown): string[] =>
  Array.isArray(v) ? (v as unknown[]).map(String).filter(Boolean) : [];

/**
 * Parses the batch's embeddings (emptying `embeddings` as it goes), resolves asset ids to asset
 * keys (the primary exact anchor) and keeps only ads that can cluster: an embedding in any
 * modality, or at least one anchor.
 */
export async function buildParticipants(
  db: Db,
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
  embeddings.clear();

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
