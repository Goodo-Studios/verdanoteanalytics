type Dated = { created_at?: string | null };

/**
 * An item's transcripts and frameworks as a list, whatever shape the API sent.
 *
 * The database keeps one transcript and one framework per item (a unique key on item_id), so
 * PostgREST returns each embedded relation as a single object, not a list. Older data and other
 * queries may still produce lists, and an item with none produces null. Every reader needs a list.
 */
export function embeddedRows<T>(rows: T[] | T | null | undefined): T[] {
  if (rows == null) return [];
  return Array.isArray(rows) ? rows : [rows];
}

/**
 * Rows sorted by created_at, newest first. Rows without a date go last. Used for an item's
 * transcripts and frameworks so the page never shows an older row (audit plan item 4.3).
 * Accepts a list, a single object or null (see embeddedRows).
 */
export function newestFirst<T extends Dated>(rows: T[] | T | null | undefined): T[] {
  return [...embeddedRows(rows)].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : -Infinity;
    const tb = b.created_at ? Date.parse(b.created_at) : -Infinity;
    return tb - ta;
  });
}

/** The newest embedded row, or null when there is none. */
export function firstEmbedded<T extends Dated>(rows: T[] | T | null | undefined): T | null {
  return newestFirst(rows)[0] ?? null;
}
