// Unit tests for the Entity Report clustering helpers.
//
//   deno test supabase/functions/_shared/entity-clustering.test.ts
//
// Deno edge tests are manual, not part of the vitest CI gate
// (verdanote-deno-edge-tests-are-manual-not-in-ci-vitest).

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  agglomerativeClusters,
  completeLinkageBlocks,
  completeLinkageClusters,
  type PairDistance,
  buildFeatureText,
  type CandidateGroup,
  centroid,
  clusterLabel,
  clusterStats,
  coefficientOfVariation,
  confidenceTier,
  cosineSimilarity,
  effectiveEntities,
  type ExistingEntity,
  type CreativeMetrics,
  blendedTier,
  manualTagFraction,
  matchGroupsToEntities,
  modalityCoherent,
  representativeAdId,
  tagHomogeneity,
} from "./entity-clustering.ts";

// ─── buildFeatureText ────────────────────────────────────────────────────────

Deno.test("buildFeatureText combines notes + labeled tags", () => {
  const t = buildFeatureText({
    ad_id: "a1",
    ai_visual_notes: "woman drinking coffee outdoors",
    ad_type: "Video",
    hook: "problem-solution",
    person: "",
  });
  assertEquals(t?.includes("woman drinking coffee outdoors"), true);
  assertEquals(t?.includes("ad_type: Video"), true);
  assertEquals(t?.includes("hook: problem-solution"), true);
  // empty tag omitted
  assertEquals(t?.includes("person:"), false);
});

Deno.test("buildFeatureText returns null when nothing to embed (coverage skip)", () => {
  assertEquals(buildFeatureText({ ad_id: "x", ai_visual_notes: "  " }), null);
  assertEquals(buildFeatureText({ ad_id: "x" }), null);
});

Deno.test("buildFeatureText works from tags alone (no notes)", () => {
  const t = buildFeatureText({ ad_id: "x", theme: "holiday", product: "mixer" });
  assertEquals(t !== null, true);
  assertEquals(t?.includes("theme: holiday"), true);
});

Deno.test("buildFeatureText folds in rich analysis fields (v2)", () => {
  const t = buildFeatureText({
    ad_id: "r1",
    ai_visual_notes: "close-up of a dog's coat",
    brand_name: "Natural Dog Salmon Oil",
    target_audience: "dog owners wanting a shinier coat",
    value_structure: "Problem → Solution → Proof",
    hook_visual: "Close-up of a shiny coat",
    hook_type: "bold_claim",
    ad_format: "Testimonial",
    industry: "Health",
    ad_type: "Video",
  });
  assertEquals(t?.includes("brand_name: Natural Dog Salmon Oil"), true);
  assertEquals(t?.includes("target_audience: dog owners wanting a shinier coat"), true);
  assertEquals(t?.includes("value_structure: Problem → Solution → Proof"), true);
  assertEquals(t?.includes("hook_visual: Close-up of a shiny coat"), true);
  assertEquals(t?.includes("ad_format: Testimonial"), true);
  // both the flat notes and the tag block still present
  assertEquals(t?.includes("close-up of a dog's coat"), true);
  assertEquals(t?.includes("ad_type: Video"), true);
});

Deno.test("buildFeatureText clusters from rich fields even with no notes/tags", () => {
  // A creative with only rich analysis (no ai_visual_notes, no tags) is now
  // embeddable — previously it would have been a coverage skip.
  const t = buildFeatureText({ ad_id: "r2", brand_name: "Acme", value_structure: "Demo" });
  assertEquals(t !== null, true);
  assertEquals(t?.includes("brand_name: Acme"), true);
  // truly empty is still a skip
  assertEquals(buildFeatureText({ ad_id: "r3", brand_name: "  " }), null);
});

// ─── cosineSimilarity ────────────────────────────────────────────────────────

Deno.test("cosineSimilarity: identical=1, orthogonal=0, opposite=-1", () => {
  assertAlmostEquals(cosineSimilarity([1, 0], [1, 0]), 1, 1e-9);
  assertAlmostEquals(cosineSimilarity([1, 0], [0, 1]), 0, 1e-9);
  assertAlmostEquals(cosineSimilarity([1, 0], [-1, 0]), -1, 1e-9);
});

Deno.test("cosineSimilarity: zero vector yields 0 (no NaN)", () => {
  assertEquals(cosineSimilarity([0, 0], [1, 1]), 0);
});

// ─── agglomerativeClusters ───────────────────────────────────────────────────

Deno.test("agglomerative: two tight groups separate at threshold", () => {
  const items = [
    { ad_id: "a", embedding: [1, 0] },
    { ad_id: "b", embedding: [0.99, 0.01] },
    { ad_id: "c", embedding: [0, 1] },
    { ad_id: "d", embedding: [0.02, 0.99] },
  ];
  const clusters = agglomerativeClusters(items, 0.7);
  assertEquals(clusters.length, 2);
  // each cluster has 2 members
  assertEquals(clusters.every((c) => c.length === 2), true);
});

Deno.test("agglomerative: single-linkage is transitive (chain merges)", () => {
  // a~b and b~c but a NOT~ c directly; single linkage still merges all three.
  const items = [
    { ad_id: "a", embedding: [1, 0] },
    { ad_id: "b", embedding: [0.8, 0.6] },
    { ad_id: "c", embedding: [0.4, 0.92] },
  ];
  // a·b = 0.8, b·c = ~0.872, a·c = 0.4 (< 0.7)
  const clusters = agglomerativeClusters(items, 0.7);
  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].length, 3);
});

Deno.test("agglomerative: all-dissimilar -> all singletons", () => {
  const items = [
    { ad_id: "a", embedding: [1, 0, 0] },
    { ad_id: "b", embedding: [0, 1, 0] },
    { ad_id: "c", embedding: [0, 0, 1] },
  ];
  const clusters = agglomerativeClusters(items, 0.7);
  assertEquals(clusters.length, 3);
});

// ─── completeLinkage (regression guards for the chaining blob) ───────────────
//
// Context: on Bearaby (2,391 ACTIVE ads) single linkage at the production 0.70
// threshold put 2,126 of 2,189 covered ads (97%) and 89% of spend into ONE
// cluster. Complete linkage on the same data gives 131 clusters, largest 231.
// These tests pin the property that makes the difference.

Deno.test("complete linkage: does NOT chain (mirror of the single-linkage test above)", () => {
  // Exactly the fixture from 'single-linkage is transitive': a~b and b~c, but
  // a NOT~ c. Single linkage merges all three; complete linkage must not,
  // because complete linkage requires EVERY intra-cluster pair to be within cut.
  const items = [
    { ad_id: "a", embedding: [1, 0] },
    { ad_id: "b", embedding: [0.8, 0.6] },
    { ad_id: "c", embedding: [0.4, 0.92] },
  ];
  const single = agglomerativeClusters(items, 0.7);
  const complete = completeLinkageClusters(items, 0.7);
  assertEquals(single.length, 1, "precondition: single linkage chains");
  assertEquals(complete.length, 2, "complete linkage must not chain");
  // a·c = 0.4 < 0.7, so a and c must never share a cluster.
  for (const c of complete) {
    assertEquals(c.includes("a") && c.includes("c"), false);
  }
});

Deno.test("complete linkage: two tight groups still separate", () => {
  const items = [
    { ad_id: "a", embedding: [1, 0] },
    { ad_id: "b", embedding: [0.99, 0.01] },
    { ad_id: "c", embedding: [0, 1] },
    { ad_id: "d", embedding: [0.02, 0.99] },
  ];
  const clusters = completeLinkageClusters(items, 0.7);
  assertEquals(clusters.length, 2);
  assertEquals(clusters.every((c) => c.length === 2), true);
});

Deno.test("complete linkage: all-dissimilar -> all singletons", () => {
  const items = [
    { ad_id: "a", embedding: [1, 0, 0] },
    { ad_id: "b", embedding: [0, 1, 0] },
    { ad_id: "c", embedding: [0, 0, 1] },
  ];
  assertEquals(completeLinkageClusters(items, 0.7).length, 3);
});

Deno.test("complete linkage: every intra-cluster pair is within the cut", () => {
  // Property test over a small grid of angles — the defining invariant.
  const items = Array.from({ length: 12 }, (_, i) => {
    const t = (i * Math.PI) / 14;
    return { ad_id: `x${i}`, embedding: [Math.cos(t), Math.sin(t)] };
  });
  const clusters = completeLinkageClusters(items, 0.7);
  const byId = new Map(items.map((it) => [it.ad_id, it.embedding]));
  for (const c of clusters) {
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const sim = cosineSimilarity(byId.get(c[i])!, byId.get(c[j])!);
        assertEquals(sim >= 0.7 - 1e-9, true, `${c[i]}~${c[j]} = ${sim} is below the cut`);
      }
    }
  }
});

Deno.test("complete linkage: anchor seed blocks are atomic and may chain", () => {
  // Anchors are exact identity (same asset_key), and identity IS transitive, so
  // anchor components are exempt from the all-pairs constraint by design.
  // a and c are far apart, but a shared anchor puts them in one block.
  const dist: PairDistance = (i, j) => {
    const far = (i === 0 && j === 2) || (i === 2 && j === 0);
    return far ? 1.0 : 0.1;
  };
  const groups = completeLinkageBlocks(3, dist, 0.3, [[0, 2]]);
  assertEquals(groups.length, 1, "seed block must survive and absorb the third item");
  assertEquals(groups[0].length, 3);
});

Deno.test("complete linkage: Infinity distance never links", () => {
  const dist: PairDistance = (i, j) => (i === 0 || j === 0 ? Infinity : 0);
  const groups = completeLinkageBlocks(3, dist, 0.5);
  assertEquals(groups.length, 2);
  assertEquals(groups.some((g) => g.length === 1 && g[0] === 0), true);
  assertEquals(groups.some((g) => g.length === 2), true);
});

Deno.test("complete linkage: refuses to allocate an oversized matrix", () => {
  let threw = false;
  try {
    completeLinkageBlocks(10, () => 0, 1, [], { maxItems: 4 });
  } catch (e) {
    threw = true;
    assertEquals(String(e).includes("exceeds maxItems"), true);
  }
  assertEquals(threw, true, "must fail loudly rather than OOM the edge runtime");
});

Deno.test("complete linkage: output is deterministic and partitions every input", () => {
  const items = Array.from({ length: 9 }, (_, i) => ({
    ad_id: `id${i}`,
    embedding: [Math.cos(i), Math.sin(i)],
  }));
  const a = completeLinkageClusters(items, 0.7);
  const b = completeLinkageClusters(items, 0.7);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertEquals(a.flat().sort().join(","), items.map((i) => i.ad_id).sort().join(","));
});

// ─── coefficientOfVariation ──────────────────────────────────────────────────

Deno.test("CV: constant series -> 0", () => {
  assertEquals(coefficientOfVariation([2, 2, 2]), 0);
});

Deno.test("CV: undefined for <2 points or ~0 mean", () => {
  assertEquals(coefficientOfVariation([5]), null);
  assertEquals(coefficientOfVariation([0, 0]), null);
});

Deno.test("CV: spread increases CV", () => {
  const tight = coefficientOfVariation([10, 11, 9])!;
  const loose = coefficientOfVariation([2, 20, 8])!;
  assertEquals(loose > tight, true);
});

// ─── tag homogeneity / manual fraction ──────────────────────────────────────

const mk = (ad_id: string, over: Partial<CreativeMetrics> = {}): CreativeMetrics => ({
  ad_id, spend: 100, roas: 2, ctr: 0.02, cpa: 20, tag_source: "parsed",
  tags: { theme: "holiday", hook: "ugc" }, ...over,
});

Deno.test("tagHomogeneity: identical tags -> 1", () => {
  assertEquals(tagHomogeneity([mk("a"), mk("b"), mk("c")]), 1);
});

Deno.test("tagHomogeneity: mixed tags -> modal fraction", () => {
  const members = [
    mk("a"),
    mk("b"),
    mk("c", { tags: { theme: "sale", hook: "curiosity" } }),
  ];
  assertAlmostEquals(tagHomogeneity(members), 2 / 3, 1e-9);
});

Deno.test("manualTagFraction counts manual tag_source", () => {
  const members = [mk("a", { tag_source: "manual" }), mk("b", { tag_source: "parsed" })];
  assertEquals(manualTagFraction(members), 0.5);
});

// ─── confidenceTier ──────────────────────────────────────────────────────────

Deno.test("tier: cohesive delivery + homogeneous tags -> corroborated", () => {
  const members = [
    mk("a", { roas: 2.0, ctr: 0.02, cpa: 20 }),
    mk("b", { roas: 2.1, ctr: 0.021, cpa: 19 }),
    mk("c", { roas: 1.9, ctr: 0.019, cpa: 21 }),
  ];
  assertEquals(confidenceTier(clusterStats(members)), "corroborated");
});

Deno.test("tier: homogeneous tags but scattered delivery -> probable", () => {
  const members = [
    mk("a", { roas: 0.5, ctr: 0.005, cpa: 80 }),
    mk("b", { roas: 4.0, ctr: 0.05, cpa: 8 }),
    mk("c", { roas: 2.2, ctr: 0.025, cpa: 30 }),
  ];
  const tier = confidenceTier(clusterStats(members));
  assertEquals(tier, "probable");
});

Deno.test("tier: singleton -> visual_only (or probable if manual)", () => {
  assertEquals(confidenceTier(clusterStats([mk("a")])), "visual_only");
  assertEquals(
    confidenceTier(clusterStats([mk("a", { tag_source: "manual" })])),
    "probable",
  );
});

Deno.test("tier: scattered delivery + mixed tags -> visual_only", () => {
  const members = [
    mk("a", { roas: 0.5, ctr: 0.005, cpa: 80, tag_source: "parsed", tags: { theme: "x" } }),
    mk("b", { roas: 4.0, ctr: 0.05, cpa: 8, tag_source: "parsed", tags: { theme: "y" } }),
    mk("c", { roas: 2.2, ctr: 0.025, cpa: 30, tag_source: "parsed", tags: { theme: "z" } }),
  ];
  assertEquals(confidenceTier(clusterStats(members)), "visual_only");
});

// ─── representative + label ─────────────────────────────────────────────────

Deno.test("representativeAdId picks highest spend", () => {
  const members = [mk("a", { spend: 10 }), mk("b", { spend: 500 }), mk("c", { spend: 50 })];
  assertEquals(representativeAdId(members), "b");
});

Deno.test("clusterLabel uses modal theme/product/hook combo", () => {
  const members = [mk("a"), mk("b"), mk("c", { tags: { theme: "sale" } })];
  assertEquals(clusterLabel(members), "holiday · ugc");
});

// ─── effectiveEntities ───────────────────────────────────────────────────────

Deno.test("effectiveEntities: even spend -> cluster count", () => {
  assertAlmostEquals(effectiveEntities([100, 100, 100, 100]), 4, 1e-9);
});

Deno.test("effectiveEntities: concentrated spend collapses toward 1", () => {
  const eff = effectiveEntities([1000, 1, 1, 1]);
  assertEquals(eff < 1.1, true);
  assertEquals(eff >= 1, true);
});

Deno.test("effectiveEntities: matches competitor framing (11 -> ~4.2)", () => {
  // Roughly reproduce an imbalanced 11-entity account whose effective count is
  // ~4.2 — a heavy head + long tail.
  const spends = [4000, 3000, 1500, 800, 400, 200, 120, 90, 60, 40, 20];
  const eff = effectiveEntities(spends);
  assertEquals(eff > 3.5 && eff < 5.0, true);
});

Deno.test("effectiveEntities: no spend -> cluster count fallback", () => {
  assertEquals(effectiveEntities([0, 0, 0]), 3);
});

// ─── Persistent identity: centroid + matchGroupsToEntities (US-005/US-015) ────

Deno.test("centroid averages vectors; null on empty", () => {
  assertEquals(centroid([[0, 2], [2, 0]]), [1, 1]);
  assertEquals(centroid([]), null);
});

const noAnchors = { assetKeys: [], metaVideoIds: [], metaImageHashes: [] };

Deno.test("US-015 e2e: re-run over unchanged groups reproduces the SAME entity ids", () => {
  const existing: ExistingEntity[] = [
    { id: "ent-A", centroid: [1, 0], assetKeys: ["sha-a"], metaVideoIds: [], metaImageHashes: [] },
    { id: "ent-B", centroid: [0, 1], assetKeys: ["sha-b"], metaVideoIds: [], metaImageHashes: [] },
  ];
  const groups: CandidateGroup[] = [
    { key: "ad1", size: 3, centroid: [1, 0], assetKeys: ["sha-a"], metaVideoIds: [], metaImageHashes: [] },
    { key: "ad2", size: 2, centroid: [0, 1], assetKeys: ["sha-b"], metaVideoIds: [], metaImageHashes: [] },
  ];
  assertEquals(matchGroupsToEntities(groups, existing, 0.7), ["ent-A", "ent-B"]);
  // idempotent: same inputs → same output
  assertEquals(matchGroupsToEntities(groups, existing, 0.7), ["ent-A", "ent-B"]);
});

Deno.test("US-015 e2e: a new creative reusing an existing asset_key joins that entity", () => {
  const existing: ExistingEntity[] = [
    { id: "ent-A", centroid: [1, 0], assetKeys: ["sha-a"], metaVideoIds: [], metaImageHashes: [] },
  ];
  // group carries the same asset_key (plus a brand-new ad) → must map to ent-A.
  const groups: CandidateGroup[] = [
    { key: "adNew", size: 2, centroid: [0.9, 0.1], assetKeys: ["sha-a"], metaVideoIds: [], metaImageHashes: [] },
  ];
  assertEquals(matchGroupsToEntities(groups, existing, 0.7), ["ent-A"]);
});

Deno.test("US-015 e2e: a genuinely new group mints a new id (null), not an existing one", () => {
  const existing: ExistingEntity[] = [
    { id: "ent-A", centroid: [1, 0], assetKeys: ["sha-a"], metaVideoIds: [], metaImageHashes: [] },
  ];
  const groups: CandidateGroup[] = [
    { key: "adZ", size: 1, centroid: [0, 1], ...noAnchors }, // orthogonal centroid, no shared anchor
  ];
  assertEquals(matchGroupsToEntities(groups, existing, 0.7), [null]);
});

Deno.test("shared meta_video_id matches even when centroids drift", () => {
  const existing: ExistingEntity[] = [
    { id: "ent-A", centroid: [1, 0], assetKeys: [], metaVideoIds: ["vid-1"], metaImageHashes: [] },
  ];
  const groups: CandidateGroup[] = [
    { key: "ad1", size: 1, centroid: [0, 1], assetKeys: [], metaVideoIds: ["vid-1"], metaImageHashes: [] },
  ];
  assertEquals(matchGroupsToEntities(groups, existing, 0.9), ["ent-A"]);
});

// ─── Blended multi-signal tiers (US-006) ─────────────────────────────────────

Deno.test("modalityCoherent: tight set coheres, orthogonal set does not, <2 is false", () => {
  assertEquals(modalityCoherent([[1, 0], [0.99, 0.01]], 0.9), true);
  assertEquals(modalityCoherent([[1, 0], [0, 1]], 0.9), false);
  assertEquals(modalityCoherent([[1, 0]], 0.9), false); // needs >=2
});

Deno.test("blendedTier: exact wins over everything", () => {
  assertEquals(
    blendedTier({ isExact: true, visualCoherent: false, scriptCoherent: false, hasManual: false, nMembers: 3 }),
    "exact",
  );
});

Deno.test("blendedTier: both modalities agree -> corroborated; one -> probable; none -> visual_only", () => {
  const base = { isExact: false, hasManual: false, nMembers: 4 };
  assertEquals(blendedTier({ ...base, visualCoherent: true, scriptCoherent: true }), "corroborated");
  assertEquals(blendedTier({ ...base, visualCoherent: true, scriptCoherent: false }), "probable");
  assertEquals(blendedTier({ ...base, visualCoherent: false, scriptCoherent: true }), "probable");
  assertEquals(blendedTier({ ...base, visualCoherent: false, scriptCoherent: false }), "visual_only");
});

Deno.test("blendedTier: shared destination lifts an uncorroborated group to probable, never higher", () => {
  const base = { isExact: false, visualCoherent: false, scriptCoherent: false, hasManual: false, nMembers: 3 };
  assertEquals(blendedTier({ ...base, sharedDestination: true }), "probable");
  assertEquals(blendedTier({ ...base, sharedDestination: false }), "visual_only");
  // destination never manufactures 'corroborated' on its own
  assertEquals(
    blendedTier({ ...base, visualCoherent: true, sharedDestination: true }),
    "probable",
  );
});

Deno.test("blendedTier: singleton is visual_only unless manually tagged", () => {
  assertEquals(
    blendedTier({ isExact: false, visualCoherent: false, scriptCoherent: false, hasManual: false, nMembers: 1 }),
    "visual_only",
  );
  assertEquals(
    blendedTier({ isExact: false, visualCoherent: false, scriptCoherent: false, hasManual: true, nMembers: 1 }),
    "probable",
  );
});

Deno.test("each existing entity is claimed by at most one group", () => {
  const existing: ExistingEntity[] = [
    { id: "ent-A", centroid: [1, 0], assetKeys: ["sha-a"], metaVideoIds: [], metaImageHashes: [] },
  ];
  const groups: CandidateGroup[] = [
    { key: "ad1", size: 5, centroid: [1, 0], assetKeys: ["sha-a"], metaVideoIds: [], metaImageHashes: [] },
    { key: "ad2", size: 1, centroid: [0.99, 0.01], ...noAnchors }, // close centroid but ent-A already taken
  ];
  assertEquals(matchGroupsToEntities(groups, existing, 0.7), ["ent-A", null]);
});
