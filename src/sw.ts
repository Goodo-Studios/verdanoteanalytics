/// <reference lib="webworker" />

// Minimal service worker: pass-through, plus the Web Share Target POST handler.
//
// Why it exists: a Web Share Target (US-003) is only delivered to an *installed*
// PWA, and the image half of that share arrives as a multipart/form-data POST.
// A static origin cannot accept a POST, so the only place to receive it is a
// service worker fetch handler. That handler now lives at the bottom of this
// file.
//
// Note it is NOT here to satisfy Chrome's install criteria: Chrome dropped the
// "must register a service worker with a fetch handler" requirement in 108
// (mobile) / 112 (desktop), and now only needs a valid manifest over HTTPS.
// Don't re-derive the old rule from this file's existence.
//
// Non-goal: offline support. Nothing here precaches the app shell or serves
// assets cache-first — a deliberate project decision, since a stale cached
// shell is worse than a failed request for an internal tool. The share-target
// branch below uses a Cache only as a one-shot handoff buffer for the shared
// bytes; it never serves app assets from it.
//
// This file must stay IMPORT-FREE. It is emitted as its own un-hashed rollup
// entry (vite.config.ts) and registered as a classic script, so a single
// `import` would make Rollup write ESM into sw.js and registration would throw
// at parse time. That is why the three share-target constants below are
// duplicated literals rather than imports from src/pwa/shareTarget.ts —
// src/test/shareTargetRoute.test.tsx asserts the two copies stay in sync.

export {};

declare const self: ServiceWorkerGlobalScope;

// --- Share target (keep in sync with src/pwa/shareTarget.ts) ---------------
const SHARE_TARGET_PATH = "/capture/share-target";
const SHARE_TARGET_CACHE = "verdanote-share-target-v1";
const SHARE_TARGET_STASH_PREFIX = "/__verdanote-shared-file/";
const SHARED_FILE_NAME_HEADER = "x-verdanote-shared-file-name";
const SHARED_FILE_STASHED_AT_HEADER = "x-verdanote-shared-at";
const SHARE_STASH_TTL_MS = 600000; // 10 minutes

self.addEventListener("install", () => {
  // Take over immediately instead of waiting for every tab to close, so a
  // freshly deployed worker never lingers a version behind.
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([self.clients.claim(), sweepStaleShares()]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Everything except the share-target POST falls through to the network
  // exactly as it would with no worker at all — no respondWith(), no caching.
  if (request.method !== "POST") return;

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return;
  }
  // Same-origin only. Matching on pathname alone would let a page-initiated
  // POST to some third party that happens to use this path get hijacked into a
  // redirect to our route.
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname !== SHARE_TARGET_PATH) return;

  event.respondWith(handleShareTarget(request));
});

/**
 * Turn Chrome's multipart share POST into a GET the SPA route can read.
 *
 * Text fields become query params. A shared image is parked in a Cache under a
 * one-time key, and only that key travels in the URL — an object URL would die
 * with this worker's execution context, and the bytes are far too large for a
 * query string.
 *
 * Always resolves with a 303 redirect, never a rejection: the share sheet has
 * already closed by this point, so a thrown error would leave the user staring
 * at a Chrome error page with no idea what happened. A failure instead lands on
 * the route with `?share-error=1`, which renders a plain-language retry.
 */
async function handleShareTarget(request: Request): Promise<Response> {
  const target = new URL(SHARE_TARGET_PATH, self.location.origin);

  try {
    const form = await request.formData();

    for (const field of ["url", "text", "title"]) {
      const value = form.get(field);
      if (typeof value === "string" && value.trim()) {
        target.searchParams.set(field, value.trim());
      }
    }

    // `image` is the param name declared in the manifest's share_target.
    const file = form
      .getAll("image")
      .find((entry): entry is File => entry instanceof File && entry.size > 0);

    if (file) {
      // Drop abandoned handoffs before adding another, so a user who keeps
      // backing out of shares cannot fill the origin's storage quota — once
      // that happens `cache.put` throws and EVERY later photo share fails.
      await sweepStaleShares();

      const now = Date.now();
      const key = `${now}-${Math.random().toString(36).slice(2, 10)}`;
      const cache = await caches.open(SHARE_TARGET_CACHE);
      await cache.put(
        SHARE_TARGET_STASH_PREFIX + key,
        new Response(file, {
          headers: {
            "content-type": file.type || "application/octet-stream",
            // Header values are ByteStrings: an un-encoded CJK/emoji/accented
            // filename throws here and would fail an otherwise fine share.
            [SHARED_FILE_NAME_HEADER]: encodeURIComponent(file.name || "shared-image"),
            [SHARED_FILE_STASHED_AT_HEADER]: String(now),
          },
        }),
      );
      target.searchParams.set("shared-file", key);
    }
  } catch {
    target.searchParams.set("share-error", "1");
  }

  // 303 so the browser follows up with a GET; a 302 would replay the POST.
  return Response.redirect(target.toString(), 303);
}

/**
 * Delete stashed files older than the TTL.
 *
 * The page consumes its own entry on a successful handoff, so anything left
 * belongs to a share that never landed (tab killed, user navigated away). Never
 * throws — a failed sweep must not take the share down with it.
 */
async function sweepStaleShares(): Promise<void> {
  try {
    if (!(await caches.has(SHARE_TARGET_CACHE))) return;
    const cache = await caches.open(SHARE_TARGET_CACHE);
    const cutoff = Date.now() - SHARE_STASH_TTL_MS;

    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      const stashedAt = Number(response?.headers.get(SHARED_FILE_STASHED_AT_HEADER));
      // An entry with no/unreadable timestamp predates this sweep — drop it too.
      if (!Number.isFinite(stashedAt) || stashedAt < cutoff) {
        await cache.delete(request);
      }
    }
  } catch {
    // Storage unavailable — nothing to do.
  }
}
