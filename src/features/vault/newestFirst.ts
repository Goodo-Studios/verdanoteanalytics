/**
 * Rows sorted by created_at, newest first. Rows without a date go last. Used for an item's
 * transcripts and frameworks so the page never shows an older row (audit plan item 4.3).
 */
export function newestFirst<T extends { created_at?: string | null }>(rows: T[] | null | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : -Infinity;
    const tb = b.created_at ? Date.parse(b.created_at) : -Infinity;
    return tb - ta;
  });
}
