import { parseISO, format } from "date-fns";

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
