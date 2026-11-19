// cluster-creatives saves its groups in chunks, not one database call per group.
//
// It saved each group with its own upsert, one after another. Bearaby (3,714 grouped ads, about
// 1,000 groups) took 130 seconds, and Cattasaurus (5,208 running ads) was stopped by the server
// at 135 seconds with a resource-limit error (HTTP 546). Rows now go out 50 at a time.
//
//   deno test -A supabase/functions/cluster-creatives/entity-writes.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase } from "../_shared/fake-supabase.ts";

// deno-lint-ignore no-explicit-any
const load = async (): Promise<any> => await import("./entity-writes.ts");

const rows = Array.from({ length: 230 }, (_, i) => ({ id: `id-${i}`, account_id: "act_1", label: `group ${i}` }));

Deno.test("groups are saved in chunks of at most 50 rows, in order", async () => {
  const { saveEntities, ENTITY_UPSERT_CHUNK } = await load();
  assertEquals(ENTITY_UPSERT_CHUNK, 50);
  const db = fakeSupabase({ tables: { creative_clusters: [] } });
  await saveEntities(db.client, rows);
  const writes = db.ops.filter((o) => o.table === "creative_clusters" && o.verb === "upsert");
  assertEquals(writes.length, 5, "230 rows go out in 5 calls, not 230");
  const sent: string[] = [];
  for (const w of writes) {
    const payload = w.payload as Array<{ id: string }>;
    assert(Array.isArray(payload), "each call carries a list of rows");
    assert(payload.length <= 50);
    sent.push(...payload.map((r) => r.id));
  }
  assertEquals(sent, rows.map((r) => r.id));
});

Deno.test("nothing is sent for no groups", async () => {
  const { saveEntities } = await load();
  const db = fakeSupabase({ tables: { creative_clusters: [] } });
  await saveEntities(db.client, []);
  assertEquals(db.ops.length, 0);
});

Deno.test("a failed save is an error that names the step", async () => {
  const { saveEntities } = await load();
  const db = fakeSupabase({
    tables: { creative_clusters: [] },
    writeErrors: { "upsert:creative_clusters": { message: "statement timeout" } },
  });
  let message = "";
  try {
    await saveEntities(db.client, rows.slice(0, 10));
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("entity upsert"), message);
  assert(message.includes("statement timeout"), message);
});

Deno.test("cluster-creatives saves its groups through saveEntities, once, before restamping", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(src.split("await saveEntities(").length - 1, 1);
  assertEquals(/from\("creative_clusters"\)\.upsert\(/.test(src), false, "no per-group upsert left in index.ts");
  assert(src.indexOf("await saveEntities(") < src.indexOf("await restampInSteps("), "groups are saved before members are restamped");
});
