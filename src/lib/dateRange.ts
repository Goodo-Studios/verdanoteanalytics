import { parseISO, format, subDays, subMonths, startOfMonth, startOfWeek } from "date-fns";

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

export interface RollingPreset {
  id: string;
  label: string;
  from: (today: Date) => Date;
  to: (today: Date) => Date;
}

/** Presets that move with the calendar. The id is what gets saved, not the dates. */
export const ROLLING_PRESETS: RollingPreset[] = [
  { id: "today", label: "Today", from: (t) => t, to: (t) => t },
  { id: "yesterday", label: "Yesterday", from: (t) => subDays(t, 1), to: (t) => subDays(t, 1) },
  { id: "last7", label: "Last 7 days", from: (t) => subDays(t, 7), to: (t) => subDays(t, 1) },
  { id: "last14", label: "Last 14 days", from: (t) => subDays(t, 14), to: (t) => subDays(t, 1) },
  { id: "last30", label: "Last 30 days", from: (t) => subDays(t, 30), to: (t) => subDays(t, 1) },
  { id: "thisWeek", label: "This Week", from: (t) => startOfWeek(t, { weekStartsOn: 1 }), to: (t) => subDays(t, 1) },
  { id: "thisMonth", label: "This Month", from: (t) => startOfMonth(t), to: (t) => subDays(t, 1) },
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
