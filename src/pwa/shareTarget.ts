// Web Share Target plumbing, shared by the service worker's POST handler and
// the /capture/share-target route (US-003).
//
// How an Android share actually arrives
// -------------------------------------
// The manifest declares ONE share_target, and a share_target has ONE method. We
// use `POST` + `multipart/form-data`, which is the only shape that can carry
// files — and Chrome sends the text fields (title/text/url) in that same POST
// body, so one entry covers both a shared link and a shared photo.
//
// A static origin cannot answer a POST, so the service worker intercepts it,
// normalises it, and 303-redirects to the SAME path as a GET:
//
//   link  →  /capture/share-target?url=…&text=…&title=…
//   photo →  /capture/share-target?shared-file=<key>   (bytes stashed in a Cache)
//
// That keeps the route itself a plain GET surface: it reads query params, so it
// is directly testable and still works when opened by hand with `?url=…`.
//
// IMPORTANT — src/sw.ts must NOT import this module. The worker is emitted as a
// classic script (see `build.rollupOptions` in vite.config.ts, and the US-001
// test asserting sw.ts imports nothing); the moment it imports app code Rollup
// writes an ESM `import` into sw.js and registration throws at parse time. The
// three constants below are therefore duplicated as string literals inside
// src/sw.ts, and src/test/shareTargetRoute.test.tsx asserts the copies never
// drift apart.

/** Manifest `share_target.action`, and the route path in App.tsx. */
export const SHARE_TARGET_PATH = "/capture/share-target";

/** Cache the worker parks a shared file in until the page picks it up. */
export const SHARE_TARGET_CACHE = "verdanote-share-target-v1";

/** Synthetic request path prefix used as the cache key for a stashed file. */
export const SHARE_TARGET_STASH_PREFIX = "/__verdanote-shared-file/";

/**
 * Header carrying the original filename through the Cache.
 *
 * The value is percent-encoded. Header values are ByteStrings, so writing a
 * filename with any code point above 255 — CJK, Cyrillic, emoji, plenty of
 * accented characters — throws, and the worker would turn a perfectly good
 * photo into a "that share did not come through" error.
 */
export const SHARED_FILE_NAME_HEADER = "x-verdanote-shared-file-name";

/** Header carrying the epoch-ms a file was stashed, so stale entries can be swept. */
export const SHARED_FILE_STASHED_AT_HEADER = "x-verdanote-shared-at";

/**
 * How long a stashed file may sit before the worker sweeps it.
 *
 * A share is picked up seconds after it is written, so anything older belongs to
 * a handoff that never completed (tab killed, user backed out). Without a sweep
 * those full-resolution photos accumulate on the device forever, and once origin
 * quota is hit `cache.put` starts throwing and EVERY later photo share fails.
 */
export const SHARE_STASH_TTL_MS = 10 * 60 * 1000;

/** Query param naming the stashed file, set by the worker after a photo share. */
export const SHARED_FILE_PARAM = "shared-file";

/** Query param the worker sets when it could not read the shared POST at all. */
export const SHARE_ERROR_PARAM = "share-error";

/**
 * Pull a shareable link out of the params Chrome handed us.
 *
 * Why this is not just `params.get("url")`: Android apps are inconsistent about
 * which field they fill. Instagram and TikTok typically put the permalink in
 * `text`, often wrapped in prose ("Check this out https://…"), and leave `url`
 * empty. Reading only `url` would make the most common real share a no-op, so
 * we check url → text → title and pull the first http(s) link out of each.
 */
export function extractSharedUrl(params: URLSearchParams): string | null {
  for (const field of ["url", "text", "title"] as const) {
    const raw = params.get(field);
    if (!raw) continue;

    const trimmed = raw.trim();
    // Whole-field URL: keep it verbatim (query strings and all).
    if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;

    // Otherwise find the first link embedded in the prose.
    const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
    // Trim trailing sentence punctuation a link can pick up in a text share.
    if (match) return match[0].replace(/[.,;:!?)\]}]+$/, "");
  }
  return null;
}

/**
 * Retrieve — and consume — the file the worker stashed for this share.
 *
 * Consuming matters: without the delete, pulling to refresh or hitting back
 * would re-run the capture and create a duplicate vault item from a share the
 * user only made once.
 *
 * Resolves null rather than throwing when there is nothing to read (no Cache
 * API, worker never ran, key already consumed) so the route can fall through to
 * its "nothing to save" state instead of an error screen.
 */
export async function takeSharedFile(
  key: string | null | undefined,
  cacheStorage: CacheStorage | undefined = typeof caches === "undefined" ? undefined : caches,
): Promise<File | null> {
  if (!key || !cacheStorage) return null;

  const cacheKey = SHARE_TARGET_STASH_PREFIX + key;
  try {
    const cache = await cacheStorage.open(SHARE_TARGET_CACHE);
    const response = await cache.match(cacheKey);
    if (!response) return null;

    // Read the bytes before evicting the entry — the Response we already hold
    // stays readable, but this ordering keeps it obviously safe.
    const blob = await response.blob();
    await cache.delete(cacheKey);

    const rawName = response.headers.get(SHARED_FILE_NAME_HEADER);
    const type = response.headers.get("content-type") || blob.type || "";
    return new File([blob], decodeSharedFileName(rawName), { type });
  } catch {
    return null;
  }
}

/** Reverse the worker's percent-encoding, tolerating a malformed value. */
export function decodeSharedFileName(raw: string | null | undefined): string {
  if (!raw) return "shared-image";
  try {
    return decodeURIComponent(raw) || "shared-image";
  } catch {
    return raw;
  }
}

/**
 * Where to land after a successful sign-in (read by LoginPage).
 *
 * A capture surface that bounced an unauthenticated visitor to /login parks its
 * own path in router state so the interrupted share resumes instead of dumping
 * the user on the dashboard. That path is derived from attacker-influenced share
 * text, so only same-origin absolute paths are honoured: `//evil.example` is a
 * protocol-relative URL and `/\evil.example` is treated as one by several
 * parsers, so both are rejected along with anything carrying control characters.
 */
export function resolvePostLoginPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== "string" || from.length === 0 || from.length > 2048) return "/";
  // Control characters, whitespace and backslashes can all be used to smuggle a
  // scheme past a naive prefix check; a legitimate route never contains them.
  // Checked by code point rather than a regex literal, which would need a raw
  // control character embedded in the source (eslint no-control-regex).
  for (let i = 0; i < from.length; i += 1) {
    const code = from.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x5c /* backslash */) return "/";
  }
  if (!from.startsWith("/") || from.startsWith("//")) return "/";
  return from;
}

/**
 * Remember that a share has already been saved, so a reload does not save it
 * twice.
 *
 * A photo share is naturally single-use — the bytes are consumed out of the
 * Cache. A LINK share is not: the whole payload lives in the query string, so
 * Chrome Android's pull-to-refresh (a one-finger gesture on exactly this screen)
 * would remount the route and create a second vault item. Keyed by the search
 * string and scoped to the tab, which is the same lifetime as the share itself.
 */
const CONSUMED_SHARE_KEY_PREFIX = "verdanote:share-consumed:";

function shareMemory(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Storage access can throw outright under strict privacy settings.
    return null;
  }
}

export function wasShareConsumed(search: string): boolean {
  return shareMemory()?.getItem(CONSUMED_SHARE_KEY_PREFIX + search) === "1";
}

export function markShareConsumed(search: string): void {
  try {
    shareMemory()?.setItem(CONSUMED_SHARE_KEY_PREFIX + search, "1");
  } catch {
    // Quota or privacy failure — losing dedupe is better than losing the save.
  }
}
