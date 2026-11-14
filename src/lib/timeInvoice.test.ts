// Ports Goodo Time's test/invoices.test.js cases that decide an invoice's figures, with
// the same inputs and expected numbers.
import { describe, expect, it } from "vitest";
import {
  halfContaining,
  halfFee,
  halfMonth,
  invoiceFigures,
  localDate,
  periodUtcRange,
  recentHalves,
  type InvoiceEntry,
} from "./timeInvoice";

const zone = "America/New_York";
const at = (hhmm: string, day = "30") => `2026-10-${day}T${hhmm}:00.000Z`;
const lateOctober = { from: "2026-10-16", to: "2026-10-31" };
const earlyOctober = { from: "2026-10-01", to: "2026-10-15" };

let nextId = 1;
function entry(start: string, end: string | null, project: "film" | "reel" | null, extra: Partial<InvoiceEntry> = {}): InvoiceEntry {
  const projects = {
    film: { projectId: "film", projectName: "Brand film", clientName: "Bearaby" },
    reel: { projectId: "reel", projectName: "Reels", clientName: null },
  };
  const p = project ? projects[project] : { projectId: null, projectName: null, clientName: null };
  return { id: nextId++, startAt: start, endAt: end, ...p, ...extra };
}

/** Alice's second half of October in Goodo Time's tests. */
function aliceLateOctober(): InvoiceEntry[] {
  return [
    entry(at("13:00"), at("14:30"), "film"),
    entry(at("15:00"), at("16:00"), "film"),
    entry(at("13:00", "31"), at("13:45", "31"), "reel"),
  ];
}

describe("half-month periods", () => {
  it("accepts only the 1st to the 15th or the 16th to the last day", () => {
    expect(halfMonth("2026-10-01", "2026-10-15").first).toBe(true);
    expect(halfMonth("2026-02-16", "2026-02-28").first).toBe(false);
    expect(halfMonth("2026-10-16", "2026-10-31").name).toBe("Second half of October 2026");
    expect(() => halfMonth("2026-10-01", "2026-10-31")).toThrow(/1st to the 15th/);
    expect(() => halfMonth("2026-10-15", "2026-10-31")).toThrow();
    expect(() => halfMonth("2026-10-16", "2026-10-30")).toThrow();
  });

  it("handles leap years and labels the half", () => {
    expect(halfContaining("2028-02-20").to).toBe("2028-02-29");
    expect(halfContaining("2026-10-03").label).toBe("1 to 15 Oct 2026");
    expect(halfContaining("2026-10-20").label).toBe("16 to 31 Oct 2026");
  });

  it("suggests the half-month that just ended", () => {
    const early = recentHalves(zone, new Date("2026-11-03T15:00:00Z"));
    expect([early.halves[0].from, early.suggested.from]).toEqual(["2026-11-01", "2026-10-16"]);
    expect(recentHalves(zone, new Date("2026-11-20T15:00:00Z")).suggested.from).toBe("2026-11-01");
    // On the last day of a half, that half is the one to invoice.
    expect(recentHalves(zone, new Date("2026-11-15T20:00:00Z")).suggested.from).toBe("2026-11-01");
    expect(early.halves.length).toBe(6);
  });

  it("splits the monthly fee into two payments that add up", () => {
    expect(halfFee(500000, true)).toBe(250000);
    expect(halfFee(250001, true) + halfFee(250001, false)).toBe(250001);
    expect(halfFee(250001, false)).toBe(125001);
  });

  it("uses the studio time zone for the period bounds, across a DST change", () => {
    // 1 Nov 2026 is the day New York leaves daylight time.
    const { startMs, endMs } = periodUtcRange("2026-10-16", "2026-10-31", zone);
    expect(new Date(startMs).toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(periodUtcRange("2026-11-01", "2026-11-15", zone).endMs).toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(localDate("2026-10-16T03:30:00.000Z", zone)).toBe("2026-10-15");
  });
});

describe("invoice figures", () => {
  it("carries half the monthly fee and the hours from the timesheet", () => {
    const figures = invoiceFigures({ ...lateOctober, zone, monthlyFeeCents: 500000, entries: aliceLateOctober() });
    expect(figures.fee).toEqual({ description: "Monthly fee, second half (16 to 31 Oct 2026)", amountCents: 250000 });
    expect(figures.timeLines).toEqual([
      { description: "Bearaby / Brand film", seconds: 9000 },
      { description: "Reels", seconds: 2700 },
    ]);
    expect(figures.totalCents).toBe(250000);
    expect(figures.entryIds.length).toBe(3);
  });

  it("puts the odd cent on the second half", () => {
    const entries = aliceLateOctober();
    expect(invoiceFigures({ ...earlyOctober, zone, monthlyFeeCents: 250001, entries }).fee?.amountCents).toBe(125000);
    expect(invoiceFigures({ ...lateOctober, zone, monthlyFeeCents: 250001, entries }).fee?.amountCents).toBe(125001);
  });

  it("keeps the 15th in the first half and the 16th in the second", () => {
    // 15 Oct 23:30 and 16 Oct 00:30 in New York.
    const entries = [
      entry("2026-10-16T03:30:00.000Z", "2026-10-16T04:00:00.000Z", null, { id: "late-15th" }),
      entry("2026-10-16T04:30:00.000Z", "2026-10-16T05:00:00.000Z", null, { id: "early-16th" }),
    ];
    expect(invoiceFigures({ ...earlyOctober, zone, monthlyFeeCents: null, entries }).entryIds).toEqual(["late-15th"]);
    expect(invoiceFigures({ ...lateOctober, zone, monthlyFeeCents: null, entries }).entryIds).toEqual(["early-16th"]);
  });

  it("leaves out running timers and time already on another invoice", () => {
    const entries = [
      entry(at("10:00"), at("11:00"), null, { id: "done" }),
      entry(at("12:00"), null, null, { id: "running" }),
      entry(at("08:00"), at("09:00"), null, { id: "elsewhere", invoiceId: "other" }),
      entry(at("06:00"), at("07:00"), null, { id: "on-this", invoiceId: "this" }),
    ];
    const figures = invoiceFigures({ ...lateOctober, zone, monthlyFeeCents: 500000, entries, invoiceId: "this" });
    expect(figures.entryIds).toEqual(["on-this", "done"]);
    expect(figures.timeLines).toEqual([{ description: "(No project)", seconds: 7200 }]);
  });

  it("follows the timer and the fee", () => {
    const entries = [...aliceLateOctober(), entry(at("18:00", "31"), at("19:00", "31"), "reel")];
    const figures = invoiceFigures({ ...lateOctober, zone, monthlyFeeCents: 600000, entries });
    expect(figures.entryIds.length).toBe(4);
    expect(figures.timeLines.find((l) => l.description === "Reels")?.seconds).toBe(2700 + 3600);
    expect(figures.totalCents).toBe(300000);
  });

  it("adds amounts such as expenses to the total", () => {
    const figures = invoiceFigures({
      ...lateOctober,
      zone,
      monthlyFeeCents: 500000,
      entries: aliceLateOctober(),
      extras: [{ description: "Stock music", amountCents: 4599 }],
    });
    expect(figures.totalCents).toBe(250000 + 4599);
  });

  it("has no fee line before an admin sets the fee", () => {
    const figures = invoiceFigures({ ...lateOctober, zone, monthlyFeeCents: null, entries: aliceLateOctober() });
    expect(figures.fee).toBeNull();
    expect(figures.totalCents).toBe(0);
    expect(figures.totalSeconds).toBe(11700);
  });

  it("refuses a period that is not a half-month", () => {
    expect(() => invoiceFigures({ from: "2026-10-01", to: "2026-10-31", zone, monthlyFeeCents: 1, entries: [] })).toThrow(
      /1st to the 15th/,
    );
  });
});
