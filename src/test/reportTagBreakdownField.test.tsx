/**
 * The report's tag breakdown groups by the tag field the user picks (Matthew's decision 17).
 *
 * The section ignored its "Tag Category" picker: it counted the report's iteration suggestion
 * labels whatever was picked, so Hook Type, Format, Creative Type and Person all showed the
 * same list. It now groups the report's own creatives by the picked field, using the numbers
 * saved with the report (its snapshot), so the breakdown does not change after the report is
 * generated. Reports saved before per-field groups were stored say so instead of guessing.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TagBreakdownSection } from "@/components/reports/sections/TagBreakdownSection";
import { buildReportSnapshot } from "../../supabase/functions/_shared/report-snapshot.ts";

const creatives = [
  { ad_id: "a1", hook: "Question", ad_type: "UGC", style: "Talking head", person: "Ana", spend: 600, purchase_value: 1800, purchases: 6 },
  { ad_id: "a2", hook: "Question", ad_type: "Static", style: "Product", person: "Ben", spend: 200, purchase_value: 200, purchases: 1 },
  { ad_id: "a3", hook: "Stat", ad_type: "UGC", style: "Talking head", person: "Ana", spend: 200, purchase_value: 600, purchases: 2 },
];

const report = {
  id: "r1",
  // Labels the old code counted no matter which field was picked.
  iteration_suggestions: JSON.stringify([{ label: "Scale" }, { label: "Scale" }, { label: "Kill" }]),
  snapshot: buildReportSnapshot(creatives, []),
};

const rowLabels = () => screen.getAllByTestId("tag-breakdown-row").map((r) => r.getAttribute("data-tag"));

afterEach(cleanup);

describe("report tag breakdown follows the picked tag field", () => {
  it("Hook Type groups the report's creatives by hook, biggest spend first", () => {
    render(<TagBreakdownSection config={{ tagField: "hook" }} report={report} />);
    expect(rowLabels()).toEqual(["Question", "Stat"]);
    expect(screen.queryByText("Scale")).toBeNull();
  });

  it("Format groups by ad type", () => {
    render(<TagBreakdownSection config={{ tagField: "ad_type" }} report={report} />);
    expect(rowLabels()).toEqual(["UGC", "Static"]);
  });

  it("Creative Type groups by style", () => {
    render(<TagBreakdownSection config={{ tagField: "style" }} report={report} />);
    expect(rowLabels()).toEqual(["Talking head", "Product"]);
  });

  it("Person groups by person and shows each group's ROAS and spend share", () => {
    render(<TagBreakdownSection config={{ tagField: "person" }} report={report} />);
    expect(rowLabels()).toEqual(["Ana", "Ben"]);
    const ana = screen.getAllByTestId("tag-breakdown-row")[0];
    // Ana: spend 800 of 1000, revenue 2400, so ROAS 3.00x and 80% of spend.
    expect(ana.textContent).toContain("3.00x");
    expect(ana.textContent).toContain("80%");
  });

  it("a report saved without per-field groups says so instead of showing other data", () => {
    render(<TagBreakdownSection config={{ tagField: "person" }} report={{ ...report, snapshot: null }} />);
    expect(screen.queryAllByTestId("tag-breakdown-row")).toHaveLength(0);
    expect(screen.getByText(/saved before tag breakdowns were stored/i)).toBeTruthy();
  });
});
