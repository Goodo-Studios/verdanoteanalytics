import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import { parsePickerDate, formatPickerDate } from "@/lib/dateRange";

// Bug 2 regression: the date picker stored "yyyy-MM-dd" but displayed it via
// `new Date(str)`, which parses as UTC midnight and renders one day earlier in
// any negative-offset timezone (US). These assert the local-calendar contract,
// which holds in every timezone — `new Date("2026-06-16").getDate()` would be
// 15 in US tz, so this is a genuine guard against the regression.

describe("parsePickerDate", () => {
  it("parses a date string to LOCAL midnight, preserving the calendar day", () => {
    const d = parsePickerDate("2026-06-16");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 16]);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });

  it("round-trips through format() back to the same string", () => {
    for (const s of ["2026-06-16", "2026-01-01", "2026-12-31", "2026-03-09"]) {
      expect(format(parsePickerDate(s), "yyyy-MM-dd")).toBe(s);
    }
  });
});

describe("formatPickerDate", () => {
  it("displays the picked day, not the UTC-shifted previous day", () => {
    expect(formatPickerDate("2026-06-16", "MMM d")).toBe("Jun 16");
    expect(formatPickerDate("2026-06-16", "MMM d, yyyy")).toBe("Jun 16, 2026");
    expect(formatPickerDate("2026-01-01", "MMM d")).toBe("Jan 1");
  });
});
