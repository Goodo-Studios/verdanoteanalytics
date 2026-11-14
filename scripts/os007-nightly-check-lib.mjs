// Pure helpers for scripts/os007-nightly-check.mjs (kept separate so tests need no network).

export const STAGING_PROJECT_REF = "mnvcksbhbvypuiwozvct";

/** Build the one-line JSON summary from the clickup-os-sync response. */
export function summarize(res, at = new Date().toISOString()) {
  const body = res?.body ?? {};
  return {
    at,
    http: res?.status ?? null,
    runId: body.runId ?? null,
    success: body.success === true,
    discrepancies: body.discrepancies ?? null,
    seen: body.seen ?? null,
    failedSpaces: body.failedSpaces ?? null,
  };
}

/** 0 only when the run succeeded with zero discrepancies and no failed spaces. */
export function exitCodeFor(summary) {
  if (!summary || summary.success !== true) return 1;
  if (typeof summary.discrepancies !== "number" || summary.discrepancies > 0) return 1;
  if (Array.isArray(summary.failedSpaces) && summary.failedSpaces.length > 0) return 1;
  if (summary.failedSpaces && !Array.isArray(summary.failedSpaces)) return 1;
  return 0;
}
