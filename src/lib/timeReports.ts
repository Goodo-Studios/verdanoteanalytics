// Time reports (OS-013): pure helpers for the Reports page and the client hub's month hours.
//
// Rules copied from Goodo Time (repos goodo-time, src/services/reports.js and src/lib/time.js):
//   - Ranges are whole days in the studio time zone (America/New_York): this week and last week
//     run Monday to Sunday, this month and last month are calendar months, and a custom range is
//     two dates, both included, at most 366 days apart.
//   - An entry belongs to the range when it STARTED inside it.
//   - Only completed entries count. A running timer (no end) is left out.
//   - Groups are sorted by most time first, then by name.
//   - The CSV has one row per entry and guards cells that a spreadsheet would read as a formula.
//
// Rows copied from Goodo Time carry a Goodo Time project instead of a task and category. They are
// grouped like this:
//   client        the project's Goodo Time client. Client names are matched without regard to
//                 case, so "Glow Drip" from Goodo Time and the app's "Glow Drip" are one group.
//   task          "Goodo Time: <client> / <project>", one group per project.
//   content type  "(No content type)".
//   category      "Unsorted (Goodo Time)".

export const STUDIO_ZONE = "America/New_York";

export type RangePreset = "this-week" | "last-week" | "this-month" | "last-month" | "custom";
export const RANGE_PRESETS: Array<{ value: Exclude<RangePreset, "custom">; label: string }> = [
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
];

export type GroupBy = "client" | "person" | "task" | "contentType" | "category";
export const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "client", label: "Client" },
  { value: "person", label: "Person" },
  { value: "task", label: "Task" },
  { value: "contentType", label: "Content type" },
  { value: "category", label: "Category" },
];

export const NO_CLIENT = "(No client)";
export const INTERNAL_LABEL = "Internal";
export const NO_TASK = "(No task)";
export const NO_CONTENT_TYPE = "(No content type)";
export const NO_CATEGORY = "(No category)";
export const GOODO_TIME_CATEGORY = "Unsorted (Goodo Time)";
export const MAX_RANGE_DAYS = 366;

/** One entry as the report query returns it (time_entries with its joins). */
export interface ReportEntry {
  id: string;
  person_id: string;
  task_id: string | null;
  client_slug: string | null;
  is_internal: boolean;
  category: string | null;
  description: string | null;
  start_at: string;
  end_at: string | null;
  source_id: number | null;
  project_id: string | null;
  person: { name: string | null; email: string | null } | null;
  task: { title: string | null; content_type: string | null } | null;
  client: { name: string | null } | null;
  project: { name: string | null; client: { name: string | null } | null } | null;
}

// ------------------------------------------------------------------ dates in the studio zone

const pad = (n: number) => String(n).padStart(2, "0");
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Plain calendar date arithmetic on YYYY-MM-DD (no time zone involved). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const partsFormatter = new Map<string, Intl.DateTimeFormat>();
function zoneParts(ms: number, zone: string) {
  let f = partsFormatter.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year, m: p.month, d: p.day, hh: p.hour % 24, mi: p.minute, s: p.second };
}

/** Milliseconds the zone is ahead of UTC at instant `ms`. */
function zoneOffset(ms: number, zone: string): number {
  const p = zoneParts(ms, zone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant (ISO string) of local midnight on `iso` in `zone`. */
export function zonedMidnightUtc(iso: string, zone: string = STUDIO_ZONE): string {
  const [y, m, d] = iso.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - zoneOffset(guess, zone);
  // Correct once if the offset at the result differs (a DST change near midnight).
  t = guess - zoneOffset(t, zone);
  return new Date(t).toISOString();
}

/** The calendar date (YYYY-MM-DD) of an instant in `zone`. */
export function zonedDate(at: Date | string | number, zone: string = STUDIO_ZONE): string {
  const p = zoneParts(new Date(at).getTime(), zone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** HH:MM of an instant in `zone`. */
export function zonedClock(at: string, zone: string = STUDIO_ZONE): string {
  const p = zoneParts(new Date(at).getTime(), zone);
  return `${pad(p.hh)}:${pad(p.mi)}`;
}

export interface ReportRange {
  preset: RangePreset;
  /** First day, included. */
  from: string;
  /** Last day, included. */
  to: string;
  /** Query bounds: local midnight of `from`, up to (not including) local midnight after `to`. */
  fromIso: string;
  toIso: string;
}

function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -back);
}

function lastDayOfMonth(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** The inclusive dates of a named preset, as seen in the studio zone at `now`. */
export function presetDates(preset: Exclude<RangePreset, "custom">, now: Date = new Date(), zone: string = STUDIO_ZONE): { from: string; to: string } {
  const today = zonedDate(now, zone);
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "this-week": {
      const from = mondayOf(today);
      return { from, to: addDaysIso(from, 6) };
    }
    case "last-week": {
      const from = addDaysIso(mondayOf(today), -7);
      return { from, to: addDaysIso(from, 6) };
    }
    case "this-month":
      return { from: `${y}-${pad(m)}-01`, to: lastDayOfMonth(y, m) };
    case "last-month": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: `${ly}-${pad(lm)}-01`, to: lastDayOfMonth(ly, lm) };
    }
  }
}

/**
 * A preset, or a custom pair of dates, as a range. Returns an error message in plain words when a
 * custom range is not usable (missing date, end before start, longer than a year).
 */
export function resolveRange(
  preset: RangePreset,
  custom: { from?: string; to?: string } = {},
  now: Date = new Date(),
  zone: string = STUDIO_ZONE,
): { range: ReportRange; error: null } | { range: null; error: string } {
  let from: string;
  let to: string;
  if (preset === "custom") {
    from = custom.from ?? "";
    to = custom.to ?? "";
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return { range: null, error: "Choose a start date and an end date." };
    if (to < from) return { range: null, error: "The end date must be on or after the start date." };
    if (daysBetween(from, to) > MAX_RANGE_DAYS) return { range: null, error: "Reports cover at most one year at a time." };
  } else {
    ({ from, to } = presetDates(preset, now, zone));
  }
  return {
    range: { preset, from, to, fromIso: zonedMidnightUtc(from, zone), toIso: zonedMidnightUtc(addDaysIso(to, 1), zone) },
    error: null,
  };
}

/** "1 Nov to 30 Nov 2026". */
export function rangeLabel(r: { from: string; to: string }): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  return `${fmt(r.from)} to ${fmt(r.to)} ${r.to.slice(0, 4)}`;
}

// ------------------------------------------------------------------ counting

/** Seconds of a completed entry. A running entry counts as 0 (reports leave it out). */
export function entrySeconds(e: Pick<ReportEntry, "start_at" | "end_at">): number {
  if (!e.end_at) return 0;
  return Math.max(0, Math.floor((Date.parse(e.end_at) - Date.parse(e.start_at)) / 1000));
}

/** Completed entries that started inside [fromIso, toIso). */
export function inRange<T extends Pick<ReportEntry, "start_at" | "end_at">>(entries: T[], fromIso: string, toIso: string): T[] {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  return entries.filter((e) => {
    if (!e.end_at) return false;
    const s = Date.parse(e.start_at);
    return s >= a && s < b;
  });
}

/** Decimal hours with two places: 5400 seconds is "1.50". */
export function decimalHours(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(2);
}

/** h:mm, rounded to the nearest minute: 5430 seconds is "1:31". */
export function hmm(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/** Hours for display: "12.5 h", "20 h", "0 h". At most one decimal place. */
export function hoursText(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}

function clientLabel(e: ReportEntry): string {
  if (e.client_slug) return e.client?.name || e.client_slug;
  if (e.is_internal) return INTERNAL_LABEL;
  const gt = e.project?.client?.name;
  return gt || NO_CLIENT;
}

function goodoTimeProjectLabel(e: ReportEntry): string {
  const project = e.project?.name || "(No project)";
  const client = e.project?.client?.name;
  return `Goodo Time: ${client ? `${client} / ${project}` : project}`;
}

/** The group a single entry falls into, as a stable key and a label. */
export function groupOf(e: ReportEntry, by: GroupBy): { key: string; label: string } {
  switch (by) {
    case "client": {
      const label = clientLabel(e);
      return { key: label === INTERNAL_LABEL || label === NO_CLIENT ? label : `c:${label.toLowerCase()}`, label };
    }
    case "person":
      return { key: `p:${e.person_id}`, label: e.person?.name || e.person?.email || "(Unknown person)" };
    case "task":
      if (e.task_id) return { key: `t:${e.task_id}`, label: e.task?.title || "(Deleted task)" };
      if (e.source_id != null) return { key: `gt:${e.project_id ?? "none"}`, label: goodoTimeProjectLabel(e) };
      return { key: NO_TASK, label: NO_TASK };
    case "contentType": {
      const ct = e.task?.content_type?.trim();
      return ct ? { key: `ct:${ct.toLowerCase()}`, label: ct } : { key: NO_CONTENT_TYPE, label: NO_CONTENT_TYPE };
    }
    case "category":
      if (e.category) return { key: `cat:${e.category}`, label: e.category };
      if (e.source_id != null) return { key: GOODO_TIME_CATEGORY, label: GOODO_TIME_CATEGORY };
      return { key: NO_CATEGORY, label: NO_CATEGORY };
  }
}

export interface ReportGroup {
  key: string;
  label: string;
  seconds: number;
  entries: number;
  /** This group's part of the total, 0 to 1. */
  share: number;
}

export interface ReportSummary {
  groups: ReportGroup[];
  totalSeconds: number;
  entryCount: number;
}

/** Groups completed entries and totals them. Running entries are skipped. */
export function summarise(entries: ReportEntry[], by: GroupBy): ReportSummary {
  const map = new Map<string, ReportGroup>();
  let total = 0;
  let count = 0;
  for (const e of entries) {
    if (!e.end_at) continue;
    const seconds = entrySeconds(e);
    const { key, label } = groupOf(e, by);
    const g = map.get(key) ?? { key, label, seconds: 0, entries: 0, share: 0 };
    g.seconds += seconds;
    g.entries += 1;
    map.set(key, g);
    total += seconds;
    count += 1;
  }
  const groups = [...map.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
  for (const g of groups) g.share = total ? g.seconds / total : 0;
  return { groups, totalSeconds: total, entryCount: count };
}

export interface ReportFilters {
  /** A client group key from groupOf(e, "client"), or "" for every client. */
  client?: string;
  /** A person id, or "" for everyone. */
  person?: string;
}

export function applyFilters(entries: ReportEntry[], f: ReportFilters): ReportEntry[] {
  return entries.filter(
    (e) => (!f.client || groupOf(e, "client").key === f.client) && (!f.person || e.person_id === f.person),
  );
}

/** Distinct values for a filter picker, sorted by label. */
export function filterOptions(entries: ReportEntry[], by: "client" | "person"): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const e of entries) {
    const g = groupOf(e, by);
    if (!seen.has(g.key)) seen.set(g.key, g.label);
  }
  return [...seen].map(([value, label]) => ({ value: by === "person" ? value.slice(2) : value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ------------------------------------------------------------------ CSV

/** Excel reads a file that starts with this mark as UTF-8. */
export const CSV_BOM = String.fromCharCode(0xfeff);

export const CSV_HEADER = [
  "Date",
  "Start",
  "End",
  "Hours",
  "H:MM",
  "Person",
  "Email",
  "Client",
  "Task",
  "Content type",
  "Category",
  "Description",
] as const;

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting with = + - @, or a tab or
 * carriage return) gets a leading single quote. Cells holding a comma, quote or line break are
 * wrapped in quotes, with quotes doubled (RFC 4180).
 */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The detailed CSV: a header, then one row per completed entry, oldest first, with CRLF lines. */
export function reportCsv(entries: ReportEntry[], zone: string = STUDIO_ZONE): string {
  const rows = entries
    .filter((e) => !!e.end_at)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((e) => {
      const seconds = entrySeconds(e);
      return [
        zonedDate(e.start_at, zone),
        zonedClock(e.start_at, zone),
        zonedClock(e.end_at!, zone),
        decimalHours(seconds),
        hmm(seconds),
        e.person?.name ?? "",
        e.person?.email ?? "",
        groupOf(e, "client").label,
        groupOf(e, "task").label,
        groupOf(e, "contentType").label,
        groupOf(e, "category").label,
        e.description ?? "",
      ];
    });
  const lines = [[...CSV_HEADER], ...rows].map((r) => r.map(csvCell).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** File name for a download: time-report-2026-11-01-to-2026-11-30.csv. */
export function csvFileName(r: { from: string; to: string }): string {
  return `time-report-${r.from}-to-${r.to}.csv`;
}

// ------------------------------------------------------------------ month against scope

export interface ScopeStatus {
  hours: number;
  scopeHours: number | null;
  /** hours / scope, 0 or more; null with no scope set. */
  ratio: number | null;
  over: boolean;
  text: string;
}

export function scopeStatus(seconds: number, scopeHours: number | null): ScopeStatus {
  const hours = Math.max(0, seconds) / 3600;
  if (scopeHours == null || !(scopeHours > 0)) {
    return { hours, scopeHours: null, ratio: null, over: false, text: `${hoursText(hours)} this month, no scope hours set` };
  }
  const ratio = hours / scopeHours;
  return { hours, scopeHours, ratio, over: hours > scopeHours, text: `${hoursText(hours)} of ${hoursText(scopeHours)} this month` };
}
