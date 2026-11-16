import { parseISO, format, subDays, subMonths, startOfMonth, startOfWeek, differenceInCalendarDays, isAfter } from "date-fns";

/**
 * Parse a "yyyy-MM-dd" picker string as a LOCAL calendar date (local midnight),
 * NOT UTC.
 *
 * `new Date("2026-06-16")` parses the date-only form as UTC midnight, which in
 * any negative-offset timezone (all of the US) renders as the *previous* day —
 * so a picked "Jun 16" showed up as "Jun 15" in the chip and the calendar
 * highlight, even though the value sent to the API was correct. date-fns
 * `parseISO` treats a date-only string as local time, so the displayed day
 * always matches the picked day regardless of the viewer's timezone.
 */
export function parsePickerDate(s: string): Date {
  return parseISO(s);
}

/** Format a "yyyy-MM-dd" picker string for display without timezone drift. */
export function formatPickerDate(s: string, fmt: string): string {
  return format(parseISO(s), fmt);
}

/**
 * Today's calendar date in UTC, as a local-midnight Date so date-fns can do calendar math on it.
 *
 * The server builds its reporting windows in UTC, so "today" and "yesterday" here are the UTC
 * calendar days, not the browser's. Near midnight the two can differ by a day.
 */
export function utcToday(now: Date = new Date()): Date {
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * "yyyy-MM-dd" for the UTC calendar day `days - 1` days before today, so `utcDaysAgoIso(1)` is
 * today and `utcDaysAgoIso(30)` starts a 30-day window ending today. Calendar math on
 * utcToday() cannot slip a day across a daylight-saving change (audit 6.4).
 */
export function utcDaysAgoIso(days: number, now: Date = new Date()): string {
  return format(subDays(utcToday(now), days - 1), "yyyy-MM-dd");
}

/** A report's date range in the viewer's locale, each day read as a local calendar date (audit 6.4). */
export function formatReportRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  return `${parsePickerDate(start).toLocaleDateString()} – ${parsePickerDate(end).toLocaleDateString()}`;
}

export interface RollingPreset {
  id: string;
  label: string;
  from: (today: Date) => Date;
  to: (today: Date) => Date;
}

/**
 * Clamp a preset's end so it never falls before its start. On the first day of a period
 * ("This Week" on a Monday, "This Month" on the 1st) the natural end is yesterday, which is
 * before the period start; fall back to a single day (the start itself).
 */
function clampEnd(from: Date, to: Date): Date {
  return isAfter(from, to) ? from : to;
}

/**
 * The window immediately before [dateFrom, dateTo] with the same number of calendar days,
 * as local yyyy-MM-dd strings. Pure local-date math, so it does not shift in UTC+ zones.
 */
export function priorPeriodRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const from = parsePickerDate(dateFrom);
  const to = parsePickerDate(dateTo);
  const days = Math.max(1, differenceInCalendarDays(to, from) + 1);
  const prevTo = subDays(from, 1);
  const prevFrom = subDays(prevTo, days - 1);
  return { dateFrom: format(prevFrom, "yyyy-MM-dd"), dateTo: format(prevTo, "yyyy-MM-dd") };
}

/** Presets that move with the calendar. The id is what gets saved, not the dates. */
export const ROLLING_PRESETS: RollingPreset[] = [
  { id: "today", label: "Today", from: (t) => t, to: (t) => t },
  { id: "yesterday", label: "Yesterday", from: (t) => subDays(t, 1), to: (t) => subDays(t, 1) },
  { id: "last7", label: "Last 7 days", from: (t) => subDays(t, 7), to: (t) => subDays(t, 1) },
  { id: "last14", label: "Last 14 days", from: (t) => subDays(t, 14), to: (t) => subDays(t, 1) },
  { id: "last30", label: "Last 30 days", from: (t) => subDays(t, 30), to: (t) => subDays(t, 1) },
  { id: "thisWeek", label: "This Week", from: (t) => startOfWeek(t, { weekStartsOn: 1 }), to: (t) => clampEnd(startOfWeek(t, { weekStartsOn: 1 }), subDays(t, 1)) },
  { id: "thisMonth", label: "This Month", from: (t) => startOfMonth(t), to: (t) => clampEnd(startOfMonth(t), subDays(t, 1)) },
  { id: "lastMonth", label: "Last Month", from: (t) => startOfMonth(subMonths(t, 1)), to: (t) => subDays(startOfMonth(t), 1) },
];

/** App-wide default: last 14 days through yesterday. */
export const DEFAULT_PRESET_ID = "last14";

export function isRollingPresetId(id: unknown): id is string {
  return typeof id === "string" && ROLLING_PRESETS.some((p) => p.id === id);
}

/** The window a rolling preset covers today, as yyyy-MM-dd strings. Null for an unknown id. */
export function rollingPresetRange(id: string, now: Date = new Date()): { dateFrom: string; dateTo: string } | null {
  const preset = ROLLING_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  const today = utcToday(now);
  return { dateFrom: format(preset.from(today), "yyyy-MM-dd"), dateTo: format(preset.to(today), "yyyy-MM-dd") };
}
