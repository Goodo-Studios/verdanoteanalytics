/// <reference lib="webworker" />

// Minimal pass-through service worker.
//
// Why it exists: a Web Share Target (US-003) is only delivered to an *installed*
// PWA, and the image half of that share arrives as a multipart/form-data POST.
// A static origin cannot accept a POST, so the only place to receive it is a
// service worker fetch handler. This worker is the foundation that story builds
// on.
//
// Note it is NOT here to satisfy Chrome's install criteria: Chrome dropped the
// "must register a service worker with a fetch handler" requirement in 108
// (mobile) / 112 (desktop), and now only needs a valid manifest over HTTPS.
// Don't re-derive the old rule from this file's existence.
//
// Non-goal: offline support. Nothing here precaches the app shell or serves
// assets cache-first — a deliberate project decision, since a stale cached
// shell is worse than a failed request for an internal tool. US-003 adding an
// `event.respondWith()` branch to receive the share-target POST is expected and
// does not conflict with that.

export {};

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => {
  // Take over immediately instead of waiting for every tab to close, so a
  // freshly deployed worker never lingers a version behind.
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally empty for now: no respondWith(), so every request falls
  // through to the network exactly as it would with no worker at all.
});
