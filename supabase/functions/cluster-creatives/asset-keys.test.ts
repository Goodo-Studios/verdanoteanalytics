// cluster-creatives resolves asset ids to asset keys (the primary exact anchor) in small groups.
//
// It looked up 500 asset ids per request. Each id is 36 characters, so the request URL was about
// 19 KB, which the API gateway refuses ("error sending request"). The old code never looked at the
// error, so groups silently lost their asset anchors; once the batched grouping started throwing
// on a failed lookup, grouping Cattasaurus (5,208 running ads) and Bearaby (3,733) failed with it.
// Ids are now looked up 100 at a time (about 4 KB), and a failed lookup is still an error.
//
//   deno test -A supabase/functions/cluster-creatives/asset-keys.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase, type Op } from "../_shared/fake-supabase.ts";

// deno-lint-ignore no-explicit-any
const load = async (): Promise<any> => await import("./asset-keys.ts");

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const ids = Array.from({ length: 1234 }, (_, i) => uuid(i));

const answer = (op: Op) => {
  const f = op.filters.find(([m, c]) => m === "in" && c === "id");
  return (f![2] as string[]).map((id) => ({ id, asset_key: `key-${id.slice(-4)}` }));
};

Deno.test("asset ids are looked up in groups small enough for the request URL", async () => {
  const { loadAssetKeys, ASSET_ID_CHUNK } = await load();
  assert(ASSET_ID_CHUNK <= 100, "at most 100 ids per request (about 4 KB of URL)");
  const db = fakeSupabase({ tables: { media_assets: answer } });
  await loadAssetKeys(db.client, ids);
  const reads = db.ops.filter((o) => o.table === "media_assets");
  assert(reads.length >= Math.ceil(1234 / 100));
  for (const r of reads) {
    const f = r.filters.find(([m, c]) => m === "in" && c === "id");
    assert(f, "looked up by id");
    const urlBytes = (f[2] as string[]).join(",").length;
    assert((f[2] as string[]).length <= 100, "at most 100 ids");
    assert(urlBytes < 5000, `ids part of the URL stays small (${urlBytes} bytes)`);
  }
});

Deno.test("every asset id gets its key, and repeated ids are asked for once", async () => {
  const { loadAssetKeys } = await load();
  const db = fakeSupabase({ tables: { media_assets: answer } });
  const keys = await loadAssetKeys(db.client, [...ids, ...ids.slice(0, 50)]);
  assertEquals(keys.size, 1234);
  assertEquals(keys.get(uuid(7)), "key-0007");
  const asked = db.ops.filter((o) => o.table === "media_assets")
    .flatMap((o) => o.filters.filter(([m, c]) => m === "in" && c === "id").flatMap(([, , v]) => v as string[]));
  assertEquals(asked.length, 1234);
});

Deno.test("a failed lookup is an error, not a silent loss of anchors", async () => {
  const { loadAssetKeys } = await load();
  const db = fakeSupabase({ tables: { media_assets: { data: null, error: { message: "request failed" } } } });
  let message = "";
  try {
    await loadAssetKeys(db.client, ids.slice(0, 10));
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("media_assets read"), message);
  assert(message.includes("request failed"), message);
});

Deno.test("cluster-creatives uses loadAssetKeys, not its own 500-id lookup", async () => {
  // The lookup moved from index.ts into participants.ts (which builds each batch's participants).
  const index = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const participants = await Deno.readTextFile(new URL("./participants.ts", import.meta.url));
  assert(participants.includes("loadAssetKeys("), "participants.ts must call loadAssetKeys");
  assertEquals(/from\("media_assets"\)/.test(index), false, "no direct media_assets read left in index.ts");
  assertEquals(/from\("media_assets"\)/.test(participants), false, "no direct media_assets read in participants.ts");
});
