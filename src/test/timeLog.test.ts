/**
 * Pure helpers for the timer and weekly log (OS-012): Monday-to-Sunday weeks in the studio zone,
 * durations, h:mm:ss and hours formatting, grouping by day with totals, entry labels, form checks
 * and plain words for database errors.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  addDays,
  clockOffsetMs,
  dayLabel,
  durationSeconds,
  entryLabel,
  formatElapsed,
  formatHours,
  friendlyTimeError,
  groupByDay,
  studioClock,
  studioDate,
  studioToday,
  toTimestamp,
  validateEntryForm,
  weekLabel,
  weekRange,
  weekStartIso,
  type TimeEntryRow,
} from "@/lib/timeLog";

const p2 = (n: number) => String(n).padStart(2, "0");
// A studio-zone (America/New_York) wall-clock time as an instant, whatever zone the machine is in.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => toTimestamp(`${y}-${p2(mo)}-${p2(d)}`, `${p2(h)}:${p2(mi)}`);
const entry = (id: string, start: string, end: string | null, over: Partial<TimeEntryRow> = {}): TimeEntryRow => ({
  id,
  person_id: "p",
  task_id: null,
  client_slug: null,
  is_internal: true,
  category: "Admin",
  description: "",
  start_at: start,
  end_at: end,
  ...over,
});

describe("weeks", () => {
  it("starts on Monday for every day of the week, Sunday included", () => {
    expect(weekStartIso("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(weekStartIso("2026-11-12")).toBe("2026-11-09"); // Thursday
    expect(weekStartIso("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(weekStartIso("2026-11-16")).toBe("2026-11-16");
  });

  it("crosses month and year ends", () => {
    expect(weekStartIso("2027-01-01")).toBe("2026-12-28");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-28", -7)).toBe("2026-12-21");
  });

  it("lists seven days and queries from Monday midnight to the next Monday midnight", () => {
    const w = weekRange("2026-11-12");
    expect(w.days).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(w.fromIso).toBe("2026-11-09T05:00:00.000Z"); // Monday 00:00 EST
    expect(w.toIso).toBe("2026-11-16T05:00:00.000Z");
  });
});

describe("durations and formatting", () => {
  it("measures a finished entry, and a running one up to now", () => {
    expect(durationSeconds(at(2026, 11, 9, 9), at(2026, 11, 9, 10, 30))).toBe(5400);
    const start = new Date(Date.UTC(2026, 10, 9, 9)).toISOString();
    expect(durationSeconds(start, null, Date.UTC(2026, 10, 9, 9, 1, 5))).toBe(65);
    expect(durationSeconds(start, null, Date.UTC(2026, 10, 9, 8))).toBe(0);
  });

  it("formats h:mm:ss and hours", () => {
    expect(formatElapsed(0)).toBe("0:00:00");
    expect(formatElapsed(3725)).toBe("1:02:05");
    expect(formatElapsed(36000)).toBe("10:00:00");
    expect(formatHours(0)).toBe("0m");
    expect(formatHours(45 * 60)).toBe("45m");
    expect(formatHours(2 * 3600 + 5 * 60)).toBe("2h 05m");
  });

  it("turns a date and a clock time into a timestamp and back", () => {
    const ts = toTimestamp("2026-11-10", "09:30");
    expect(ts).toBe("2026-11-10T14:30:00.000Z"); // 09:30 EST
    expect(studioClock(ts)).toBe("09:30");
    expect(studioDate(ts)).toBe("2026-11-10");
  });
});

describe("grouping", () => {
  it("puts entries under the day they start, sorted, with day and week totals", () => {
    const w = weekRange("2026-11-09");
    const g = groupByDay(
      [
        entry("b", at(2026, 11, 9, 11), at(2026, 11, 9, 11, 15)),
        entry("a", at(2026, 11, 9, 9), at(2026, 11, 9, 10, 30)),
        entry("c", at(2026, 11, 11, 14), at(2026, 11, 11, 16)),
        entry("outside", at(2026, 11, 16, 9), at(2026, 11, 16, 10)),
      ],
      w.days,
    );
    expect(g.days).toHaveLength(7);
    expect(g.days[0].entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(g.days[0].seconds).toBe(105 * 60);
    expect(g.days[2].seconds).toBe(2 * 3600);
    expect(g.days[1].entries).toEqual([]);
    expect(g.seconds).toBe(225 * 60);
  });

  it("counts a running entry up to now", () => {
    const w = weekRange("2026-11-09");
    const now = Date.parse(at(2026, 11, 9, 10));
    const g = groupByDay([entry("r", at(2026, 11, 9, 9), null)], w.days, now);
    expect(g.seconds).toBe(3600);
  });
});

describe("labels, checks and errors", () => {
  it("labels by task title, else client or Internal with the category", () => {
    expect(entryLabel({ task_id: "t", task: { title: "Cut v1" }, client: null, client_slug: "glow", is_internal: false, category: null })).toBe("Cut v1");
    expect(entryLabel({ task_id: null, task: null, client: { name: "Glow Drip" }, client_slug: "glow", is_internal: false, category: "Strategy" })).toBe(
      "Glow Drip · Strategy",
    );
    expect(entryLabel({ task_id: null, task: null, client: null, client_slug: null, is_internal: true, category: "Admin" })).toBe("Internal · Admin");
    expect(entryLabel({ task_id: null, task: null, client: null, client_slug: null, is_internal: false, category: null })).toBe("No task");
  });

  it("checks a manual entry before sending it", () => {
    const ok = { date: "2026-11-10", start: "09:00", end: "10:00", taskId: "", client: "glow", category: "Admin" };
    expect(validateEntryForm(ok)).toBeNull();
    expect(validateEntryForm({ ...ok, end: "08:00" })).toBe("The end must be after the start.");
    expect(validateEntryForm({ ...ok, client: "" })).toBe("Choose a task, or a client or Internal.");
    expect(validateEntryForm({ ...ok, category: "" })).toBe("Choose a category for time with no task.");
    expect(validateEntryForm({ ...ok, client: "", category: "", taskId: "t1" })).toBeNull();
    expect(validateEntryForm({ ...ok, date: "" })).toBe("Fill in the date, start and end.");
  });

  it("accepts an overnight entry when the end date is the next day", () => {
    const ok = { date: "2026-11-10", start: "22:00", end: "06:00", taskId: "", client: "glow", category: "Admin" };
    expect(validateEntryForm(ok)).toBe("The end must be after the start.");
    expect(validateEntryForm({ ...ok, endDate: "2026-11-11" })).toBeNull();
    expect(validateEntryForm({ ...ok, endDate: "2026-11-10" })).toBe("The end must be after the start.");
    expect(validateEntryForm({ ...ok, endDate: "2026-11-09" })).toBe("The end must be after the start.");
    // A blank end date means the start date, as before.
    expect(validateEntryForm({ ...ok, end: "23:00", endDate: "" })).toBeNull();
  });

  it("puts database errors in plain words", () => {
    expect(friendlyTimeError('conflicting key value violates exclusion constraint "time_entries_no_overlap"')).toMatch(/overlaps another/);
    expect(friendlyTimeError('new row for relation "time_entries" violates check constraint "time_entries_end_after_start"')).toBe(
      "The end must be after the start.",
    );
    expect(friendlyTimeError('violates check constraint "time_entries_needs_purpose"')).toBe("Choose a task, or a client or Internal with a category.");
    expect(friendlyTimeError("An entry cannot be longer than 24 hours. Split it into separate entries.")).toBe(
      "An entry cannot be longer than 24 hours. Split it into separate entries.",
    );
    expect(friendlyTimeError('new row violates row-level security policy for table "time_entries"')).toBe("You can only change your own time.");
  });
});

describe("one rule for days and weeks: the studio zone, whatever the browser's zone", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });
  const zones = ["America/Los_Angeles", "Europe/London", "Asia/Tokyo", "Pacific/Auckland", "America/New_York"];

  it("gives the same day, clock, week and totals in every browser zone near midnight", () => {
    // 23:30 Sunday 15 Nov in New York (04:30 UTC Monday) and 00:30 Monday 16 Nov in New York.
    const sunLate = "2026-11-16T04:30:00.000Z";
    const monEarly = "2026-11-16T05:30:00.000Z";
    for (const tz of zones) {
      process.env.TZ = tz;
      expect(studioDate(sunLate)).toBe("2026-11-15");
      expect(studioClock(sunLate)).toBe("23:30");
      expect(studioDate(monEarly)).toBe("2026-11-16");
      expect(studioToday(new Date(sunLate))).toBe("2026-11-15");
      const w = weekRange("2026-11-15");
      expect(w.start).toBe("2026-11-09");
      expect(w.fromIso).toBe("2026-11-09T05:00:00.000Z");
      expect(w.toIso).toBe("2026-11-16T05:00:00.000Z");
      const g = groupByDay(
        [entry("late", sunLate, "2026-11-16T05:00:00.000Z"), entry("early", monEarly, "2026-11-16T06:30:00.000Z")],
        w.days,
      );
      expect(g.days[6].entries.map((e) => e.id)).toEqual(["late"]);
      expect(g.seconds).toBe(30 * 60);
      expect(weekLabel("2026-11-09")).toBe("9 Nov to 15 Nov 2026");
      expect(dayLabel("2026-11-09")).toBe("Mon 9 Nov");
    }
  });

  it("handles the DST boundaries: fall back on 1 Nov and spring forward on 8 Mar", () => {
    for (const tz of zones) {
      process.env.TZ = tz;
      // The week of 26 Oct holds the 25-hour day, so it ends at 05:00 UTC on 2 Nov (EST).
      const fall = weekRange("2026-10-28");
      expect(fall.fromIso).toBe("2026-10-26T04:00:00.000Z"); // EDT
      expect(fall.toIso).toBe("2026-11-02T05:00:00.000Z"); // EST
      expect(studioDate("2026-11-01T04:30:00.000Z")).toBe("2026-11-01");
      expect(studioDate("2026-11-02T04:30:00.000Z")).toBe("2026-11-01"); // 23:30 EST on the 1st
      expect(toTimestamp("2026-11-01", "12:00")).toBe("2026-11-01T17:00:00.000Z");
      // The week of 2 Mar holds the 23-hour day.
      const spring = weekRange("2026-03-08");
      expect(spring.start).toBe("2026-03-02");
      expect(spring.fromIso).toBe("2026-03-02T05:00:00.000Z"); // EST
      expect(spring.toIso).toBe("2026-03-09T04:00:00.000Z"); // EDT
      expect(toTimestamp("2026-03-08", "12:00")).toBe("2026-03-08T16:00:00.000Z"); // EDT
      expect(studioClock("2026-03-08T07:30:00.000Z")).toBe("03:30"); // after the 02:00 jump
    }
  });

  it("agrees with Reports: the same instant lands on the same date in both", async () => {
    const { zonedDate } = await import("@/lib/timeReports");
    for (const iso of ["2026-11-16T04:30:00.000Z", "2026-03-08T06:59:00.000Z", "2026-03-08T07:00:00.000Z", "2026-11-01T05:30:00.000Z"]) {
      expect(studioDate(iso)).toBe(zonedDate(iso));
    }
  });
});

describe("clockOffsetMs", () => {
  it("is the server time minus the browser clock at the middle of the round trip", () => {
    // The browser sent at :00 and heard back at :02, so it read :01 when the server said :11.
    const t0 = Date.UTC(2026, 10, 9, 12, 0, 0);
    expect(clockOffsetMs("2026-11-09T12:00:11.000Z", t0, t0 + 2000)).toBe(10_000);
  });

  it("is negative when the browser clock runs ahead", () => {
    const t0 = Date.UTC(2026, 10, 9, 12, 5, 0);
    expect(clockOffsetMs("2026-11-09T12:00:00.000Z", t0, t0)).toBe(-300_000);
  });

  it("falls back to 0 for a missing or unreadable server time", () => {
    expect(clockOffsetMs(null, 1000, 2000)).toBe(0);
    expect(clockOffsetMs(undefined, 1000, 2000)).toBe(0);
    expect(clockOffsetMs("not a date", 1000, 2000)).toBe(0);
  });

  it("makes a running entry's elapsed time follow the server clock", () => {
    // Started 90 s ago by the server's clock; the browser clock is 5 minutes slow.
    const serverNow = Date.UTC(2026, 10, 9, 12, 0, 0);
    const browserNow = serverNow - 300_000;
    const offset = clockOffsetMs(new Date(serverNow).toISOString(), browserNow, browserNow);
    const start = new Date(serverNow - 90_000).toISOString();
    expect(durationSeconds(start, null, browserNow)).toBe(0); // the old way: clamped, shows 0
    expect(durationSeconds(start, null, browserNow + offset)).toBe(90);
  });
});
