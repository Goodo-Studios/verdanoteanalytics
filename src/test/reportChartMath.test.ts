/**
 * Report page chart and tag breakdown (audit plan item 6.1, part 4).
 *
 * The report chart averaged each ad-day's ROAS, CPA and CTR per date, zero-spend rows
 * included, and read the daily rows with one unpaged select (1,000-row cap). The report
 * page's tag breakdown took a plain mean of each creative's ROAS. Both now come from
 * summed counts; a day or group with no denominator has no value (a gap, or "–").
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import("@/lib/reportChartMath");

const day = (date: string, spend: number, purchase_value: number, purchases = 0, clicks = 0, impressions = 0) =>
  ({ date, spend, purchase_value, purchases, clicks, impressions, roas: spend > 0 ? purchase_value / spend : 0 });

describe("dailySeries", () => {
  it("ROAS per day is that day's revenue over spend, not the mean of ad ROAS", async () => {
    const { dailySeries } = await load();
    const s = dailySeries(
      [day("2026-11-01", 1000, 1000), day("2026-11-01", 10, 100), day("2026-11-01", 0, 0)],
      "roas",
    );
    expect(s.dates).toEqual(["2026-11-01"]);
    expect(s.values[0]).toBeCloseTo(1100 / 1010, 9);
  });

  it("CPA and CTR come from counts, and a day with no denominator is a gap (NaN)", async () => {
    const { dailySeries } = await load();
    const rows = [day("2026-11-01", 100, 0, 4, 10, 1000), day("2026-11-02", 50, 0, 0, 0, 0)];
    const cpa = dailySeries(rows, "cpa");
    expect(cpa.values[0]).toBeCloseTo(25, 9);
    expect(Number.isNaN(cpa.values[1])).toBe(true);
    expect(dailySeries(rows, "ctr").values[0]).toBeCloseTo(1, 9);
  });

  it("spend is summed per day", async () => {
    const { dailySeries } = await load();
    expect(dailySeries([day("2026-11-01", 5, 0), day("2026-11-01", 7, 0)], "spend").values).toEqual([12]);
  });
});

describe("tagBreakdown", () => {
  it("group ROAS is revenue over spend, not the mean of creative ROAS", async () => {
    const { tagBreakdown } = await load();
    const rows = tagBreakdown([
      { hook: "A", spend: 1000, purchase_value: 1000, roas: 1 },
      { hook: "A", spend: 10, purchase_value: 100, roas: 10 },
      { hook: "B", spend: 90, purchase_value: 0, roas: 0 },
    ]);
    const a = rows.find((r: { tag: string }) => r.tag === "A");
    expect(a.roas).toBeCloseTo(1100 / 1010, 9);
    expect(a.count).toBe(2);
    expect(a.spendPct).toBeCloseTo((1010 / 1100) * 100, 9);
  });
});

describe("report page uses the shared math", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  it("chart section", () => {
    const src = read("../components/reports/sections/ChartSection.tsx");
    expect(src).toContain("dailySeries(");
    // Live reads are per-day database totals (audit 7.3), not a capped per-ad select.
    expect(src).toContain("useDailyTrends(");
    expect(src).not.toContain('.from("creative_daily_metrics")');
  });
  it("report detail page", () => {
    const src = read("../pages/ReportDetailPage.tsx");
    // Since audit 6.2 the tag mix is saved with the report by the same function
    // (tagBreakdown is tagMix from _shared/report-snapshot.ts) and the page reads it back.
    expect(src).toContain("reportPrintData(");
    expect(src).not.toMatch(/totalRoas \/ d\.count/);
    const snap = read("../../supabase/functions/_shared/report-snapshot.ts");
    expect(snap).toContain("tag_mix: tagMix(list)");
  });
});
