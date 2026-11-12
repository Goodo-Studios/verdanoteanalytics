// Half-month invoice figures for time tracking (OS-011). A port of Goodo Time's
// src/services/invoices.js rules, as pure functions with no database:
//
// - An invoice covers one person's half-month in the studio time zone: the 1st to
//   the 15th, or the 16th to the last day (inclusive).
// - Its fee is half the person's monthly fee. The first half gets the fee divided
//   by two rounded down; any odd cent goes on the second half.
// - Its time lines are hours per project for the person's completed entries that
//   started inside the half-month and are on no other invoice. Running timers are
//   left out. Time lines carry no amount.
// - Fixed lines (expenses) are added to the total as typed.
// - Total = fee + fixed lines.

export const DEFAULT_TIME_ZONE = "America/New_York";

const NO_PROJECT = "(No project)";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface HalfMonth {
  from: string; // "YYYY-MM-DD"
  to: string; // "YYYY-MM-DD", inclusive
  first: boolean;
  label: string; // "16 to 31 Oct 2026"
  name: string; // "Second half of October 2026"
}

export interface InvoiceEntry {
  id: string | number;
  startAt: string; // UTC ISO
  endAt: string | null; // null while the timer runs
  projectId: string | number | null;
  projectName: string | null;
  clientName: string | null;
  invoiceId?: string | number | null; // invoice the entry is already on, if any
}

export interface InvoiceExtra {
  description: string;
  amountCents: number;
}

export interface InvoiceFigures {
  period: HalfMonth;
  fee: { description: string; amountCents: number } | null;
  timeLines: { description: string; seconds: number }[];
  extras: InvoiceExtra[];
  entryIds: (string | number)[];
  totalSeconds: number;
  totalCents: number;
}

// ---------------------------------------------------------------- dates and zones

function parseIsoDate(value: string): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(String(value ?? "").trim());
  if (!match) throw new Error(`"${value}" is not a date like 2026-10-31.`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new Error(`"${value}" is not a real date.`);
  return { y, m, d };
}

function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneParts(ms: number, zone: string) {
  let fmt = partsFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(zone, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { y: out.year, m: out.month, d: out.day, h: out.hour, min: out.minute, s: out.second };
}

/** Offset of `zone` from UTC at instant `ms`, in milliseconds. */
function zoneOffset(ms: number, zone: string): number {
  const p = zoneParts(ms, zone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant of local midnight at the start of `date` in `zone`. */
export function localMidnightUtc(date: string, zone: string): number {
  const { y, m, d } = parseIsoDate(date);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - zoneOffset(wall, zone);
  guess = wall - zoneOffset(guess, zone);
  return guess;
}

/** The local calendar date ("YYYY-MM-DD") of a UTC instant in `zone`. */
export function localDate(iso: string | number | Date, zone: string): string {
  const ms = typeof iso === "number" ? iso : new Date(iso).getTime();
  const p = zoneParts(ms, zone);
  return isoDate(p.y, p.m, p.d);
}

/** Inclusive local dates [from, to] as UTC bounds [startMs, endMs). */
export function periodUtcRange(from: string, to: string, zone: string): { startMs: number; endMs: number } {
  const t = parseIsoDate(to);
  const next = new Date(Date.UTC(t.y, t.m - 1, t.d + 1));
  return {
    startMs: localMidnightUtc(from, zone),
    endMs: localMidnightUtc(isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()), zone),
  };
}

// ---------------------------------------------------------------- half-months

function describeHalf(y: number, m: number, first: boolean): HalfMonth {
  const fromDay = first ? 1 : 16;
  const toDay = first ? 15 : daysInMonth(y, m);
  return {
    from: isoDate(y, m, fromDay),
    to: isoDate(y, m, toDay),
    first,
    label: `${fromDay} to ${toDay} ${MONTHS_SHORT[m - 1]} ${y}`,
    name: `${first ? "First" : "Second"} half of ${MONTHS_LONG[m - 1]} ${y}`,
  };
}

/** The half-month containing a local date "YYYY-MM-DD". */
export function halfContaining(date: string): HalfMonth {
  const { y, m, d } = parseIsoDate(date);
  return describeHalf(y, m, d <= 15);
}

/** Check that [from, to] is exactly one half-month and describe it. Throws otherwise. */
export function halfMonth(from: string, to: string): HalfMonth {
  const half = halfContaining(from);
  parseIsoDate(to);
  if (half.from !== from.trim() || half.to !== to.trim()) {
    throw new Error("Invoices cover the 1st to the 15th, or the 16th to the last day of the month.");
  }
  return half;
}

/**
 * Half-months to offer when starting an invoice, newest first: the current one and the
 * `count - 1` before it. `suggested` is the most recent one that has ended (or the
 * current one when it ends today).
 */
export function recentHalves(zone: string, now: Date = new Date(), count = 6) {
  const today = localDate(now, zone);
  const halves: HalfMonth[] = [];
  let cursor = halfContaining(today);
  for (let i = 0; i < count; i += 1) {
    halves.push(cursor);
    const { y, m, d } = parseIsoDate(cursor.from);
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    cursor = halfContaining(isoDate(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate()));
  }
  const suggested = halves[0].to === today ? halves[0] : halves[1];
  return { halves, suggested };
}

/** The fee for one half: the monthly fee split in two, any odd cent on the second half. */
export function halfFee(monthlyCents: number, first: boolean): number {
  const firstHalf = Math.floor(monthlyCents / 2);
  return first ? firstHalf : monthlyCents - firstHalf;
}

// ---------------------------------------------------------------- figures

function compareNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Work out an invoice's figures from the person's entries. Pass every entry of the person
 * that might fall in the period; this picks the ones Goodo Time would put on the invoice.
 * `invoiceId` is the invoice being built: entries already on it still count, entries on
 * any other invoice do not.
 */
export function invoiceFigures(input: {
  from: string;
  to: string;
  zone?: string;
  monthlyFeeCents: number | null;
  entries: InvoiceEntry[];
  extras?: InvoiceExtra[];
  invoiceId?: string | number | null;
}): InvoiceFigures {
  const zone = input.zone ?? DEFAULT_TIME_ZONE;
  const period = halfMonth(input.from, input.to);
  const { startMs, endMs } = periodUtcRange(period.from, period.to, zone);
  const invoiceId = input.invoiceId ?? null;

  const billed = input.entries.filter((e) => {
    if (e.endAt == null) return false;
    if (e.invoiceId != null && e.invoiceId !== invoiceId) return false;
    const start = Date.parse(e.startAt);
    return start >= startMs && start < endMs;
  });
  billed.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

  const groups = new Map<string, { projectId: string | number | null; projectName: string | null; clientName: string | null; ms: number }>();
  for (const e of billed) {
    const key = e.projectId == null ? "\u0000none" : String(e.projectId);
    const group = groups.get(key) ?? { projectId: e.projectId, projectName: e.projectName, clientName: e.clientName, ms: 0 };
    group.ms += Date.parse(e.endAt as string) - Date.parse(e.startAt);
    groups.set(key, group);
  }
  // Same order as Goodo Time: client name, then project name, missing names last.
  const ordered = [...groups.values()].sort(
    (a, b) =>
      compareNullsLast(a.clientName, b.clientName) ||
      compareNullsLast(a.projectName, b.projectName) ||
      compareNullsLast(a.projectId == null ? null : String(a.projectId), b.projectId == null ? null : String(b.projectId)),
  );
  const timeLines = ordered.map((g) => ({
    description: g.projectName ? (g.clientName ? `${g.clientName} / ${g.projectName}` : g.projectName) : NO_PROJECT,
    // Postgres sums the seconds and casts to integer, which rounds to the nearest second.
    seconds: Math.round(g.ms / 1000),
  }));

  const fee = input.monthlyFeeCents
    ? {
        description: `Monthly fee, ${period.first ? "first" : "second"} half (${period.label})`,
        amountCents: halfFee(input.monthlyFeeCents, period.first),
      }
    : null;
  const extras = input.extras ?? [];
  const totalCents = (fee?.amountCents ?? 0) + extras.reduce((sum, x) => sum + x.amountCents, 0);

  return {
    period,
    fee,
    timeLines,
    extras,
    entryIds: billed.map((e) => e.id),
    totalSeconds: timeLines.reduce((sum, l) => sum + l.seconds, 0),
    totalCents,
  };
}
