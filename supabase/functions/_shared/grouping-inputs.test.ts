// Creative grouping inputs (audit plan item 7.3, Matthew's decision 2026-11-16).
//
// cluster-creatives read an account's embeddings with one unpaged select (capped at 1,000 rows,
// in no order, including paused ads) and matched them to running ads, so most running ads in
// big accounts had no embedding. Matthew chose: group each account's newest 1,000 running ads,
// nightly. The embeddings are read for exactly those ads.
//
//   deno test -A supabase/functions/_shared/grouping-inputs.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase, type Op } from "./fake-supabase.ts";

// deno-lint-ignore no-explicit-any
const load = async (): Promise<any> => await import("./grouping-inputs.ts");

// 2,500 running ads, newest first (the order the query asks for).
const active = Array.from({ length: 2500 }, (_, i) => ({ ad_id: `ad${String(i).padStart(4, "0")}`, ad_status: "ACTIVE" }));
// Embeddings for every ad, stored oldest first: an unfiltered read sees the oldest 1,000 only.
const embeddings = [...active].reverse().map((a) => ({ ad_id: a.ad_id, embedding: "[1,0]", visual_embedding: null, script_embedding: null }));

const embeddingAnswer = (op: Op) => {
  const inFilter = op.filters.find(([m, c]) => m === "in" && c === "ad_id");
  if (!inFilter) return embeddings.slice(0, 1000); // PostgREST's default row cap
  const ids = new Set(inFilter[2] as string[]);
  return embeddings.filter((e) => ids.has(e.ad_id));
};

Deno.test("grouping takes the newest 1,000 running ads", async () => {
  const { loadGroupingInputs, GROUPING_CAP } = await load();
  assertEquals(GROUPING_CAP, 1000);
  const db = fakeSupabase({ tables: { creatives: active, creative_embeddings: embeddingAnswer } });
  const out = await loadGroupingInputs(db.client, "act_1", "ad_id", GROUPING_CAP);
  assertEquals(out.creatives.length, 1000);
  assertEquals(out.creatives[0].ad_id, "ad0000");
  assertEquals(out.creatives[999].ad_id, "ad0999");
  const reads = db.ops.filter((o) => o.table === "creatives");
  for (const r of reads) {
    assert(r.filters.some(([m, c, v]) => m === "eq" && c === "ad_status" && v === "ACTIVE"), "running ads only");
    assert(r.filters.some(([m, c, v]) => m === "eq" && c === "account_id" && v === "act_1"), "one account");
    assert(r.range && r.range[1] < 1000, "never reads past the cap");
  }
});

Deno.test("every grouped ad gets its embedding, read by ad id in small batches", async () => {
  const { loadGroupingInputs } = await load();
  const db = fakeSupabase({ tables: { creatives: active, creative_embeddings: embeddingAnswer } });
  const out = await loadGroupingInputs(db.client, "act_1", "ad_id", 1000);
  const withEmbedding = out.creatives.filter((c: { ad_id: string }) => out.embeddings.has(c.ad_id));
  assertEquals(withEmbedding.length, 1000);
  const embReads = db.ops.filter((o) => o.table === "creative_embeddings");
  assert(embReads.length > 0);
  for (const r of embReads) {
    const f = r.filters.find(([m, c]) => m === "in" && c === "ad_id");
    assert(f, "embeddings are read by ad id, never account-wide");
    assert((f[2] as string[]).length <= 200, "batches of at most 200 ids");
  }
});

Deno.test("a failed embeddings read is an error, not a silent gap", async () => {
  const { loadGroupingInputs } = await load();
  const db = fakeSupabase({
    tables: { creatives: active.slice(0, 10), creative_embeddings: { data: null, error: { message: "timeout" } } },
  });
  let threw = false;
  try {
    await loadGroupingInputs(db.client, "act_1", "ad_id", 1000);
  } catch (e) {
    threw = String((e as Error).message).includes("timeout");
  }
  assert(threw);
});

Deno.test("cluster-creatives reads its inputs through loadGroupingInputs, not an account-wide embeddings read", async () => {
  const src = await Deno.readTextFile(new URL("../cluster-creatives/index.ts", import.meta.url));
  assert(src.includes("loadGroupingInputs("), "cluster-creatives must use loadGroupingInputs");
  assertEquals(/from\("creative_embeddings"\)/.test(src), false, "no direct creative_embeddings read left");
});
