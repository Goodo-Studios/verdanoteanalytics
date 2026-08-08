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

// Incident follow-up: shipping the batch above with NO fallback meant that
// if the single `createSignedUrls` call failed for any reason (network
// hiccup, an unexpected per-request error, anything), the whole grid lost
// every thumbnail at once — worse than the old per-card behavior, where one
// bad card never affected its neighbors. `resolveProvidedSignedUrl` is the
// three-state contract LibraryPage now feeds to InspirationCard so a batch
// failure degrades to the old self-signing behavior instead of going blank:
//
//   • `undefined` — the batch call hasn't settled yet; the card should WAIT,
//     not self-sign (avoids double-fetching while the batch is in flight).
//   • `null`      — the batch call settled (success or error) but has
//     nothing for this exact path; the card should self-sign as a fallback.
//   • a string     — use it directly, no self-signing needed.
export function resolveProvidedSignedUrl(
  path: string | null | undefined,
  map: Record<string, string> | undefined,
  batchSettled: boolean,
): string | null | undefined {
  if (!path) return null; // nothing to sign for this item, regardless of batch state
  if (!batchSettled) return undefined; // still waiting on the batch call
  return map?.[path] ?? null;
}
