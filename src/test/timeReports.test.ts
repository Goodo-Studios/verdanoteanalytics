/**
 * Time reports (OS-013), the pure module. The sample below is made up; every expected total was
 * worked out by hand from the start and end times and is written out next to the assertion.
 *
 * Studio zone is America/New_York. In November 2026 that is UTC-5, except before 2am on 1 November
 * (still UTC-4). "This month" for now = 2026-11-12 is 2026-11-01T04:00Z up to 2026-12-01T05:00Z.
 */
import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  CSV_HEADER,
  GOODO_TIME_CATEGORY,
  applyFilters,
  csvCell,
  csvFileName,
  decimalHours,
  filterOptions,
  hmm,
  hoursText,
  inRange,
  presetDates,
  rangeLabel,
  reportCsv,
  resolveRange,
  scopeStatus,
  summarise,
  zonedMidnightUtc,
  type ReportEntry,
} from "@/lib/timeReports";

const NOW = new Date("2026-11-12T15:00:00Z"); // Thursday 12 November, 10:00 in New York

const ALICE = { name: "Alice", email: "alice@example.test" };
const BOB = { name: "Bob", email: "bob@example.test" };
const GLOW = { name: "Glow Drip" };
const CUT = { title: "Cut v1", content_type: "Video" };
const HOOKS = { title: "Hooks", content_type: "Static" };

function entry(p: Partial<ReportEntry> & Pick<ReportEntry, "id" | "start_at" | "end_at">): ReportEntry {
  return {
    person_id: "alice",
    task_id: null,
    client_slug: null,
    is_internal: false,
    category: null,
    description: "",
    source_id: null,
    project_id: null,
    person: ALICE,
    task: null,
    client: null,
    project: null,
    ...p,
  };
}

// e1  Alice, task Cut v1 (Video), Glow Drip, Editing       2h 00m = 7200 s
// e2  Alice, task Hooks (Static), Glow Drip, no category  0h 30m = 1800 s
// e3  Bob, no task, Glow Drip, Strategy                   1h 15m = 4500 s
// e4  Bob, Internal, Admin                                0h 45m = 2700 s
// e5  Bob, Goodo Time project "Retainer" of "glow drip"   3h 00m = 10800 s
// e6  Alice, Goodo Time project "Studio", no client       1h 00m = 3600 s
// e7  Alice, running timer on Cut v1                      left out (no end)
// e8  Bob, Cut v1, Editing, 31 Oct 23:30 New York         left out (before the month), 1h
// e9  Alice, Cut v1, Editing, 30 Nov 23:30 New York       0h 30m = 1800 s (inside the month)
const SAMPLE: ReportEntry[] = [
  entry({ id: "e1", task_id: "t1", task: CUT, client_slug: "glow", client: GLOW, category: "Editing", start_at: "2026-11-02T14:00:00Z", end_at: "2026-11-02T16:00:00Z" }),
  entry({ id: "e2", task_id: "t2", task: HOOKS, client_slug: "glow", client: GLOW, start_at: "2026-11-03T14:00:00Z", end_at: "2026-11-03T14:30:00Z" }),
  entry({ id: "e3", person_id: "bob", person: BOB, client_slug: "glow", client: GLOW, category: "Strategy", start_at: "2026-11-04T15:00:00Z", end_at: "2026-11-04T16:15:00Z" }),
  entry({ id: "e4", person_id: "bob", person: BOB, is_internal: true, category: "Admin", start_at: "2026-11-05T13:00:00Z", end_at: "2026-11-05T13:45:00Z" }),
  entry({
    id: "e5", person_id: "bob", person: BOB, source_id: 7, project_id: "p1",
    project: { name: "Retainer", client: { name: "glow drip" } },
    start_at: "2026-11-06T14:00:00Z", end_at: "2026-11-06T17:00:00Z",
  }),
  entry({ id: "e6", source_id: 8, project_id: "p2", project: { name: "Studio", client: null }, start_at: "2026-11-07T14:00:00Z", end_at: "2026-11-07T15:00:00Z" }),
  entry({ id: "e7", task_id: "t1", task: CUT, client_slug: "glow", client: GLOW, category: "Editing", start_at: "2026-11-12T14:00:00Z", end_at: null }),
  entry({ id: "e8", person_id: "bob", person: BOB, task_id: "t1", task: CUT, client_slug: "glow", client: GLOW, category: "Editing", start_at: "2026-11-01T03:30:00Z", end_at: "2026-11-01T04:30:00Z" }),
  entry({ id: "e9", task_id: "t1", task: CUT, client_slug: "glow", client: GLOW, category: "Editing", start_at: "2026-12-01T04:30:00Z", end_at: "2026-12-01T05:00:00Z" }),
];

function month() {
  const r = resolveRange("this-month", {}, NOW);
  if (!r.range) throw new Error(r.error);
  return inRange(SAMPLE, r.range.fromIso, r.range.toIso);
}

const rows = (by: Parameters<typeof summarise>[1]) => summarise(month(), by).groups.map((g) => [g.label, g.seconds, g.entries]);

describe("ranges in the studio zone", () => {
  it("finds local midnight across both daylight saving changes", () => {
    expect(zonedMidnightUtc("2026-11-01")).toBe("2026-11-01T04:00:00.000Z"); // still EDT at midnight
    expect(zonedMidnightUtc("2026-11-02")).toBe("2026-11-02T05:00:00.000Z"); // EST
    expect(zonedMidnightUtc("2026-03-08")).toBe("2026-03-08T05:00:00.000Z"); // EST until 2am
    expect(zonedMidnightUtc("2026-03-09")).toBe("2026-03-09T04:00:00.000Z"); // EDT
  });

  it("resolves the four presets Monday to Sunday and by calendar month", () => {
    expect(presetDates("this-week", NOW)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(presetDates("last-week", NOW)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(presetDates("this-month", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(presetDates("last-month", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("uses the New York date, not the UTC one, and crosses the year", () => {
    // 03:00Z on Monday 5 January is still Sunday 4 January in New York.
    const late = new Date("2026-01-05T03:00:00Z");
    expect(presetDates("this-week", late)).toEqual({ from: "2025-12-29", to: "2026-01-04" });
    expect(presetDates("last-month", late)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("gives query bounds from local midnight to the midnight after the last day", () => {
    const r = resolveRange("this-month", {}, NOW);
    expect(r.range).toMatchObject({ from: "2026-11-01", to: "2026-11-30", fromIso: "2026-11-01T04:00:00.000Z", toIso: "2026-12-01T05:00:00.000Z" });
  });

  it("checks a custom range", () => {
    expect(resolveRange("custom", { from: "2026-11-03", to: "2026-11-05" }, NOW).range).toMatchObject({
      fromIso: "2026-11-03T05:00:00.000Z",
      toIso: "2026-11-06T05:00:00.000Z",
    });
    expect(resolveRange("custom", { from: "2026-11-05", to: "2026-11-03" }).error).toBe("The end date must be on or after the start date.");
    expect(resolveRange("custom", { from: "", to: "2026-11-03" }).error).toBe("Choose a start date and an end date.");
    expect(resolveRange("custom", { from: "2025-01-01", to: "2026-01-03" }).error).toBe("Reports cover at most one year at a time.");
  });

  it("labels a range", () => {
    expect(rangeLabel({ from: "2026-11-01", to: "2026-11-30" })).toBe("1 Nov to 30 Nov 2026");
    expect(csvFileName({ from: "2026-11-01", to: "2026-11-30" })).toBe("time-report-2026-11-01-to-2026-11-30.csv");
  });
});

describe("which entries count", () => {
  it("keeps completed entries that started inside the range and drops running ones", () => {
    expect(month().map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e9"]);
  });

  it("totals 9 hours over 7 entries: 7200+1800+4500+2700+10800+3600+1800 = 32400 s", () => {
    const s = summarise(month(), "client");
    expect(s.totalSeconds).toBe(32400);
    expect(s.entryCount).toBe(7);
  });

  it("skips a running entry even when it is handed to summarise", () => {
    expect(summarise(SAMPLE.filter((e) => e.id === "e7"), "task")).toEqual({ groups: [], totalSeconds: 0, entryCount: 0 });
  });
});

describe("groupings match the hand-checked sample", () => {
  it("by client: Goodo Time's 'glow drip' joins the app's Glow Drip", () => {
    // Glow Drip = e1 7200 + e2 1800 + e3 4500 + e5 10800 + e9 1800 = 26100 (7h 15m)
    expect(rows("client")).toEqual([
      ["Glow Drip", 26100, 5],
      ["(No client)", 3600, 1],
      ["Internal", 2700, 1],
    ]);
  });

  it("by person", () => {
    // Bob = 4500 + 2700 + 10800 = 18000; Alice = 7200 + 1800 + 3600 + 1800 = 14400
    expect(rows("person")).toEqual([
      ["Bob", 18000, 3],
      ["Alice", 14400, 4],
    ]);
  });

  it("by task: Goodo Time rows group by their project", () => {
    // Cut v1 = e1 7200 + e9 1800 = 9000; (No task) = e3 4500 + e4 2700 = 7200
    expect(rows("task")).toEqual([
      ["Goodo Time: glow drip / Retainer", 10800, 1],
      ["Cut v1", 9000, 2],
      ["(No task)", 7200, 2],
      ["Goodo Time: Studio", 3600, 1],
      ["Hooks", 1800, 1],
    ]);
  });

  it("by content type", () => {
    // none = e3 4500 + e4 2700 + e5 10800 + e6 3600 = 21600; Video = 7200 + 1800 = 9000
    expect(rows("contentType")).toEqual([
      ["(No content type)", 21600, 4],
      ["Video", 9000, 2],
      ["Static", 1800, 1],
    ]);
  });

  it("by category: Goodo Time rows are Unsorted (Goodo Time)", () => {
    // Unsorted = e5 10800 + e6 3600 = 14400; Editing = e1 7200 + e9 1800 = 9000
    expect(rows("category")).toEqual([
      [GOODO_TIME_CATEGORY, 14400, 2],
      ["Editing", 9000, 2],
      ["Strategy", 4500, 1],
      ["Admin", 2700, 1],
      ["(No category)", 1800, 1],
    ]);
  });

  it("gives each group its share of the total", () => {
    const [bob, alice] = summarise(month(), "person").groups;
    expect(bob.share).toBeCloseTo(18000 / 32400);
    expect(alice.share).toBeCloseTo(14400 / 32400);
  });
});

describe("filters", () => {
  it("filters by client group and by person", () => {
    const glow = applyFilters(month(), { client: "c:glow drip" });
    expect(glow.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e5", "e9"]);
    expect(summarise(applyFilters(month(), { client: "c:glow drip", person: "bob" }), "task").totalSeconds).toBe(4500 + 10800);
  });

  it("lists the options found in the data", () => {
    expect(filterOptions(month(), "client")).toEqual([
      { value: "(No client)", label: "(No client)" },
      { value: "c:glow drip", label: "Glow Drip" },
      { value: "Internal", label: "Internal" },
    ]);
    expect(filterOptions(month(), "person")).toEqual([
      { value: "alice", label: "Alice" },
      { value: "bob", label: "Bob" },
    ]);
  });
});

describe("hours formats", () => {
  it("decimal with two places and h:mm", () => {
    expect(decimalHours(5400)).toBe("1.50");
    expect(decimalHours(4500)).toBe("1.25");
    expect(hmm(4500)).toBe("1:15");
    expect(hmm(5430)).toBe("1:31");
    expect(hmm(0)).toBe("0:00");
    expect(hoursText(12.5)).toBe("12.5 h");
    expect(hoursText(20)).toBe("20 h");
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell(null)).toBe("");
  });

  it("guards cells a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });

  it("starts with a BOM and the header, one CRLF row per completed entry, in New York time", () => {
    const csv = reportCsv(month());
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(lines[0]).toBe("Date,Start,End,Hours,H:MM,Person,Email,Client,Task,Content type,Category,Description");
    expect(lines).toHaveLength(1 + 7 + 1); // header, 7 entries, empty after the last CRLF
    expect(lines[lines.length - 1]).toBe("");
    expect(lines[1]).toBe("2026-11-02,09:00,11:00,2.00,2:00,Alice,alice@example.test,Glow Drip,Cut v1,Video,Editing,");
    expect(lines[5]).toBe("2026-11-06,09:00,12:00,3.00,3:00,Bob,bob@example.test,glow drip,Goodo Time: glow drip / Retainer,(No content type),Unsorted (Goodo Time),");
    // e9 started 30 Nov 23:30 New York, which is 1 Dec in UTC.
    expect(lines[7]).toBe("2026-11-30,23:30,00:00,0.50,0:30,Alice,alice@example.test,Glow Drip,Cut v1,Video,Editing,");
  });

  it("keeps awkward descriptions intact", () => {
    const e = { ...SAMPLE[0], description: '=1+1, "quoted"\nnext' };
    const line = reportCsv([e]).slice(1).split("\r\n")[1];
    expect(line.endsWith(`"'=1+1, ""quoted""\nnext"`)).toBe(true);
  });
});

describe("month against scope", () => {
  it("under scope", () => {
    expect(scopeStatus(12.5 * 3600, 20)).toMatchObject({ text: "12.5 h of 20 h this month", over: false, ratio: 0.625 });
  });
  it("over scope", () => {
    expect(scopeStatus(22 * 3600, 20)).toMatchObject({ text: "22 h of 20 h this month", over: true });
  });
  it("no scope set", () => {
    expect(scopeStatus(3 * 3600, null)).toMatchObject({ text: "3 h this month, no scope hours set", ratio: null, over: false });
  });
});
