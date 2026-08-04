// Every InspirationCard used to mint its own signed Storage URL for both
// item.thumbnail_path and item.file_path, on mount, uncached — on a grid of
// N saved items that's up to 2N network round-trips fired the instant the
// Vault page renders. Supabase Storage's `createSignedUrls` (plural) signs a
// whole batch of paths in one request; LibraryPage now calls it once per
// page load with every visible item's paths, and hands each card its
// pre-signed URLs as props instead of letting the card sign its own.
//
// These two functions are the pure, testable pieces of that: picking which
// paths need signing, and turning the batch response back into a lookup map.

export interface SignedUrlEntry {
  path: string | null;
  signedUrl: string | null;
  error?: string | null;
}

/** Unique, non-null storage paths referenced by a set of vault items — the
 * input to a single batched `createSignedUrls` call. */
export function collectVaultStoragePaths(
  items: { thumbnail_path?: string | null; file_path?: string | null }[],
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.thumbnail_path) set.add(item.thumbnail_path);
    if (item.file_path) set.add(item.file_path);
  }
  return [...set];
}

/** path -> signedUrl lookup from a `createSignedUrls` batch response. Skips
 * any entry that errored or came back without a URL, so a single bad path
 * (e.g. a since-deleted storage object) can't take down the whole map. */
export function buildSignedUrlMap(
  results: SignedUrlEntry[] | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of results ?? []) {
    if (r?.path && r.signedUrl && !r.error) map[r.path] = r.signedUrl;
  }
  return map;
}
