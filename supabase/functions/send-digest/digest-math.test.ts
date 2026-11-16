// Weekly digest numbers (audit plan item 6.1, part 2).
//
// send-digest averaged ROAS over ad-days, used 8 days including today as "this week",
// and picked the "top creative" from lifetime numbers with no spend floor. Now:
//   - this week is the last 7 full days (today excluded), last week the 7 days before;
//   - ROAS = sum(purchase_value) / sum(spend), null when there was no spend;
//   - the top creative is the best ROAS this week among ads with at least the spend floor;
//   - the change from last week is null when last week has no ROAS.
//
//   deno test -A supabase/functions/send-digest/digest-math.test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// deno-lint-ignore no-explicit-any
const dm: any = await import("./digest-math.ts");

Deno.test("this week is the last 7 full days, last week the 7 before", () => {
  const w = dm.digestWindows(new Date("2026-11-16T12:00:00Z"));
  assertEquals(w.thisWeek, { start: "2026-11-09", end: "2026-11-15" });
  assertEquals(w.lastWeek, { start: "2026-11-02", end: "2026-11-08" });
});

Deno.test("week ROAS is total revenue over total spend (Codex fixture 1.0891x, not 5.5x)", () => {
  const s = dm.summarizeWeek([
    { ad_id: "a", spend: 1000, purchase_value: 1000, roas: 1 },
    { ad_id: "b", spend: 10, purchase_value: 100, roas: 10 },
  ]);
  assertEquals(s.spend, 1010);
  assertAlmostEquals(s.roas, 1100 / 1010, 1e-9);
});

Deno.test("a week with no spend has null ROAS", () => {
  assertEquals(dm.summarizeWeek([]).roas, null);
});

Deno.test("top creative uses this week's numbers and skips ads under the spend floor", () => {
  const top = dm.topCreativeOfWeek([
    { ad_id: "tiny", spend: 10, purchase_value: 100 },
    { ad_id: "big", spend: 600, purchase_value: 1200 },
    { ad_id: "big", spend: 400, purchase_value: 1000 },
    { ad_id: "mid", spend: 200, purchase_value: 300 },
  ]);
  assertEquals(top.ad_id, "big");
  assertAlmostEquals(top.roas, 2.2, 1e-9);
  assert(dm.DIGEST_TOP_MIN_SPEND > 10);
});

Deno.test("no ad over the spend floor means no top creative", () => {
  assertEquals(dm.topCreativeOfWeek([{ ad_id: "tiny", spend: 10, purchase_value: 100 }]), null);
});

Deno.test("change from last week is null when last week has nothing to compare", () => {
  assertEquals(dm.percentChange(2, null), null);
  assertEquals(dm.percentChange(2, 0), null);
  assertAlmostEquals(dm.percentChange(3, 2), 50, 1e-9);
});

Deno.test("send-digest uses the shared week math", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  // Week totals are summed in the database (audit 7.3, loadWeekTotals); the top creative still
  // comes from this week's rows.
  for (const name of ["digestWindows(", "loadWeekTotals(", "topCreativeOfWeek("]) {
    assert(src.includes(name), `send-digest must call ${name}`);
  }
  assertEquals(/order\("roas"/.test(src), false, "top creative must not come from lifetime ROAS");
});
