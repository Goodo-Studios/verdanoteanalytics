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

// Decision 17: the tag breakdown groups by the field the user picks, so the snapshot keeps one
// group list per pickable field, and both generators load every one of those fields.
Deno.test("decision 17: the snapshot keeps a tag mix for each pickable field", async () => {
  const { buildReportSnapshot } = await load();
  const rows = [
    { ad_id: "a1", hook: "Q", ad_type: "UGC", style: "Talk", person: "Ana", spend: 600, purchase_value: 1800 },
    { ad_id: "a2", hook: "Q", ad_type: "Static", style: null, person: "Ben", spend: 400, purchase_value: 400 },
  ];
  const by = buildReportSnapshot(rows, []).tag_mix_by_field;
  assertEquals(by.hook.map((t: { tag: string }) => t.tag), ["Q"]);
  assertEquals(by.ad_type.map((t: { tag: string }) => t.tag), ["UGC", "Static"]);
  assertEquals(by.style.map((t: { tag: string }) => t.tag), ["Talk", "Untagged"]);
  assertEquals(by.person.map((t: { tag: string }) => t.tag), ["Ana", "Ben"]);
  assertAlmostEquals(by.person[0].roas, 3, 1e-9);
  assertAlmostEquals(by.person[0].spendPct, 60, 1e-9);
});

Deno.test("decision 17: both report generators load every pickable tag field", async () => {
  for (const f of ["../reports/index.ts", "../scheduled-reports/index.ts"]) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    const selects = [...src.matchAll(/\.from\("creatives"\)\s*\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    const meta = selects.find((s) => s.includes("thumbnail_url"));
    assert(meta, `${f}: creative metadata select not found`);
    const cols = meta.split(",").map((s) => s.trim());
    for (const field of ["hook", "ad_type", "style", "person"]) {
      assert(cols.includes(field), `${f} does not load ${field}`);
    }
  }
});
