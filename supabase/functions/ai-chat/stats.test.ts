// AI chat dataset summary (audit plan item 6.1, part 5).
//
// computeStats took plain means of each creative's ROAS, CTR and CPA, so a $10 ad counted
// as much as a $1,000 ad and an ad with no purchases counted as a $0 CPA. The summary the
// model sees now comes from summed counts, and says "n/a" when there is no data.
//
//   deno test -A supabase/functions/ai-chat/stats.test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("AI_CHAT_NO_SERVE", "1");
// deno-lint-ignore no-explicit-any
const mod: any = await import("./index.ts");

const big = { ad_name: "Big", spend: 1000, purchase_value: 1000, purchases: 10, clicks: 1000, impressions: 100000, roas: 1, ctr: 1, cpa: 100 };
const tiny = { ad_name: "Tiny", spend: 10, purchase_value: 100, purchases: 0, clicks: 10, impressions: 100, roas: 10, ctr: 10, cpa: 0 };

Deno.test("ROAS is total revenue over total spend (1.0891x, not 5.5x)", () => {
  assert(typeof mod.computeStats === "function", "computeStats must be exported");
  assertAlmostEquals(mod.computeStats([big, tiny]).roas, 1100 / 1010, 1e-9);
});

Deno.test("CPA is total spend over purchases, so a no-purchase ad is not a $0 CPA", () => {
  assertAlmostEquals(mod.computeStats([big, tiny]).cpa, 1010 / 10, 1e-9);
  assertEquals(mod.computeStats([tiny]).cpa, null);
});

Deno.test("CTR is total clicks over total impressions", () => {
  assertAlmostEquals(mod.computeStats([big, tiny]).ctr, (1010 / 100100) * 100, 1e-9);
});

Deno.test("the context reads counts from the creatives table", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const col of ["purchase_value", "purchases", "clicks", "impressions"]) {
    assert(new RegExp(`\\.select\\("[^"]*\\b${col}\\b`).test(src), `creatives select must include ${col}`);
  }
});
