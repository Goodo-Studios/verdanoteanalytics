// Result counts follow the account's optimization goal (audit plan item 6.5, part 4).
//
// The daily upsert dropped each day's result count and the rollup set result_count to
// purchases, so a SESSION_CONVERSION account showed purchases (usually 0) as its results.
// Each day now keeps the goal's result count, and the rollup sums it for that goal.
//
//   deno test -A supabase/functions/sync/result-goal.test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");

// deno-lint-ignore no-explicit-any
const sync: any = await import("./index.ts");
// deno-lint-ignore no-explicit-any
const backfill: any = await import("../backfill-daily-history/index.ts");

const days = [
  { spend: 30, purchases: 1, purchase_value: 50, result_count: 3 },
  { spend: 40, purchases: 1, purchase_value: 60, result_count: 4 },
];

Deno.test("SESSION_CONVERSION: results are the summed daily result counts", () => {
  const agg = sync.rollupDailyRows(days, "SESSION_CONVERSION");
  assertEquals(agg.result_count, 7);
  assertAlmostEquals(agg.cost_per_result, 10, 1e-9);
});

Deno.test("PURCHASE (and no goal): results are purchases", () => {
  for (const goal of ["PURCHASE", undefined]) {
    const agg = sync.rollupDailyRows(days, goal);
    assertEquals(agg.result_count, 2);
    assertAlmostEquals(agg.cost_per_result, 35, 1e-9);
  }
});

Deno.test("the sync's daily upsert keeps result_count", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!/result_count:\s*_resultCount/.test(src), "result_count must not be stripped from daily rows");
});

const metaRow = {
  ad_id: "ad1",
  date_start: "2026-11-01",
  spend: "50",
  impressions: "1000",
  actions: [
    { action_type: "omni_purchase", value: "2" },
    { action_type: "onsite_conversion.flow_complete", value: "5" },
  ],
};

Deno.test("backfill stores the goal's daily result count", () => {
  const ids = new Set(["ad1"]);
  assertEquals(backfill.buildDailyRow(metaRow, "act_1", ids, "SESSION_CONVERSION").result_count, 5);
  assertEquals(backfill.buildDailyRow(metaRow, "act_1", ids, "PURCHASE").result_count, 2);
  assertEquals(backfill.buildDailyRow(metaRow, "act_1", ids).result_count, 2);
});
