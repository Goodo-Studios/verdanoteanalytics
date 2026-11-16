/**
 * Dates shown a day off (audit plan item 6.4).
 *
 * `new Date("2026-10-01")` reads a date-only string as UTC midnight, which in US time is the
 * evening of Sep 30, so report ranges and rotation cohorts showed the day before. The creative
 * library built its "last N days" window from local time and then took the UTC date, which
 * can slip a day across a daylight-saving change. Runs in Los Angeles time.
 */
process.env.TZ = "America/Los_Angeles";

import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ReportPrintLayout } from "@/components/reports/ReportPrintLayout";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import("@/lib/dateRange");

describe("date-only strings are shown as the same calendar day in US time", () => {
  it("the test really runs west of UTC", () => {
    expect(new Date(2026, 9, 1).getTimezoneOffset()).toBeGreaterThan(0);
  });

  it("report print layout shows the report's own first and last day", () => {
    const report = {
      report_name: "October",
      created_at: "2026-11-01T18:00:00Z",
      date_range_start: "2026-10-01",
      date_range_end: "2026-10-31",
    };
    render(<ReportPrintLayout report={report} topCreatives={[]} tagBreakdown={[]} highlights={[]} />);
    const text = document.body.textContent || "";
    expect(text).toContain(new Date(2026, 9, 1).toLocaleDateString());
    expect(text).toContain(new Date(2026, 9, 31).toLocaleDateString());
    expect(text).not.toContain(new Date(2026, 8, 30).toLocaleDateString());
    screen.getByText(/October/);
  });

  it("formatReportRange keeps both days", async () => {
    const { formatReportRange } = await load();
    expect(formatReportRange("2026-10-01", "2026-10-31")).toBe(
      `${new Date(2026, 9, 1).toLocaleDateString()} – ${new Date(2026, 9, 31).toLocaleDateString()}`,
    );
    expect(formatReportRange(null, "2026-10-31")).toBe("");
  });
});

describe("'last N days' uses the UTC calendar day, like the server", () => {
  it("utcDaysAgoIso counts back whole UTC days, including across a daylight-saving change", async () => {
    const { utcDaysAgoIso } = await load();
    // 4:30pm Pacific on Nov 15 is 00:30 UTC on Nov 16; DST ended Nov 1.
    const now = new Date("2026-11-16T00:30:00Z");
    expect(utcDaysAgoIso(1, now)).toBe("2026-11-16");
    expect(utcDaysAgoIso(30, now)).toBe("2026-10-18");
  });
});

describe("pages use the shared date helpers", () => {
  it("no page parses a report or cohort date with new Date(...)", () => {
    for (const p of [
      "../pages/ReportDetailPage.tsx",
      "../pages/ReportBuilderPage.tsx",
      "../pages/PublicReportPage.tsx",
      "../components/reports/ReportPrintLayout.tsx",
    ]) {
      expect(read(p), p).not.toMatch(/new Date\(report\.date_range_(start|end)\)/);
    }
    expect(read("../pages/CreativeRotationPage.tsx")).not.toMatch(/new Date\(launchWeek\)/);
  });

  it("the creative library does not mix local dates with toISOString", () => {
    expect(read("../features/creative-library/CreativeLibraryPage.tsx")).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
