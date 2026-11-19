// CSV import of existing time entries (Time log). Pure parsing and checking: the page shows the
// preview and writes each valid row through the same save hook as a manual entry.
//
// Columns (header names are not case sensitive; extra export columns are ignored):
//   Date (YYYY-MM-DD or M/D/YYYY), Start (HH:MM or 9:30 AM), End (same) or Hours (1.5 or 1:30),
//   Client (an active client by name or slug, or Internal), Category, Description (optional).
// A file made by the Time report export imports as it is: Person, Email, Task, Content type and
// H:MM are ignored, and every row is added to the signed-in person's own time.
// Every row is checked and reported with its line number. Nothing is guessed.
import { parseCsv, type CsvRowError } from "@/lib/csv";
import { TIME_CATEGORIES, toTimestamp } from "@/lib/timeLog";
import { addDaysIso } from "@/lib/timeReports";

export const MAX_TIME_IMPORT_ROWS = 200;
export const INTERNAL_CLIENT = "__internal__";

export interface TimeImportClient {
  slug: string;
  name: string | null;
}

export interface TimeImportRow {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  date: string;
  start: string;
  end: string;
  endDate: string;
  /** Client slug, or null for Internal. */
  clientSlug: string | null;
  clientLabel: string;
  category: string;
  description: string;
  seconds: number;
  startAt: string;
  endAt: string;
}

export interface TimeImportResult {
  rows: TimeImportRow[];
  errors: CsvRowError[];
  fatal: string | null;
  totalSeconds: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const IGNORED = new Set(["hmm", "person", "email", "task", "contenttype"]);
const KNOWN = new Set(["date", "start", "end", "hours", "client", "category", "description"]);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD from YYYY-MM-DD or M/D/YYYY; null when it is not a real calendar date. */
function parseDate(s: string): string | null {
  let y: number, m: number, d: number;
  const a = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const b = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (a) [y, m, d] = [+a[1], +a[2], +a[3]];
  else if (b) [y, m, d] = [+b[3], +b[1], +b[2]];
  else return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** HH:MM (24 hour) from 9:30, 09:30, 9:30 AM or 2:05 pm; null when it is not a clock time. */
function parseClock(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i.exec(s.trim());
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const ap = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "am" && h === 12) h = 0;
    else if (ap === "pm" && h !== 12) h += 12;
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Seconds from 1.5 or 1:30; null when it is not a positive amount. */
function parseHours(s: string): number | null {
  const t = s.trim();
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (hm) return (+hm[1] * 60 + +hm[2]) * 60;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 3600);
  return null;
}

export function parseTimeCsv(text: string, clients: TimeImportClient[]): TimeImportResult {
  const empty: TimeImportResult = { rows: [], errors: [], fatal: null, totalSeconds: 0 };
  const table = parseCsv(text);
  if (table.length < 2) return { ...empty, fatal: "The file needs a header row and at least one entry." };
  if (table.length - 1 > MAX_TIME_IMPORT_ROWS) {
    return { ...empty, fatal: `That file has ${table.length - 1} rows. Import at most ${MAX_TIME_IMPORT_ROWS} at a time.` };
  }

  const headers = table[0].map(norm);
  const unknown = table[0].filter((_, i) => !KNOWN.has(headers[i]) && !IGNORED.has(headers[i]));
  if (unknown.length) return { ...empty, fatal: `Unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.` };
  const dupes = headers.filter((h, i) => headers.indexOf(h) !== i);
  if (dupes.length) return { ...empty, fatal: `The column ${dupes[0]} appears more than once.` };
  const missing = ["date", "start", "client", "category"].filter((c) => !headers.includes(c));
  if (missing.length) return { ...empty, fatal: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` };
  if (!headers.includes("end") && !headers.includes("hours")) return { ...empty, fatal: "Add an End column or an Hours column." };

  const cell = (row: string[], name: string) => (row[headers.indexOf(name)] ?? "").trim();
  const byName = new Map<string, TimeImportClient>();
  for (const c of clients) {
    byName.set(norm(c.slug), c);
    if (c.name) byName.set(norm(c.name), c);
  }
  const rows: TimeImportRow[] = [];
  const errors: CsvRowError[] = [];

  table.slice(1).forEach((values, i) => {
    const line = i + 2;
    const fail = (message: string) => void errors.push({ line, message });
    if (values.length !== headers.length) return fail(`Expected ${headers.length} values, found ${values.length}`);

    const date = parseDate(cell(values, "date"));
    if (!date) return fail(`"${cell(values, "date")}" is not a date (use YYYY-MM-DD or M/D/YYYY)`);
    const start = parseClock(cell(values, "start"));
    if (!start) return fail(`"${cell(values, "start")}" is not a start time (use HH:MM)`);

    // End from the End column when filled in, else start plus Hours.
    let end: string | null = null;
    let endDate = date;
    const endText = headers.includes("end") ? cell(values, "end") : "";
    const hoursText = headers.includes("hours") ? cell(values, "hours") : "";
    if (endText) {
      end = parseClock(endText);
      if (!end) return fail(`"${endText}" is not an end time (use HH:MM)`);
    } else if (hoursText) {
      const secs = parseHours(hoursText);
      if (secs == null || secs <= 0) return fail(`Hours "${hoursText}" is not an amount like 1.5 or 1:30`);
      if (secs > 24 * 3600) return fail("An entry cannot be longer than 24 hours");
      // Walk from the start clock in the studio zone, so a late start rolls over to the next day.
      const total = +start.slice(0, 2) * 60 + +start.slice(3) + Math.round(secs / 60);
      endDate = addDaysIso(date, Math.floor(total / 1440));
      end = `${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}`;
    } else {
      return fail("Give an End time or Hours");
    }

    const startAt = toTimestamp(date, start);
    const endAt = toTimestamp(endDate, end);
    const seconds = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 1000);
    if (!(seconds > 0)) return fail("The end must be after the start");
    if (seconds > 24 * 3600) return fail("An entry cannot be longer than 24 hours");

    const clientText = cell(values, "client");
    let clientSlug: string | null;
    let clientLabel: string;
    if (!clientText) return fail("Client is empty (use an active client or Internal)");
    if (norm(clientText) === "internal") {
      clientSlug = null;
      clientLabel = "Internal";
    } else {
      const found = byName.get(norm(clientText));
      if (!found) return fail(`"${clientText}" is not an active client (use its name or Internal)`);
      clientSlug = found.slug;
      clientLabel = found.name || found.slug;
    }

    const category = TIME_CATEGORIES.find((c) => c.toLowerCase() === cell(values, "category").toLowerCase());
    if (!category) return fail(`"${cell(values, "category")}" is not a category (${TIME_CATEGORIES.join(", ")})`);

    const description = headers.includes("description") ? cell(values, "description") : "";
    if (description.length > 500) return fail("Description is longer than 500 characters");

    rows.push({ line, date, start, end, endDate, clientSlug, clientLabel, category, description, seconds, startAt, endAt });
  });

  // Rows in the file may not overlap each other (the database refuses overlaps with saved time).
  const sorted = [...rows].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const clash = new Set<number>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (sorted[i].startAt < prev.endAt) {
      clash.add(sorted[i].line);
      errors.push({ line: sorted[i].line, message: `Overlaps the entry on line ${prev.line}` });
    }
  }
  errors.sort((a, b) => a.line - b.line);
  const kept = rows.filter((r) => !clash.has(r.line));

  if (errors.length === 0 && kept.length === 0) return { ...empty, fatal: "No entries found." };
  return { rows: kept, errors, fatal: null, totalSeconds: kept.reduce((n, r) => n + r.seconds, 0) };
}
