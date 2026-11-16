// Standard report build and correction of old reports (audit plan item 6.3).
//
// Reports made before the report math fix (#314) show wrong numbers. Matthew chose to correct
// them in place: each one is rebuilt for its own account and dates with the same code a new
// report uses, after its original row is saved to report_corrections. Reports with no daily
// data left are not touched.
//
//   deno test -A supabase/functions/_shared/standard-report.test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase } from "./fake-supabase.ts";

// deno-lint-ignore no-explicit-any
const load = async (): Promise<any> => await import("./standard-report.ts");

const daily = [
  { ad_id: "a1", account_id: "act_1", date: "2026-06-01", spend: 100, impressions: 1000, clicks: 10, purchases: 5, purchase_value: 500, roas: 5 },
  { ad_id: "a1", account_id: "act_1", date: "2026-06-02", spend: 900, impressions: 9000, clicks: 90, purchases: 5, purchase_value: 900, roas: 1 },
];
const creatives = [{ ad_id: "a1", ad_name: "Ad one", tag_source: "parsed", ad_type: "video" }];

const oldRow = {
  id: "r1", report_name: "Weekly Report - Test", account_id: "act_1", is_public: true,
  date_range_start: "2026-06-01", date_range_end: "2026-06-02", date_range_days: 2,
  total_spend: 800, blended_roas: 3, average_cpa: 99, average_ctr: 1, creative_count: 1,
};

Deno.test("a rebuilt report uses summed totals, not an average of daily ratios", async () => {
  const { buildStandardReportFields } = await load();
  const db = fakeSupabase({ tables: { creative_daily_metrics: daily, creatives } });
  const f = await buildStandardReportFields(db.client, "act_1", "2026-06-01", "2026-06-02", 2);
  assertEquals(f.creative_count, 1);
  assertEquals(f.total_spend, 1000);
  assertAlmostEquals(f.blended_roas, 1.4, 1e-9); // 1400 / 1000, not (5 + 1) / 2
  assertEquals(f.average_cpa, 100); // 1000 / 10
  assertEquals(f.average_ctr, 1); // 100 clicks / 10000 impressions, as a percent
  assertEquals(f.date_range_start, "2026-06-01");
  assertEquals(f.date_range_days, 2);
  assert(f.snapshot && Array.isArray(f.snapshot.top_creatives));
  assertEquals("report_name" in f, false);
  assertEquals("account_id" in f, false);
});

Deno.test("correcting a report saves the original row first, then updates the same report", async () => {
  const { correctReport } = await load();
  const db = fakeSupabase({ tables: { creative_daily_metrics: daily, creatives } });
  const out = await correctReport(db.client, oldRow);
  assertEquals(out.status, "corrected");
  const writes = db.writes();
  assertEquals(writes.map((w) => `${w.verb}:${w.table}`), ["insert:report_corrections", "update:reports"]);
  // deno-lint-ignore no-explicit-any
  const backup = writes[0].payload as any;
  assertEquals(backup.report_id, "r1");
  assertEquals(backup.original.blended_roas, 3);
  assertAlmostEquals(backup.corrected.blended_roas, 1.4, 1e-9);
  assertEquals(writes[1].filters, [["eq", "id", "r1"]]);
  // deno-lint-ignore no-explicit-any
  const upd = writes[1].payload as any;
  assertEquals(upd.total_spend, 1000);
  // Name, account, sharing and dates stay as they were.
  for (const k of ["report_name", "account_id", "is_public", "id", "created_at"]) assertEquals(k in upd, false);
});

Deno.test("a report with no daily data left is not touched", async () => {
  const { correctReport } = await load();
  const db = fakeSupabase({ tables: { creative_daily_metrics: [], creatives: [] } });
  const out = await correctReport(db.client, oldRow);
  assertEquals(out.status, "no_data");
  assert(db.untouched());
});

Deno.test("if the backup cannot be saved, the report is not changed", async () => {
  const { correctReport } = await load();
  const db = fakeSupabase({
    tables: { creative_daily_metrics: daily, creatives },
    writeErrors: { "insert:report_corrections": { message: "denied" } },
  });
  const out = await correctReport(db.client, oldRow);
  assertEquals(out.status, "error");
  assertEquals(db.writes().map((w) => w.verb + ":" + w.table), ["insert:report_corrections"]);
});
