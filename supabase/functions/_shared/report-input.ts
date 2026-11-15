// Input validation for the reports edge function: date ranges and account id lists.
// A bad date used to produce NaN days and a 500; these return a message for a 400 instead.

export const MAX_REPORT_RANGE_DAYS = 366;
export const MAX_REPORT_ACCOUNTS = 100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-31 and 2026-13-01). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function inclusiveDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

export type DateRangeResult =
  | { ok: true; dateStart: string; dateEnd: string; days: number }
  | { ok: false; error: string };

/**
 * Validate a report date range. Missing dates fall back to `defaults` when given, otherwise they are
 * an error. The range must be start <= end and span at most MAX_REPORT_RANGE_DAYS days.
 */
export function validateDateRange(
  start: unknown,
  end: unknown,
  defaults?: { start: string; end: string },
): DateRangeResult {
  const s = start == null || start === "" ? defaults?.start : start;
  const e = end == null || end === "" ? defaults?.end : end;
  if (s === undefined || e === undefined) return { ok: false, error: "date_start and date_end are required" };
  if (!isIsoDate(s)) return { ok: false, error: "date_start must be a valid YYYY-MM-DD date" };
  if (!isIsoDate(e)) return { ok: false, error: "date_end must be a valid YYYY-MM-DD date" };
  if (s > e) return { ok: false, error: "date_start must not be after date_end" };
  const days = inclusiveDays(s, e);
  if (days > MAX_REPORT_RANGE_DAYS) {
    return { ok: false, error: `date range must be at most ${MAX_REPORT_RANGE_DAYS} days` };
  }
  return { ok: true, dateStart: s, dateEnd: e, days };
}

export type AccountIdsResult = { ok: true; accountIds: string[] } | { ok: false; error: string };

/** Validate a list of ad account ids: non-empty array of safe strings, de-duplicated, capped. */
export function validateAccountIds(v: unknown, opts: { min?: number; max?: number } = {}): AccountIdsResult {
  const min = opts.min ?? 1;
  const max = opts.max ?? MAX_REPORT_ACCOUNTS;
  if (!Array.isArray(v)) return { ok: false, error: "account_ids must be an array" };
  for (const id of v) {
    if (typeof id !== "string" || !ACCOUNT_ID.test(id)) {
      return { ok: false, error: "account_ids must contain only valid account id strings" };
    }
  }
  const unique = [...new Set(v as string[])];
  if (unique.length < min) {
    return { ok: false, error: min === 1 ? "account_ids must not be empty" : `at least ${min} accounts are required` };
  }
  if (unique.length > max) return { ok: false, error: `at most ${max} accounts are allowed` };
  return { ok: true, accountIds: unique };
}
