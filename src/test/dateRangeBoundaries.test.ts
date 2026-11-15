import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rollingPresetRange, priorPeriodRange } from "@/lib/dateRange";
import { resolveAgencyRanges } from "@/hooks/useAgencyDashboardData";

function utcNoon(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12));
}

describe("This Week / This Month never produce an inverted range", () => {
  it("Monday: This Week falls back to the single day (Monday)", () => {
    // 2026-11-16 is a Monday.
    expect(rollingPresetRange("thisWeek", utcNoon(2026, 11, 16))).toEqual({ dateFrom: "2026-11-16", dateTo: "2026-11-16" });
  });

  it("Tuesday: This Week runs Monday to yesterday (Monday)", () => {
    expect(rollingPresetRange("thisWeek", utcNoon(2026, 11, 17))).toEqual({ dateFrom: "2026-11-16", dateTo: "2026-11-16" });
  });

  it("Sunday: This Week runs Monday to Saturday", () => {
    expect(rollingPresetRange("thisWeek", utcNoon(2026, 11, 22))).toEqual({ dateFrom: "2026-11-16", dateTo: "2026-11-21" });
  });

  it("1st of the month: This Month falls back to the single day", () => {
    expect(rollingPresetRange("thisMonth", utcNoon(2026, 12, 1))).toEqual({ dateFrom: "2026-12-01", dateTo: "2026-12-01" });
  });

  it("2nd of the month: This Month runs 1st to 1st", () => {
    expect(rollingPresetRange("thisMonth", utcNoon(2026, 12, 2))).toEqual({ dateFrom: "2026-12-01", dateTo: "2026-12-01" });
  });

  it("mid month: This Month runs 1st to yesterday", () => {
    expect(rollingPresetRange("thisMonth", utcNoon(2026, 12, 15))).toEqual({ dateFrom: "2026-12-01", dateTo: "2026-12-14" });
  });

  it("every day of a month yields from <= to for both presets", () => {
    for (let d = 1; d <= 31; d++) {
      for (const id of ["thisWeek", "thisMonth"]) {
        const r = rollingPresetRange(id, utcNoon(2026, 10, d))!;
        expect(r.dateFrom <= r.dateTo).toBe(true);
      }
    }
  });
});

describe.each(["Pacific/Auckland", "America/Los_Angeles", "UTC"])("prior period math in TZ %s", (tz) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("prior of a 7-day range is the 7 days before it", () => {
    expect(priorPeriodRange("2026-11-08", "2026-11-14")).toEqual({ dateFrom: "2026-11-01", dateTo: "2026-11-07" });
  });

  it("prior of a single day is the previous day", () => {
    expect(priorPeriodRange("2026-11-14", "2026-11-14")).toEqual({ dateFrom: "2026-11-13", dateTo: "2026-11-13" });
  });

  it("crosses month and year boundaries", () => {
    expect(priorPeriodRange("2027-01-01", "2027-01-10")).toEqual({ dateFrom: "2026-12-22", dateTo: "2026-12-31" });
  });

  it("spans a DST change without drifting", () => {
    // US DST ended 2026-11-01; NZ DST began 2026-09-27.
    expect(priorPeriodRange("2026-11-02", "2026-11-04")).toEqual({ dateFrom: "2026-10-30", dateTo: "2026-11-01" });
    expect(priorPeriodRange("2026-09-28", "2026-09-30")).toEqual({ dateFrom: "2026-09-25", dateTo: "2026-09-27" });
  });

  it("agency ranges derive the prior range from a custom selection", () => {
    expect(resolveAgencyRanges("2026-11-08", "2026-11-14")).toEqual({
      pFrom: "2026-11-08",
      pTo: "2026-11-14",
      priorFrom: "2026-11-01",
      priorTo: "2026-11-07",
    });
  });

  it("agency default is month-to-date in local dates (no UTC shift)", () => {
    const r = resolveAgencyRanges(undefined, undefined, new Date(2026, 10, 14, 0, 30));
    expect(r.pFrom).toBe("2026-11-01");
    expect(r.pTo).toBe("2026-11-14");
    expect(r.priorTo).toBe("2026-10-31");
  });
});
