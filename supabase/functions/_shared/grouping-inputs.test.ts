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

Deno.test("grouping reads running ads one batch at a time, newest first", async () => {
  const { loadGroupingInputs, GROUPING_BATCH, GROUPING_MAX_ADS } = await load();
  assertEquals(GROUPING_BATCH, 500);
  assert(GROUPING_MAX_ADS >= 10000, "a ceiling well above the largest account (about 5,800 running ads)");
  const db = fakeSupabase({ tables: { creatives: active, creative_embeddings: embeddingAnswer } });
  const first = await loadGroupingInputs(db.client, "act_1", "ad_id", GROUPING_BATCH, 0);
  assertEquals(first.creatives.length, 500);
  assertEquals(first.creatives[0].ad_id, "ad0000");
  assertEquals(first.creatives[499].ad_id, "ad0499");
  const second = await loadGroupingInputs(db.client, "act_1", "ad_id", GROUPING_BATCH, 500);
  assertEquals(second.creatives.length, 500);
  assertEquals(second.creatives[0].ad_id, "ad0500");
  assertEquals(second.creatives[499].ad_id, "ad0999");
  const reads = db.ops.filter((o) => o.table === "creatives");
  for (const r of reads) {
    assert(r.filters.some(([m, c, v]) => m === "eq" && c === "ad_status" && v === "ACTIVE"), "running ads only");
    assert(r.filters.some(([m, c, v]) => m === "eq" && c === "account_id" && v === "act_1"), "one account");
    assert(r.range && r.range[1] - r.range[0] < 500, "never reads more than one batch at a time");
  }
});

Deno.test("walking the batches covers every running ad exactly once, and a short last batch ends the walk", async () => {
  const { loadGroupingInputs, GROUPING_BATCH } = await load();
  const db = fakeSupabase({ tables: { creatives: active, creative_embeddings: embeddingAnswer } });
  const seen: string[] = [];
  let sizes: number[] = [];
  for (let offset = 0; ; offset += GROUPING_BATCH) {
    const out = await loadGroupingInputs(db.client, "act_1", "ad_id", GROUPING_BATCH, offset);
    sizes.push(out.creatives.length);
    for (const c of out.creatives) {
      seen.push(c.ad_id);
      assert(out.embeddings.has(c.ad_id), "each ad in the batch has its embedding");
    }
    if (out.creatives.length < GROUPING_BATCH) break;
  }
  assertEquals(seen.length, 2500);
  assertEquals(new Set(seen).size, 2500);
  assertEquals(sizes, [500, 500, 500, 500, 500, 0]);
});

Deno.test("every grouped ad gets its embedding, read by ad id in small batches", async () => {
  const { loadGroupingInputs } = await load();
  const db = fakeSupabase({ tables: { creatives: active, creative_embeddings: embeddingAnswer } });
  const out = await loadGroupingInputs(db.client, "act_1", "ad_id", 500, 0);
  const withEmbedding = out.creatives.filter((c: { ad_id: string }) => out.embeddings.has(c.ad_id));
  assertEquals(withEmbedding.length, 500);
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
    await loadGroupingInputs(db.client, "act_1", "ad_id", 500, 0);
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
