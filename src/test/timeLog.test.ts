/**
 * Pure helpers for the timer and weekly log (OS-012): Monday-to-Sunday weeks in local time,
 * durations, h:mm:ss and hours formatting, grouping by day with totals, entry labels, form checks
 * and plain words for database errors.
 */
import { describe, expect, it } from "vitest";
import {
  addDays,
  durationSeconds,
  entryLabel,
  formatElapsed,
  formatHours,
  friendlyTimeError,
  groupByDay,
  localClock,
  localIso,
  toTimestamp,
  validateEntryForm,
  weekRange,
  weekStartIso,
  type TimeEntryRow,
} from "@/lib/timeLog";

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
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
    expect(w.fromIso).toBe(new Date(2026, 10, 9).toISOString());
    expect(w.toIso).toBe(new Date(2026, 10, 16).toISOString());
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
    expect(ts).toBe(new Date(2026, 10, 10, 9, 30).toISOString());
    expect(localClock(ts)).toBe("09:30");
    expect(localIso(new Date(ts))).toBe("2026-11-10");
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
    const now = new Date(2026, 10, 9, 10).getTime();
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
