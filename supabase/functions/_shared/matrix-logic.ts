// US-006: Pure request-param logic for the creative-matrix read path.
//
// Both read surfaces of rpc_creative_matrix — the session-authed `matrix` edge
// function (in-app UI) and the API-key-authed `GET /api/matrix` route — parse
// their query params through parseMatrixParams so validation is byte-identical
// across surfaces. No I/O in this module (mirrors account-taxonomy-logic.ts):
// it is unit-testable with plain `deno test`, no network or DB.
//
// The RPC treats NULL dates as all-time and filters creative_daily_metrics.date
// inclusively; this module only decides whether the strings are well-formed
// real calendar dates and orders correctly. All aggregation/ranking stays in
// the SQL RPC.

export interface MatrixParamsOk {
  ok: true;
  accountId: string;
  // Normalized to null when the param was absent — passed straight through as
  // p_date_from / p_date_to (NULL = unbounded on that side).
  dateFrom: string | null;
  dateTo: string | null;
}

export interface MatrixParamsError {
  ok: false;
  error: string;
}

export type MatrixParamsResult = MatrixParamsOk | MatrixParamsError;

// Strict YYYY-MM-DD — no timezones, no partial dates, no whitespace.
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is a strict YYYY-MM-DD string AND a real calendar date
 * (rejects 2026-02-30, month 13, day 00, etc.).
 */
export function isValidCalendarDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  // Day 0 of month m+1 = last day of month m (UTC to avoid TZ drift).
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

/**
 * Validate the matrix read params shared by the `matrix` edge fn and the
 * `GET /api/matrix` route.
 *
 * - account_id is required (non-empty).
 * - date_from / date_to are optional; when present each must be a strict
 *   YYYY-MM-DD real calendar date. Absent/empty params normalize to null.
 * - When both dates are present, date_from must not exceed date_to
 *   (lexicographic compare is correct for ISO dates).
 */
export function parseMatrixParams(
  accountId: string | null,
  dateFrom: string | null,
  dateTo: string | null,
): MatrixParamsResult {
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    return { ok: false, error: "account_id is required" };
  }

  const normalize = (
    raw: string | null,
    label: string,
  ): { value: string | null } | { error: string } => {
    if (raw === null || raw === undefined || raw === "") return { value: null };
    if (typeof raw !== "string" || !isValidCalendarDate(raw)) {
      return { error: `${label} must be a valid YYYY-MM-DD date` };
    }
    return { value: raw };
  };

  const from = normalize(dateFrom, "date_from");
  if ("error" in from) return { ok: false, error: from.error };
  const to = normalize(dateTo, "date_to");
  if ("error" in to) return { ok: false, error: to.error };

  if (from.value !== null && to.value !== null && from.value > to.value) {
    return { ok: false, error: "date_from must not be after date_to" };
  }

  return { ok: true, accountId: accountId.trim(), dateFrom: from.value, dateTo: to.value };
}
