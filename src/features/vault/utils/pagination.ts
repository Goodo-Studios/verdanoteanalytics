// The Vault library used to fetch and render every one of a user's saved items
// in one shot. This is the paging side of the fix.
//
// The wrinkle: the video/static filter isn't a DB column — it's derived from
// file_path's extension (see isImageFilePath), so it can only be applied after
// rows come back. A naive `range()` page would therefore hand back "48 rows, 3
// of which match", and the grid would look broken while "Load more" still had
// plenty left. `fillVaultPage` keeps pulling ranges until it has a full page of
// *matching* items (or the table runs out), so a page is always a page.

export interface VaultPage<T> {
  items: T[];
  /** Row offset the next page starts at, or null once the table is exhausted. */
  nextOffset: number | null;
}

export interface FillVaultPageOptions<T> {
  /** Inclusive row range fetch — i.e. supabase's `.range(from, to)`. */
  fetchRange: (from: number, to: number) => Promise<T[]>;
  /** Post-fetch predicate (the video/static filter). */
  matches: (row: T) => boolean;
  startOffset: number;
  pageSize: number;
  /**
   * Ceiling on rows scanned for a single page, so a filter that matches almost
   * nothing costs a bounded number of round-trips instead of walking the whole
   * table. Hitting it still returns a usable (short) page with a nextOffset, so
   * "Load more" simply picks up where the scan stopped.
   */
  maxScan?: number;
}

export async function fillVaultPage<T>({
  fetchRange,
  matches,
  startOffset,
  pageSize,
  maxScan = pageSize * 5,
}: FillVaultPageOptions<T>): Promise<VaultPage<T>> {
  const items: T[] = [];
  let offset = startOffset;
  let scanned = 0;
  let exhausted = false;

  while (items.length < pageSize && scanned < maxScan) {
    const rows = await fetchRange(offset, offset + pageSize - 1);
    scanned += rows.length;
    offset += rows.length;
    for (const row of rows) {
      if (matches(row)) items.push(row);
    }
    // A short read means there is nothing after it.
    if (rows.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  return { items, nextOffset: exhausted ? null : offset };
}
