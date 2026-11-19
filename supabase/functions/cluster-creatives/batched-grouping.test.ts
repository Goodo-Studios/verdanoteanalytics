// Grouping every running ad, in batches (audit plan item 7.3 follow-up, option B).
//
// cluster-creatives grouped only an account's newest 1,000 running ads because complete
// linkage builds an m by m matrix (about 136 MB at 5,839 ads) and is roughly cubic. Matthew
// chose to cluster each batch on its own and merge the batches through their group centres,
// the way the nightly job already matches groups to stored groups.
//
// The merge must not bring back the chaining that complete linkage was introduced to stop
// (one group swallowing 97% of an account), so it runs complete linkage over the batch
// groups' centres instead of joining any two groups that are close.
//
//   deno test -A supabase/functions/cluster-creatives/batched-grouping.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// deno-lint-ignore no-explicit-any
const load = async (): Promise<any> => await import("./batched-grouping.ts");

const THRESHOLD = 0.7;

// deno-lint-ignore no-explicit-any
function participant(adId: string, note: number[] | null, extra: Record<string, any> = {}) {
  return {
    ad_id: adId,
    embedding: note,
    visualEmb: extra.visualEmb ?? null,
    scriptEmb: extra.scriptEmb ?? null,
    destinationKey: extra.destinationKey ?? null,
    assetKeys: extra.assetKeys ?? [],
    metaVideoIds: extra.metaVideoIds ?? [],
    metaImageHashes: extra.metaImageHashes ?? [],
    ad_name: extra.ad_name ?? adId,
    metrics: {
      ad_id: adId, spend: extra.spend ?? 10, roas: 1, ctr: 1, cpa: 1, tag_source: null,
      tags: { ad_type: "x", person: "x", style: "x", product: "x", hook: "x", theme: "x" },
    },
  };
}

const ids = (g: { memberIds: string[] }) => [...g.memberIds].sort();

Deno.test("one batch is grouped by complete linkage and summarised", async () => {
  const { clusterBatch } = await load();
  const groups = clusterBatch([
    participant("a1", [1, 0, 0]),
    participant("a2", [0.99, 0.05, 0]),
    participant("b1", [0, 1, 0]),
  ], THRESHOLD);
  assertEquals(groups.length, 2);
  const pair = groups.find((g: { memberIds: string[] }) => g.memberIds.length === 2);
  assertEquals(ids(pair), ["a1", "a2"]);
  assertEquals(pair.noteCount, 2);
  assert(pair.noteCentroid && pair.noteCentroid[0] > 0.9);
  assertEquals(pair.metrics.length, 2);
});

Deno.test("groups of the same theme from different batches merge into one", async () => {
  const { clusterBatch, mergeBatchGroups } = await load();
  const batch1 = clusterBatch([participant("a1", [1, 0, 0]), participant("a2", [0.98, 0.1, 0])], THRESHOLD);
  const batch2 = clusterBatch([participant("a3", [0.97, 0.05, 0.05]), participant("a4", [1, 0.02, 0])], THRESHOLD);
  assertEquals(batch1.length, 1);
  assertEquals(batch2.length, 1);
  const merged = mergeBatchGroups([...batch1, ...batch2], THRESHOLD);
  assertEquals(merged.length, 1);
  assertEquals(ids(merged[0]), ["a1", "a2", "a3", "a4"]);
  assertEquals(merged[0].noteCount, 4);
});

Deno.test("groups of different themes stay apart", async () => {
  const { clusterBatch, mergeBatchGroups } = await load();
  const batch1 = clusterBatch([participant("a1", [1, 0, 0]), participant("a2", [0.99, 0.05, 0])], THRESHOLD);
  const batch2 = clusterBatch([participant("b1", [0, 1, 0]), participant("b2", [0.05, 0.99, 0])], THRESHOLD);
  const merged = mergeBatchGroups([...batch1, ...batch2], THRESHOLD);
  assertEquals(merged.length, 2);
});

Deno.test("the merge does not chain: A near B and B near C does not put A, B and C together when A is far from C", async () => {
  const { mergeBatchGroups } = await load();
  // Unit vectors at 0, 40 and 80 degrees: cosine(A,B) = cosine(B,C) = 0.77, cosine(A,C) = 0.17.
  const at = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];
  const mk = (id: string, deg: number) => ({
    memberIds: [id], metrics: [participant(id, at(deg)).metrics], adNames: [[id, id]],
    noteCentroid: at(deg), noteCount: 1, visualCentroid: null, visualCount: 0, scriptCentroid: null, scriptCount: 0,
    assetKeys: [], metaVideoIds: [], metaImageHashes: [], isExact: false,
    visualCoherent: false, scriptCoherent: false, destinations: [null],
  });
  const merged = mergeBatchGroups([mk("A", 0), mk("B", 40), mk("C", 80)], THRESHOLD);
  assertEquals(merged.length, 2, "complete linkage joins at most two of the three");
  assert(merged.every((g: { memberIds: string[] }) => g.memberIds.length <= 2));
});

Deno.test("the merged centre is the member-weighted mean", async () => {
  const { clusterBatch, mergeBatchGroups } = await load();
  const batch1 = clusterBatch([
    participant("a1", [1, 0, 0]), participant("a2", [1, 0, 0]), participant("a3", [1, 0, 0]),
  ], THRESHOLD);
  const batch2 = clusterBatch([participant("a4", [0.8, 0.6, 0])], THRESHOLD);
  const merged = mergeBatchGroups([...batch1, ...batch2], THRESHOLD);
  assertEquals(merged.length, 1);
  const c = merged[0].noteCentroid;
  assert(Math.abs(c[0] - (3 + 0.8) / 4) < 1e-9, `x was ${c[0]}`);
  assert(Math.abs(c[1] - 0.6 / 4) < 1e-9, `y was ${c[1]}`);
});

Deno.test("groups sharing an asset key merge even when their centres differ", async () => {
  const { clusterBatch, mergeBatchGroups } = await load();
  const batch1 = clusterBatch([participant("a1", [1, 0, 0], { assetKeys: ["asset-1"] })], THRESHOLD);
  const batch2 = clusterBatch([participant("a2", [0, 1, 0], { assetKeys: ["asset-1"] })], THRESHOLD);
  const merged = mergeBatchGroups([...batch1, ...batch2], THRESHOLD);
  assertEquals(merged.length, 1);
  assertEquals(ids(merged[0]), ["a1", "a2"]);
  assertEquals(merged[0].assetKeys, ["asset-1"]);
});

Deno.test("a group joined only through shared anchors stays exact; one joined by centre similarity does not", async () => {
  const { clusterBatch, mergeBatchGroups } = await load();
  const exact1 = clusterBatch([
    participant("a1", [1, 0, 0], { assetKeys: ["k"] }), participant("a2", [0, 1, 0], { assetKeys: ["k"] }),
  ], THRESHOLD);
  const exact2 = clusterBatch([
    participant("a3", [0, 0, 1], { assetKeys: ["k"] }), participant("a4", [0, 0, 1], { assetKeys: ["k"] }),
  ], THRESHOLD);
  assertEquals(exact1[0].isExact, true);
  const viaAnchors = mergeBatchGroups([...exact1, ...exact2], THRESHOLD);
  assertEquals(viaAnchors.length, 1);
  assertEquals(viaAnchors[0].isExact, true);

  const plain1 = clusterBatch([participant("p1", [1, 0, 0]), participant("p2", [0.99, 0.05, 0])], THRESHOLD);
  const plain2 = clusterBatch([participant("p3", [0.98, 0.1, 0]), participant("p4", [1, 0.02, 0])], THRESHOLD);
  const viaCentre = mergeBatchGroups([...plain1, ...plain2], THRESHOLD);
  assertEquals(viaCentre.length, 1);
  assertEquals(viaCentre[0].isExact, false);
});

Deno.test("a merged group counts as coherent on a modality only when every part is", async () => {
  const { mergeBatchGroups } = await load();
  const mk = (id: string, visualCoherent: boolean) => ({
    memberIds: [id, `${id}x`], metrics: [participant(id, [1, 0, 0]).metrics, participant(`${id}x`, [1, 0, 0]).metrics],
    adNames: [[id, id], [`${id}x`, `${id}x`]],
    noteCentroid: [1, 0, 0], noteCount: 2, visualCentroid: [1, 0, 0], visualCount: 2, scriptCentroid: null, scriptCount: 0,
    assetKeys: [], metaVideoIds: [], metaImageHashes: [], isExact: false,
    visualCoherent, scriptCoherent: false, destinations: [null, null],
  });
  assertEquals(mergeBatchGroups([mk("a", true), mk("b", true)], THRESHOLD)[0].visualCoherent, true);
  assertEquals(mergeBatchGroups([mk("a", true), mk("b", false)], THRESHOLD)[0].visualCoherent, false);
});

Deno.test("the result does not depend on the order the batch groups arrive in", async () => {
  const { clusterBatch, mergeBatchGroups } = await load();
  const b1 = clusterBatch([participant("a1", [1, 0, 0]), participant("a2", [0.99, 0.05, 0])], THRESHOLD);
  const b2 = clusterBatch([participant("a3", [0.98, 0.1, 0])], THRESHOLD);
  const b3 = clusterBatch([participant("c1", [0, 0, 1])], THRESHOLD);
  const forward = mergeBatchGroups([...b1, ...b2, ...b3], THRESHOLD).map(ids).map((x: string[]) => x.join(",")).sort();
  const backward = mergeBatchGroups([...b3, ...b2, ...b1], THRESHOLD).map(ids).map((x: string[]) => x.join(",")).sort();
  assertEquals(forward, backward);
});

Deno.test("2,400 ads in six batches come out as the five real themes, none dropped", async () => {
  const { clusterBatch, mergeBatchGroups } = await load();
  // Five themes along separate axes, each ad a small deterministic wobble around its axis.
  const themes = 5;
  const perBatch = 400;
  const batches = 6;
  const all = [];
  let seq = 0;
  for (let b = 0; b < batches; b++) {
    const batch = [];
    for (let i = 0; i < perBatch; i++) {
      const theme = (b * 7 + i) % themes;
      const v = new Array(themes).fill(0);
      v[theme] = 1;
      v[(theme + 1) % themes] = ((seq * 37) % 100) / 2000; // wobble up to 0.05
      batch.push(participant(`ad${String(seq).padStart(5, "0")}`, v));
      seq++;
    }
    all.push(batch);
  }
  const groups = all.flatMap((batch) => clusterBatch(batch, THRESHOLD));
  assert(groups.length >= themes * batches, "each batch groups its own ads first");
  const merged = mergeBatchGroups(groups, THRESHOLD);
  assertEquals(merged.length, themes);
  const total = merged.reduce((s: number, g: { memberIds: string[] }) => s + g.memberIds.length, 0);
  assertEquals(total, perBatch * batches);
  assertEquals(new Set(merged.flatMap((g: { memberIds: string[] }) => g.memberIds)).size, perBatch * batches);
});

Deno.test("cluster-creatives groups every running ad, a batch at a time", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes("clusterBatch("), "each batch is grouped with clusterBatch");
  assert(src.includes("mergeBatchGroups("), "batches are merged with mergeBatchGroups");
  assert(/GROUPING_MAX_ADS/.test(src), "a safety ceiling on the number of ads");
  assertEquals(/loadGroupingInputs\([^)]*GROUPING_CAP/.test(src), false, "no single capped read left");
});
