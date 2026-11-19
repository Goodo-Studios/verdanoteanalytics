// cluster-creatives keeps less in memory while it groups an account.
//
// On production, after the batched grouping went live, Cattasaurus (5,208 running ads) and
// Miracle's second account (2,883 ads, all three embedding types per ad) were stopped by the
// server with WORKER_RESOURCE_LIMIT, the edge runtime's memory and compute ceiling. Cattasaurus
// died partway through saving its groups; Miracle's second account died before saving anything.
// The function held, for the whole request, the raw embedding text of every batch it had read
// (about 45 MB per batch of 500 ads with three embedding types) and the raw centre text of every
// stored group (about 60 MB for Cattasaurus's 2,192 groups). This releases both as soon as they
// are parsed or used.
//
//   deno test -A supabase/functions/cluster-creatives/participants.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase } from "../_shared/fake-supabase.ts";

// deno-lint-ignore no-explicit-any
const loadParticipants = async (): Promise<any> => await import("./participants.ts");
// deno-lint-ignore no-explicit-any
const loadReads = async (): Promise<any> => await import("./entity-reads.ts");

const creative = (id: string, extra: Record<string, unknown> = {}) => ({
  ad_id: id, ad_name: `name ${id}`, spend: 5, roas: 2, ctr: 1, cpa: 3, tag_source: null,
  ad_type: "a", person: "b", style: "c", product: "d", hook: "e", theme: "f",
  meta_video_ids: [], meta_image_hashes: [], thumb_asset_id: null, video_asset_id: null, destination_key: null,
  ...extra,
});

Deno.test("raw embedding rows are released as soon as they are parsed", async () => {
  const { buildParticipants } = await loadParticipants();
  const embeddings = new Map<string, Record<string, unknown>>([
    ["a1", { ad_id: "a1", embedding: "[1,0,0]", visual_embedding: "[0,1,0]", script_embedding: null }],
    ["a2", { ad_id: "a2", embedding: "[0.9,0.1,0]", visual_embedding: null, script_embedding: null }],
  ]);
  const db = fakeSupabase({ tables: { media_assets: [] } });
  const out = await buildParticipants(db.client, [creative("a1"), creative("a2")], embeddings);
  assertEquals(embeddings.size, 0, "the raw rows (large JSON strings) are dropped after parsing");
  assertEquals(out.length, 2);
  assertEquals(out[0].embedding, [1, 0, 0]);
  assertEquals(out[0].visualEmb, [0, 1, 0]);
  assertEquals(out[0].scriptEmb, null);
});

Deno.test("only ads that can cluster are kept, and asset keys come from media_assets", async () => {
  const { buildParticipants } = await loadParticipants();
  const embeddings = new Map<string, Record<string, unknown>>([
    ["a1", { ad_id: "a1", embedding: "[1,0,0]", visual_embedding: null, script_embedding: null }],
  ]);
  const db = fakeSupabase({ tables: { media_assets: [{ id: "asset-9", asset_key: "key-9" }] } });
  const out = await buildParticipants(
    db.client,
    [
      creative("a1"),
      creative("a2", { thumb_asset_id: "asset-9" }), // no embedding, but an anchor
      creative("a3"), // no embedding and no anchor: dropped
    ],
    embeddings,
  );
  assertEquals(out.map((p: { ad_id: string }) => p.ad_id), ["a1", "a2"]);
  assertEquals(out[1].assetKeys, ["key-9"]);
});

Deno.test("parseEmbedding accepts a JSON string, an array and nothing", async () => {
  const { parseEmbedding } = await loadParticipants();
  assertEquals(parseEmbedding("[1,2]"), [1, 2]);
  assertEquals(parseEmbedding([3, 4]), [3, 4]);
  assertEquals(parseEmbedding(null), null);
  assertEquals(parseEmbedding("not json"), null);
});

Deno.test("stored group rows become matchable entities with parsed centres", async () => {
  const { toExistingEntities } = await loadReads();
  const out = toExistingEntities([
    { id: "g1", centroid: "[1,0]", asset_keys: ["k"], meta_video_ids: null, meta_image_hashes: ["h"] },
    { id: "g2", centroid: null, asset_keys: null, meta_video_ids: ["v"], meta_image_hashes: null },
  ]);
  assertEquals(out[0], { id: "g1", centroid: [1, 0], assetKeys: ["k"], metaVideoIds: [], metaImageHashes: ["h"] });
  assertEquals(out[1], { id: "g2", centroid: null, assetKeys: [], metaVideoIds: ["v"], metaImageHashes: [] });
});

Deno.test("cluster-creatives lets go of what it no longer needs", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(/existRows/.test(src), false, "the raw stored-group rows are not kept in a variable");
  assert(src.includes("toExistingEntities(await loadExistingEntityRows("), "stored rows go straight into parsed entities");
  assert(src.includes("const existingIds"), "the ids needed for retirement are captured on their own");
  assert(src.includes("existing.length = 0"), "the parsed centres are dropped once matching is done");
  assert(src.includes("buildParticipants(db,"), "participants are built by the module that clears raw rows");
  assert(src.includes("batchGroups.length = 0"), "the per-batch groups are dropped after the merge");
});
