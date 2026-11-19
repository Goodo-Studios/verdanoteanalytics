// Batch-and-merge grouping for cluster-creatives (audit plan item 7.3, option B).
//
// One account can have about 5,800 running ads. Complete linkage over all of them needs an
// m by m matrix (about 136 MB) and is roughly cubic, so the edge function groups the account
// in batches instead:
//
//   1. clusterBatch    - group one batch with the same anchors and complete linkage as before,
//                        then keep only a small summary per group (centres, counts, anchors,
//                        metrics). The batch's embeddings are dropped before the next batch loads.
//   2. mergeBatchGroups - join groups from different batches. Groups that share an exact anchor
//                        (asset key, Meta video id, image hash) are one unit, because identity is
//                        transitive. Everything else is joined by COMPLETE linkage over the group
//                        centres at a similarity of 0.95 (MERGE_CENTRE_SIMILARITY), so the merge
//                        cannot chain the way single linkage did (97% of an account in one group,
//                        see index.ts).
//
// A merged group is "exact" only when its parts were joined through anchors alone, and it is
// coherent on a modality only when every part is and every part's centre sits within the
// threshold of the merged centre. Those are conservative stand-ins for the member by member
// checks a single pass makes, so a merged group never claims more confidence than its parts.

import {
  centroid,
  completeLinkageBlocks,
  cosineSimilarity,
  type CreativeMetrics,
  modalityCoherent,
} from "../_shared/entity-clustering.ts";

export interface Participant {
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

/** What is kept of a group once its batch's embeddings are released. */
export interface GroupSummary {
  memberIds: string[];
  metrics: CreativeMetrics[];
  /** [ad_id, ad_name] for each member, in the order of memberIds. */
  adNames: Array<[string, string | undefined]>;
  noteCentroid: number[] | null;
  noteCount: number;
  visualCentroid: number[] | null;
  visualCount: number;
  scriptCentroid: number[] | null;
  scriptCount: number;
  assetKeys: string[];
  metaVideoIds: string[];
  metaImageHashes: string[];
  isExact: boolean;
  visualCoherent: boolean;
  scriptCoherent: boolean;
  /** One destination key (or null) per member. */
  destinations: Array<string | null>;
}

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

const anchorTag = (kind: string, v: string) => `${kind}:${v}`;
const unique = (xs: string[]) => [...new Set(xs)];
const present = <T>(xs: Array<T | null>): T[] => xs.filter((x): x is T => !!x);

/** Stable key for a group: its lowest ad id. */
export function groupKey(g: { memberIds: string[] }): string {
  return [...g.memberIds].sort()[0];
}

/**
 * Group one batch. `items` must already be limited to ads that can cluster (an embedding or
 * at least one anchor). Complete linkage with anchor components as atomic seed blocks, exactly
 * as cluster-creatives did over one capped read.
 */
export function clusterBatch(items: Participant[], threshold: number): GroupSummary[] {
  const n = items.length;
  if (n === 0) return [];

  const combined = makeUF(n);
  const anchorOnly = makeUF(n);

  // Anchor unions: the first index seen for an anchor value unions with every later index.
  const firstForAnchor = new Map<string, number>();
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

  // Two ads are linkable when they are similar on ANY modality they both carry.
  const pairDistance = (i: number, j: number): number => {
    const a = items[i], b = items[j];
    let best = Infinity;
    if (a.embedding && b.embedding) best = Math.min(best, 1 - cosineSimilarity(a.embedding, b.embedding));
    if (a.visualEmb && b.visualEmb) best = Math.min(best, 1 - cosineSimilarity(a.visualEmb, b.visualEmb));
    if (a.scriptEmb && b.scriptEmb) best = Math.min(best, 1 - cosineSimilarity(a.scriptEmb, b.scriptEmb));
    return best;
  };

  const anchorBlockMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = combined.find(i);
    if (!anchorBlockMap.has(r)) anchorBlockMap.set(r, []);
    anchorBlockMap.get(r)!.push(i);
  }
  const seedBlocks = [...anchorBlockMap.values()].filter((b) => b.length > 1);

  const groups = completeLinkageBlocks(n, pairDistance, 1 - threshold, seedBlocks);

  return groups.map((memberIdxs) => {
    const members = memberIdxs.map((i) => items[i]);
    const notes = members.map((m) => m.embedding).filter((e): e is number[] => !!e);
    const visuals = members.map((m) => m.visualEmb).filter((e): e is number[] => !!e);
    const scripts = members.map((m) => m.scriptEmb).filter((e): e is number[] => !!e);
    const assetKeys = unique(members.flatMap((m) => m.assetKeys));
    const metaVideoIds = unique(members.flatMap((m) => m.metaVideoIds));
    const metaImageHashes = unique(members.flatMap((m) => m.metaImageHashes));
    const anchorRoots = new Set(memberIdxs.map((i) => anchorOnly.find(i)));
    const isExact = members.length >= 2 && anchorRoots.size === 1 &&
      (assetKeys.length > 0 || metaVideoIds.length > 0 || metaImageHashes.length > 0);
    return {
      memberIds: members.map((m) => m.ad_id),
      metrics: members.map((m) => m.metrics),
      adNames: members.map((m) => [m.ad_id, m.ad_name] as [string, string | undefined]),
      noteCentroid: centroid(notes),
      noteCount: notes.length,
      visualCentroid: centroid(visuals),
      visualCount: visuals.length,
      scriptCentroid: centroid(scripts),
      scriptCount: scripts.length,
      assetKeys,
      metaVideoIds,
      metaImageHashes,
      isExact,
      visualCoherent: modalityCoherent(visuals, threshold),
      scriptCoherent: modalityCoherent(scripts, threshold),
      destinations: members.map((m) => m.destinationKey ?? null),
    };
  });
}

// Member-weighted mean of the parts' centres for one modality.
function weightedCentre(parts: Array<{ c: number[] | null; n: number }>): number[] | null {
  const used = parts.filter((p) => p.c && p.n > 0);
  if (used.length === 0) return null;
  const dim = used[0].c!.length;
  const acc = new Array(dim).fill(0);
  let total = 0;
  for (const p of used) {
    for (let i = 0; i < dim; i++) acc[i] += (p.c![i] ?? 0) * p.n;
    total += p.n;
  }
  for (let i = 0; i < dim; i++) acc[i] /= total;
  return acc;
}

// Is the merged group coherent on one modality? Needs two or more members carrying it, every
// multi-member part coherent, and every part's centre within `threshold` of the merged centre.
function mergedCoherent(
  parts: Array<{ c: number[] | null; n: number; coherent: boolean }>,
  merged: number[] | null,
  threshold: number,
): boolean {
  const carrying = parts.filter((p) => p.n > 0 && p.c);
  const total = carrying.reduce((s, p) => s + p.n, 0);
  if (total < 2 || !merged) return false;
  return carrying.every((p) => (p.n === 1 || p.coherent) && cosineSimilarity(p.c!, merged) >= threshold);
}

/** Distance between two groups: the closest modality they both carry, as in clusterBatch. */
function groupDistance(a: GroupSummary, b: GroupSummary): number {
  let best = Infinity;
  if (a.noteCentroid && b.noteCentroid) best = Math.min(best, 1 - cosineSimilarity(a.noteCentroid, b.noteCentroid));
  if (a.visualCentroid && b.visualCentroid) best = Math.min(best, 1 - cosineSimilarity(a.visualCentroid, b.visualCentroid));
  if (a.scriptCentroid && b.scriptCentroid) best = Math.min(best, 1 - cosineSimilarity(a.scriptCentroid, b.scriptCentroid));
  return best;
}

/**
 * Centre similarity two batch groups need to merge. Higher than the 0.7 grouping threshold on
 * purpose: a group's centre is an average of its members, so two centres score as more similar
 * than their members do, and merging at 0.7 collapsed Bearaby's 1,862 embedded ads into 20
 * groups with a largest of 848, against 75 and 155 for one complete-linkage pass over the
 * members. Measured on Bearaby and Flatpack (2026-11-19), 0.95 lands closest to the single
 * pass: 84 and 46 groups against 75 and 44, largest 240 and 374 against 155 and 361.
 */
export const MERGE_CENTRE_SIMILARITY = 0.95;

/**
 * Merge groups made in different batches. Groups sharing an anchor are one unit; the rest join
 * by complete linkage over their centres at MERGE_CENTRE_SIMILARITY, or at `threshold` when the
 * caller asks for something stricter. The result does not depend on the order the groups
 * arrive in, and is sorted by each group's lowest ad id.
 */
export function mergeBatchGroups(groups: GroupSummary[], threshold: number): GroupSummary[] {
  const sorted = [...groups].sort((a, b) => groupKey(a).localeCompare(groupKey(b)));
  const n = sorted.length;
  if (n === 0) return [];

  const anchors = makeUF(n);
  const firstForAnchor = new Map<string, number>();
  sorted.forEach((g, i) => {
    const tags = [
      ...g.assetKeys.map((k) => anchorTag("a", k)),
      ...g.metaVideoIds.map((k) => anchorTag("v", k)),
      ...g.metaImageHashes.map((k) => anchorTag("h", k)),
    ];
    for (const t of tags) {
      if (firstForAnchor.has(t)) anchors.union(firstForAnchor.get(t)!, i);
      else firstForAnchor.set(t, i);
    }
  });
  const blockMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = anchors.find(i);
    if (!blockMap.has(r)) blockMap.set(r, []);
    blockMap.get(r)!.push(i);
  }
  const seedBlocks = [...blockMap.values()].filter((b) => b.length > 1);

  const mergeSimilarity = Math.max(threshold, MERGE_CENTRE_SIMILARITY);
  const joined = completeLinkageBlocks(n, (i, j) => groupDistance(sorted[i], sorted[j]), 1 - mergeSimilarity, seedBlocks);

  const out = joined.map((idxs) => {
    const parts = idxs.map((i) => sorted[i]);
    if (parts.length === 1) return parts[0];

    const noteCentroid = weightedCentre(parts.map((p) => ({ c: p.noteCentroid, n: p.noteCount })));
    const visualCentroid = weightedCentre(parts.map((p) => ({ c: p.visualCentroid, n: p.visualCount })));
    const scriptCentroid = weightedCentre(parts.map((p) => ({ c: p.scriptCentroid, n: p.scriptCount })));
    const assetKeys = unique(parts.flatMap((p) => p.assetKeys));
    const metaVideoIds = unique(parts.flatMap((p) => p.metaVideoIds));
    const metaImageHashes = unique(parts.flatMap((p) => p.metaImageHashes));
    const memberIds = parts.flatMap((p) => p.memberIds);

    // Exact only when the parts are one anchor component (joined by anchors alone) and no part
    // was itself grouped by similarity.
    const roots = new Set(idxs.map((i) => anchors.find(i)));
    const isExact = memberIds.length >= 2 && roots.size === 1 &&
      parts.every((p) => p.isExact || p.memberIds.length === 1) &&
      (assetKeys.length > 0 || metaVideoIds.length > 0 || metaImageHashes.length > 0);

    return {
      memberIds,
      metrics: parts.flatMap((p) => p.metrics),
      adNames: parts.flatMap((p) => p.adNames),
      noteCentroid,
      noteCount: parts.reduce((s, p) => s + p.noteCount, 0),
      visualCentroid,
      visualCount: parts.reduce((s, p) => s + p.visualCount, 0),
      scriptCentroid,
      scriptCount: parts.reduce((s, p) => s + p.scriptCount, 0),
      assetKeys,
      metaVideoIds,
      metaImageHashes,
      isExact,
      visualCoherent: mergedCoherent(
        parts.map((p) => ({ c: p.visualCentroid, n: p.visualCount, coherent: p.visualCoherent })),
        visualCentroid, threshold,
      ),
      scriptCoherent: mergedCoherent(
        parts.map((p) => ({ c: p.scriptCentroid, n: p.scriptCount, coherent: p.scriptCoherent })),
        scriptCentroid, threshold,
      ),
      destinations: parts.flatMap((p) => p.destinations),
    } satisfies GroupSummary;
  });

  return out.sort((a, b) => groupKey(a).localeCompare(groupKey(b)));
}

/** Same rule cluster-creatives used per group: every member lands on one non-null destination. */
export function sharedDestination(g: GroupSummary): boolean {
  const dests = new Set(present(g.destinations));
  return g.memberIds.length >= 2 && dests.size === 1;
}
