/**
 * Group metrics on the Creatives grouping, Tag Insights and Video tabs (audit plan item 6.1, part 3).
 *
 * These screens averaged each creative's ratio (plain mean on Creatives, spend-weighted on
 * Tag Insights, plain mean on Video). A plain mean counts a $10 ad like a $1,000 ad, and
 * spend-weighting is only right for ROAS: CPA, CTR, CPM, hook and hold were wrong, and an
 * ad with no purchases counted as a $0 CPA. Now every group metric comes from summed counts
 * through the shared metric-math module, and "no data" is shown as "–" instead of 0.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import("@/lib/groupMetrics");

const big = { spend: 1000, purchase_value: 1000, purchases: 10, impressions: 100000, clicks: 1000, video_views: 10000, hold_rate: 10, video_avg_play_time: 2 };
const tiny = { spend: 10, purchase_value: 100, purchases: 0, impressions: 100, clicks: 10, video_views: 100, hold_rate: 50, video_avg_play_time: 10 };

describe("groupMetrics", () => {
  it("ROAS is total revenue over total spend (1.0891x, not 5.5x)", async () => {
    const { groupMetrics } = await load();
    expect(groupMetrics([big, tiny]).roas).toBeCloseTo(1100 / 1010, 9);
  });

  it("CPA is total spend over total purchases, so a no-purchase ad is not a $0 CPA", async () => {
    const { groupMetrics } = await load();
    expect(groupMetrics([big, tiny]).cpa).toBeCloseTo(1010 / 10, 9);
    expect(groupMetrics([tiny]).cpa).toBeNull();
  });

  it("CTR, CPM, hook and hold come from counts", async () => {
    const { groupMetrics } = await load();
    const g = groupMetrics([big, tiny]);
    expect(g.ctr).toBeCloseTo((1010 / 100100) * 100, 9);
    expect(g.cpm).toBeCloseTo((1010 / 100100) * 1000, 9);
    expect(g.hook_rate).toBeCloseTo((10100 / 100100) * 100, 9);
    expect(g.hold_rate).toBeCloseTo(((0.1 * 10000 + 0.5 * 100) / 10100) * 100, 9);
  });

  it("groupMetricValue maps the screen's metric keys", async () => {
    const { groupMetricValue } = await load();
    expect(groupMetricValue([big, tiny], "thumb_stop_rate")).toBeCloseTo((10100 / 100100) * 100, 9);
    expect(groupMetricValue([tiny], "cpa")).toBeNull();
  });
});

describe("Creatives group table", () => {
  it("shows – for a group with no purchases instead of $0.00 CPA", async () => {
    const { CreativesGroupTable } = await import("@/components/creatives/CreativesGroupTable");
    render(
      <CreativesGroupTable
        data={[{ name: "Hook A", count: 1, totalSpend: 10, roas: 10, cpa: null, avgSpend: 10 }]}
        groupBy="hook"
      />,
    );
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getAllByText("–").length).toBeGreaterThan(0);
  });
});

describe("screens use the shared group math", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  it("Creatives grouping", () => {
    const src = read("../pages/CreativesPage.tsx");
    expect(src).toContain("groupMetrics(");
    expect(src).not.toMatch(/avgField\(/);
  });
  it("Tag Insights", () => {
    const src = read("../components/analytics/TagInsightsTab.tsx");
    expect(src).toContain("groupMetricValue(");
    expect(src).not.toMatch(/Number\(c\.cpa\) \|\| 0\) \* \(Number\(c\.spend\)/);
  });
  it("Video tab", () => {
    const src = read("../components/analytics/VideoTab.tsx");
    expect(src).toContain("groupMetrics(");
    expect(src).not.toMatch(/c\.hook_rate, 0\) \/ videoCreatives\.length/);
  });
});
