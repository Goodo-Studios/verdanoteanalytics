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

// ── Cell drill-down params (naming convention, 2026-09-27) ──────────────────
// The `matrix` edge fn's cell view (?view=cell) parses its params here so the
// validation lives next to parseMatrixParams. A cell is one (Creative Type,
// Theme) pair of rpc_creative_matrix; the drill-down RPC
// (rpc_creative_matrix_theme_cell) splits it by exact hook text.

export interface MatrixCellParamsOk {
  ok: true;
  accountId: string;
  // The outer cell selector. null ⇒ the Other / untagged Creative Type row or
  // the untagged Theme column. The board always emits those buckets and the
  // drill-down always targets exactly one cell, so null is never "no filter".
  creativeType: string | null;
  theme: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

export type MatrixCellParamsResult = MatrixCellParamsOk | MatrixParamsError;

// Strict RFC-4122-shaped UUID (any version). Kept exported for callers that
// still validate uuid ids; the cell view no longer takes an angle_id.
const UUID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidUuid(value: string): boolean {
  return UUID_SHAPE.test(value);
}

// Theme and creative type are free text; cap them so a query string can't
// carry an unbounded value into the RPC.
const MAX_SELECTOR_LENGTH = 500;

function normalizeSelector(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validate the cell drill-down params for the `matrix` edge fn's cell view.
 *
 * - account_id / date_from / date_to follow parseMatrixParams.
 * - creative_type is optional; absent/blank ⇒ null (the Other / untagged
 *   row). Any other value is passed through trimmed; the RPC maps it onto the
 *   4 Creative Types the same way it buckets creatives.style.
 * - theme is optional; absent/blank ⇒ null (the untagged Theme column). Any
 *   other value is free text, trimmed, matched exactly by the RPC.
 * - Either selector longer than 500 characters is a 400.
 */
export function parseMatrixCellParams(
  accountId: string | null,
  creativeType: string | null,
  theme: string | null,
  dateFrom: string | null,
  dateTo: string | null,
): MatrixCellParamsResult {
  const base = parseMatrixParams(accountId, dateFrom, dateTo);
  if (!base.ok) return base;

  const normalizedType = normalizeSelector(creativeType);
  const normalizedTheme = normalizeSelector(theme);
  if (normalizedType !== null && normalizedType.length > MAX_SELECTOR_LENGTH) {
    return { ok: false, error: "creative_type is too long" };
  }
  if (normalizedTheme !== null && normalizedTheme.length > MAX_SELECTOR_LENGTH) {
    return { ok: false, error: "theme is too long" };
  }

  return {
    ok: true,
    accountId: base.accountId,
    creativeType: normalizedType,
    theme: normalizedTheme,
    dateFrom: base.dateFrom,
    dateTo: base.dateTo,
  };
}
