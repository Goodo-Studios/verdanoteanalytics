// Audit 8.7: shared "checked" marker for the Meta backfills (backfill-post-urls,
// backfill-launch-dates). An ad Meta returns nothing for is stamped with the time it was
// checked, and the candidate select skips it for RECHECK_AFTER_MS, so the same
// unresolvable rows are not fetched on every run.

export const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** PostgREST .or() filter: never checked, or checked before the recheck window. */
export function notRecentlyChecked(column: string, now: number = Date.now()): string {
  const cutoff = new Date(now - RECHECK_AFTER_MS).toISOString();
  return `${column}.is.null,${column}.lt.${cutoff}`;
}

/** The ids of a batch that Meta answered but that produced no update. */
export function unresolvedIds(batchIds: string[], resolvedIds: Iterable<string>): string[] {
  const done = new Set(resolvedIds);
  return batchIds.filter((id) => !done.has(id));
}
