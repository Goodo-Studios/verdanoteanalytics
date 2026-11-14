// Pure helpers for the timer and the weekly log (OS-012): week ranges (Monday to Sunday, studio
// time zone, as in Reports), durations, h:mm:ss and hours formatting, grouping entries by day,
// turning a date and a clock time into a timestamp, and plain words for database errors.
import { addDaysIso, zonedClock, zonedDate, zonedInstantUtc, zonedMidnightUtc } from "@/lib/timeReports";

/** The fixed categories. Must match the check time_entries_category_known in the migration. */
export const TIME_CATEGORIES = ["Editing", "Strategy", "Production", "Admin", "Meetings", "Other"] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];

export interface TimeEntryRow {
  id: string;
  person_id: string;
  task_id: string | null;
  client_slug: string | null;
  is_internal: boolean;
  category: string | null;
  description: string;
  start_at: string;
  end_at: string | null;
  source_id?: number | null;
  task?: { title: string | null } | null;
  client?: { name: string | null } | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

// Every date and clock time here is in the studio time zone (America/New_York), the same zone
// Reports and the CSV use, so a person outside Eastern time sees the same day, week and totals on
// /time as in Reports. The browser's own zone is never used for these.

/** Today's date (YYYY-MM-DD) in the studio zone. */
export function studioToday(now: Date = new Date()): string {
  return zonedDate(now);
}

/** The studio-zone calendar date (YYYY-MM-DD) of an instant. */
export function studioDate(at: Date | string | number): string {
  return zonedDate(at);
}

/** HH:MM of an instant in the studio zone. */
export function studioClock(isoTs: string): string {
  return zonedClock(isoTs);
}

/** The Monday (YYYY-MM-DD) of the week that holds `iso`. */
export function weekStartIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return addDaysIso(iso, -back);
}

/** Moves a calendar date by whole days. */
export function addDays(iso: string, days: number): string {
  return addDaysIso(iso, days);
}

export interface WeekRange {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** The seven days Monday to Sunday. */
  days: string[];
  /** Timestamps for the query: Monday 00:00 studio time up to (not including) next Monday 00:00. */
  fromIso: string;
  toIso: string;
}

export function weekRange(anyDayIso: string): WeekRange {
  const start = weekStartIso(anyDayIso);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return {
    start,
    days,
    fromIso: zonedMidnightUtc(start),
    toIso: zonedMidnightUtc(addDays(start, 7)),
  };
}

/** A calendar date as a UTC-midnight Date, for labels only (formatted with timeZone UTC). */
function calendarDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "10 Nov to 16 Nov 2026" for a week starting on `start`. */
export function weekLabel(start: string): string {
  const a = calendarDate(start);
  const b = calendarDate(addDays(start, 6));
  const dm = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${dm(a)} to ${dm(b)} ${b.getUTCFullYear()}`;
}

/** "Mon 10 Nov". */
export function dayLabel(iso: string): string {
  return calendarDate(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Seconds from start to end, or to `nowMs` for a running entry. Never negative. */
export function durationSeconds(startAt: string, endAt: string | null, nowMs: number = Date.now()): number {
  const end = endAt ? Date.parse(endAt) : nowMs;
  return Math.max(0, Math.floor((end - Date.parse(startAt)) / 1000));
}

/**
 * How far the database clock is ahead of this browser's clock (ms, negative when behind), from one
 * request: the server time is taken to be the reading at the midpoint of the round trip. Returns 0
 * when the server time is missing or not a date, so the timer falls back to the browser clock.
 */
export function clockOffsetMs(serverIso: string | null | undefined, sentMs: number, receivedMs: number): number {
  const server = serverIso ? Date.parse(serverIso) : Number.NaN;
  if (!Number.isFinite(server)) return 0;
  return Math.round(server - (sentMs + receivedMs) / 2);
}

/** h:mm:ss, for the ticking pill. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "2h 05m", "45m", "0m", for totals. */
export function formatHours(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${pad(m % 60)}m` : `${m}m`;
}

/** A date (YYYY-MM-DD) and a clock time (HH:MM) in the studio zone, as an ISO timestamp. */
export function toTimestamp(date: string, clock: string): string {
  return zonedInstantUtc(date, clock);
}

/** What an entry was for: the task title, else the client or Internal with the category. */
export function entryLabel(e: Pick<TimeEntryRow, "task_id" | "task" | "client" | "client_slug" | "is_internal" | "category">): string {
  if (e.task_id && e.task?.title) return e.task.title;
  const who = e.is_internal ? "Internal" : e.client?.name || e.client_slug || "";
  const parts = [who, e.category].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No task";
}

export interface DayGroup {
  date: string;
  entries: TimeEntryRow[];
  seconds: number;
}

/** Entries by the studio-zone day they start on, for each day of the week, with totals. */
export function groupByDay(entries: TimeEntryRow[], days: string[], nowMs: number = Date.now()): { days: DayGroup[]; seconds: number } {
  const groups: DayGroup[] = days.map((date) => ({ date, entries: [], seconds: 0 }));
  const byDate = new Map(groups.map((g) => [g.date, g]));
  for (const e of [...entries].sort((a, b) => a.start_at.localeCompare(b.start_at))) {
    const g = byDate.get(studioDate(e.start_at));
    if (!g) continue;
    g.entries.push(e);
    g.seconds += durationSeconds(e.start_at, e.end_at, nowMs);
  }
  return { days: groups, seconds: groups.reduce((n, g) => n + g.seconds, 0) };
}

/** Plain words for an error from the database. Unknown messages pass through. */
export function friendlyTimeError(message: string): string {
  const m = message || "";
  if (/time_entries_no_overlap|exclusion constraint|conflicting key value/i.test(m)) {
    return "This time overlaps another of your entries. Change the start or end so they do not overlap.";
  }
  if (/time_entries_one_running/i.test(m)) return "A timer is already running. Stop it first.";
  if (/time_entries_end_after_start/i.test(m)) return "The end must be after the start.";
  if (/time_entries_needs_purpose/i.test(m)) return "Choose a task, or a client or Internal with a category.";
  if (/time_entries_category_known/i.test(m)) return "Choose one of the listed categories.";
  if (/time_entries_client_or_internal/i.test(m)) return "Choose a client or Internal, not both.";
  if (/row-level security/i.test(m)) return "You can only change your own time.";
  return m || "Something went wrong. Try again.";
}

/** Checks a manual entry before it is sent. Returns a message, or null when it is fine. */
export function validateEntryForm(f: {
  date: string;
  start: string;
  end: string;
  /** The date the entry ends on. Blank means the start date. */
  endDate?: string;
  taskId: string;
  client: string;
  category: string;
}): string | null {
  if (!f.date || !f.start || !f.end) return "Fill in the date, start and end.";
  const start = Date.parse(toTimestamp(f.date, f.start));
  const end = Date.parse(toTimestamp(f.endDate || f.date, f.end));
  if (!(end > start)) return "The end must be after the start.";
  if (!f.taskId) {
    if (!f.client) return "Choose a task, or a client or Internal.";
    if (!f.category) return "Choose a category for time with no task.";
  }
  return null;
}
