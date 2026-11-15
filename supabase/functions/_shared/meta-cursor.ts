// Token-free Meta Graph pagination cursors.
//
// Meta's `paging.next` URLs and our own request URLs embed `access_token=`.
// Persisting them into sync_logs.sync_state would expose the token to anyone
// who can read that row. Persist the URL with the token removed, and attach the
// current token again when resuming.

const TOKEN_PARAM = "access_token";

/** Remove every access_token query parameter from a URL string. Non-URLs pass through. */
export function stripAccessToken(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete(TOKEN_PARAM);
    return u.toString();
  } catch {
    // Not a parseable absolute URL: drop the parameter textually as a fallback.
    return url
      .replace(/([?&])access_token=[^&#]*(&|$)/g, (_m, lead, tail) => (tail === "&" ? lead : ""))
      .replace(/[?&]$/, "");
  }
}

/** Return a value safe to persist (null and non-strings pass through). */
export function toStoredCursor<T>(value: T): T {
  return (typeof value === "string" ? stripAccessToken(value) : value) as T;
}

/**
 * Prepare a stored cursor for use: drop any legacy embedded access_token and
 * attach the current token. Returns null for an empty cursor.
 */
export function resumeCursor(stored: string | null | undefined, token: string): string | null {
  if (!stored) return null;
  const u = new URL(stripAccessToken(stored));
  u.searchParams.set(TOKEN_PARAM, token);
  return u.toString();
}

/** Strip tokens from every `*_cursor` string field of a sync_state object. */
export function sanitizeSyncState<T extends Record<string, unknown>>(state: T): T {
  const out: Record<string, unknown> = { ...state };
  for (const key of Object.keys(out)) {
    if (key.endsWith("_cursor")) out[key] = toStoredCursor(out[key]);
  }
  return out as T;
}
