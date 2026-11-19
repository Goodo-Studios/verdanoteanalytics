/**
 * An embedded child table as a list, whatever shape PostgREST sent it in.
 *
 * inspiration_transcripts and inspiration_frameworks have unique(item_id) since audit 4.3, so
 * PostgREST treats each as a one-to-one relation and returns the embed as a single object (or
 * null), not an array. Code written for arrays then threw on spread (the item page showed
 * "Item not found") or read `[0]` of an object and got nothing (cards lost their hooks, the Hooks
 * page emptied, the Framework and Script tabs went blank). Every read of these embeds goes
 * through here so both shapes work.
 */
export function embedRows<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The first row of an embedded child table, or null when there is none. */
export function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  return embedRows(value)[0] ?? null;
}

/**
 * A row with its transcript and framework embeds turned into arrays, so the rest of the page can
 * keep reading `row.inspiration_transcripts?.[0]`. Embeds the row does not carry stay absent.
 */
export function normalizeItemEmbeds<R extends object>(row: R): R {
  const out = { ...row } as Record<string, unknown>;
  for (const key of ["inspiration_transcripts", "inspiration_frameworks"]) {
    if (key in out) out[key] = embedRows(out[key] as unknown[] | unknown | null);
  }
  return out as R;
}
