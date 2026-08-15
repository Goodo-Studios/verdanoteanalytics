/**
 * ai-chat prompt formatting — percentage-scaling regression.
 *
 * `creatives.ctr`, `thumb_stop_rate` and `hold_rate` are stored as true
 * percentages (Meta Insights convention). The prompt builder multiplied all
 * three by 100, so the model reasoned over a 1.67% CTR presented as "167.0%"
 * and a 31.5% hook rate presented as "3150.0%" — wrong numbers wrapped in
 * confident prose, invisible from the outside.
 */
import { describe, it, expect } from "vitest";
import {
  CREATIVE_TABLE_COLUMNS,
  CREATIVE_TABLE_LIMIT,
  formatCreativeRow,
  formatCreativeTable,
} from "../../supabase/functions/_shared/creative-prompt-format.ts";

const creative = (over: Record<string, unknown> = {}) => ({
  ad_name: "Holiday UGC v3",
  spend: 4210.5,
  roas: 2.13,
  cpa: 19.8,
  ctr: 1.67,
  thumb_stop_rate: 31.5,
  hold_rate: 12.4,
  ad_type: "Video",
  hook: "ugc",
  style: "testimonial",
  ad_status: "ACTIVE",
  ...over,
});

describe("formatCreativeRow percentage scaling", () => {
  it("renders a 1.67 ctr as 1.67%, never 167%", () => {
    const row = formatCreativeRow(creative());
    expect(row).toContain("1.67%");
    expect(row).not.toContain("167.00%");
    expect(row).not.toContain("167.0%");
  });

  it("renders a 31.5 hook rate as 31.5%, never 3150%", () => {
    const row = formatCreativeRow(creative());
    expect(row).toContain("31.5%");
    expect(row).not.toContain("3150");
  });

  it("renders a 12.4 hold rate as 12.4%, never 1240%", () => {
    const row = formatCreativeRow(creative());
    expect(row).toContain("12.4%");
    expect(row).not.toContain("1240");
  });

  it("keeps every percentage field within a plausible range for real inputs", () => {
    // A ×100 regression on any of the three pushes at least one field past 100%.
    const row = formatCreativeRow(creative());
    const pcts = [...row.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(pcts).toHaveLength(3);
    for (const p of pcts) expect(p).toBeLessThanOrEqual(100);
  });

  it("renders money and ROAS in their own units", () => {
    const row = formatCreativeRow(creative());
    expect(row).toContain("$4211");
    expect(row).toContain("2.13x");
    expect(row).toContain("$20");
  });

  it("falls back to 0%/? rather than NaN/undefined on null metrics", () => {
    const row = formatCreativeRow({
      ad_name: "Bare", spend: null, roas: null, cpa: null,
      ctr: null, thumb_stop_rate: null, hold_rate: null,
      ad_type: null, hook: null, style: null, ad_status: null,
    });
    expect(row).not.toContain("NaN");
    expect(row).not.toContain("undefined");
    expect(row).toContain("0.00%");
    expect(row).toContain("?");
  });
});

describe("formatCreativeTable", () => {
  it("emits one line per creative", () => {
    const table = formatCreativeTable([creative(), creative({ ad_name: "Second" })]);
    expect(table.split("\n")).toHaveLength(2);
  });

  it("caps the table at the documented limit", () => {
    const many = Array.from({ length: CREATIVE_TABLE_LIMIT + 15 }, (_, i) =>
      creative({ ad_name: `Ad ${i}` }));
    expect(formatCreativeTable(many).split("\n")).toHaveLength(CREATIVE_TABLE_LIMIT);
  });

  it("column header matches the field order actually rendered", () => {
    // Drift here silently mislabels the model's columns — e.g. it reads hold
    // rate under the "hook%" heading and reasons about the wrong metric.
    const cols = CREATIVE_TABLE_COLUMNS.split(" | ");
    const cells = formatCreativeRow(creative()).split(" | ");
    expect(cells).toHaveLength(cols.length);
    expect(cols[4]).toBe("ctr%");
    expect(cells[4]).toBe("1.67%");
    expect(cols[5]).toBe("hook%");
    expect(cells[5]).toBe("31.5%");
    expect(cols[6]).toBe("hold%");
    expect(cells[6]).toBe("12.4%");
  });
});
