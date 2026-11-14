// ClickUp dates, read in the studio's time zone.
//
// ClickUp sends every date as a millisecond timestamp (due_date, start_date, date custom fields).
// Goodo OS keeps a calendar date (YYYY-MM-DD). The date a timestamp means depends on the zone, and
// the zone the studio works in is America/New_York (the same zone as src/lib/timeReports.ts).
//
// What is known and what is not:
//   - A due date with a time ("due_date_time": true when it is written) is an instant. The studio
//     means the Eastern calendar day of that instant. Slicing the UTC date was wrong from 8 pm
//     Eastern (EDT) or 7 pm (EST) onward: 9 pm Eastern on the 20th is the 21st in UTC.
//   - A date-only due date is stored by ClickUp as a timestamp at the start of the day of whoever
//     set it, in that person's zone. The read payload does not say which zone, and it carries no
//     due_date_time flag we could use. For an Eastern setter the start of the day is 4 or 5 am UTC,
//     which is the same day in Eastern, so it reads right. For a setter east of UTC (the start of
//     their day is the evening of the day before in Eastern) it still reads a day early. That is not
//     fixed here: guessing a setter's zone would move correct dates. Date-only values written by
//     this app avoid it (see dateToMs in os-clickup-writeback.ts: noon UTC, the same day in every
//     zone from UTC-11 to UTC+11, and 7 or 8 am Eastern).
//   - A date-only value another tool wrote at exactly 00:00 UTC reads as the evening before in
//     Eastern. That is the cost of reading the 8 pm Eastern (EDT) timed due date correctly.

export const STUDIO_ZONE = "America/New_York";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: STUDIO_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The studio-zone calendar date (YYYY-MM-DD) of an instant, or null for a missing or bad value. */
export function clickupMsToDate(ms: unknown): string | null {
  if (ms === null || ms === undefined || ms === "") return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(new Date(n))) if (p.type !== "literal") parts[p.type] = p.value;
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}
