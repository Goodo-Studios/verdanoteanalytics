// Report snapshot saved at generation time (audit plan item 6.2).
//
// Exports of an old report must not change when today's numbers move, so every report saves
// its top creatives, tag mix and chart series when it is generated.
//
//   deno test -A supabase/functions/_shared/report-snapshot.test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// deno-lint-ignore no-explicit-any
const load = async (): Promise<any> => await import("./report-snapshot.ts");

const list = [
  { ad_id: "a1", ad_name: "Big", hook: "UGC", spend: 1000, purchase_value: 1000, purchases: 10, thumbnail_url: "t1" },
  { ad_id: "a2", ad_name: "Small", hook: "UGC", spend: 10, purchase_value: 100, purchases: 1 },
  { ad_id: "a3", ad_name: "Mid", style: "Static", spend: 90, purchase_value: 0, purchases: 0 },
];

Deno.test("top creatives are the six biggest spenders with their numbers for the report's range", async () => {
  const { buildReportSnapshot } = await load();
  const s = buildReportSnapshot(list, []);
  assertEquals(s.version, 1);
  assertEquals(s.top_creatives.map((c: { ad_id: string }) => c.ad_id), ["a1", "a3", "a2"]);
  assertEquals(s.top_creatives[0].thumbnail_url, "t1");
  assertEquals(s.top_creatives[0].roas, 1);
  assertEquals(s.top_creatives[1].roas, 0);
  assertEquals(s.top_creatives[1].cpa, null);
});

Deno.test("tag mix ROAS is revenue over spend for the group", async () => {
  const { buildReportSnapshot } = await load();
  const ugc = buildReportSnapshot(list, []).tag_mix.find((t: { tag: string }) => t.tag === "UGC");
  assertAlmostEquals(ugc.roas, 1100 / 1010, 1e-9);
  assertEquals(ugc.count, 2);
  assertAlmostEquals(ugc.spendPct, (1010 / 1100) * 100, 1e-9);
});

Deno.test("chart series is one total per day, in date order", async () => {
  const { buildReportSnapshot, addDailyTotal } = await load();
  const totals = new Map();
  addDailyTotal(totals, { date: "2026-10-02", spend: 5, purchase_value: 10, purchases: 1, clicks: 2, impressions: 100 });
  addDailyTotal(totals, { date: "2026-10-01", spend: 3, purchase_value: 0, purchases: 0, clicks: 1, impressions: 50 });
  addDailyTotal(totals, { date: "2026-10-02", spend: "7", purchase_value: "20", purchases: 2, clicks: 3, impressions: 200 });
  const s = buildReportSnapshot(list, totals);
  assertEquals(s.chart_series, [
    { date: "2026-10-01", spend: 3, purchase_value: 0, purchases: 0, clicks: 1, impressions: 50 },
    { date: "2026-10-02", spend: 12, purchase_value: 30, purchases: 3, clicks: 5, impressions: 300 },
  ]);
});

Deno.test("every report generator saves a snapshot", async () => {
  for (const f of ["../reports/index.ts", "../scheduled-reports/index.ts"]) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    assert(src.includes("buildReportSnapshot("), `${f} must build a snapshot`);
    assert(/snapshot:\s/.test(src), `${f} must store the snapshot on the report`);
  }
});
