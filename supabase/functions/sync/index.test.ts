// Regression tests for metaFetch cursor/rate-limit semantics (audit 2026-06-09).
//
// Covers:
//   * success page — data + paging.next passed through.
//   * non-rate-limit Meta error — error:true, retriableUrl null (terminal).
//   * rate-limit retries exhausted — error:false, rateLimited:true, retriableUrl
//     preserved so phases resume the exact page instead of restarting (the old
//     behavior returned retriableUrl:null, which made Phase 2/4 treat the pause
//     as completion → permanent data gaps once last_data_sync advanced).
//   * timeout at entry — retriableUrl preserved.
//
// SYNC_NO_SERVE prevents the module-level serve() from binding; SYNC_BACKOFF_BASE_SEC=0
// collapses the exponential backoff so the exhaustion path runs instantly.
//   deno test -A supabase/functions/sync/index.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("SYNC_BACKOFF_BASE_SEC", "0");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const { metaFetch, isInformationalSyncNote, countRealErrors } = await import("./index.ts");

function ctx(timedOut = false) {
  return {
    metaApiCalls: 0,
    apiErrors: [] as { timestamp: string; message: string }[],
    isTimedOut: () => timedOut,
  };
}

function stubFetch(body: unknown) {
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify(body)))) as typeof fetch;
}

const realFetch = globalThis.fetch;
const URL_UNDER_TEST = "https://graph.facebook.com/v22.0/act_1/ads?limit=200";

Deno.test("metaFetch passes through data and paging.next on success", async () => {
  try {
    stubFetch({ data: [{ id: "1" }], paging: { next: "https://next.page" } });
    const result = await metaFetch(URL_UNDER_TEST, ctx());
    assertEquals(result.data, [{ id: "1" }]);
    assertEquals(result.next, "https://next.page");
    assertEquals(result.error, false);
    assertEquals(result.rateLimited, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("metaFetch returns terminal error (no retriableUrl) on non-rate-limit Meta error", async () => {
  try {
    stubFetch({ error: { code: 100, message: "Unsupported get request" } });
    const result = await metaFetch(URL_UNDER_TEST, ctx());
    assertEquals(result.error, true);
    assertEquals(result.rateLimited, false);
    assertEquals(result.retriableUrl, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("metaFetch preserves retriableUrl when rate-limit retries are exhausted", async () => {
  try {
    stubFetch({ error: { code: 4, message: "Application request limit reached" } });
    const c = ctx();
    const result = await metaFetch(URL_UNDER_TEST, c);
    // Exhaustion is a pause, not a failure: the caller must save the cursor and resume.
    assertEquals(result.error, false);
    assertEquals(result.rateLimited, true);
    assertEquals(result.retriableUrl, URL_UNDER_TEST);
    // initial call + MAX_RATE_LIMIT_RETRIES retries
    assertEquals(c.metaApiCalls, 6);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("metaFetch returns retriableUrl without fetching when already timed out", async () => {
  try {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch;
    const result = await metaFetch(URL_UNDER_TEST, ctx(true));
    assertEquals(result.retriableUrl, URL_UNDER_TEST);
    assertEquals(result.error, false);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Regression: a sync whose only apiErrors entries are throttle backoffs must
// finalize as "completed", not "completed_with_errors" (sync 369, 2026-06-09:
// 5 backoff notes, data matched Meta +0.00%, yet history showed errors).
Deno.test("informational throttle notes are not real errors", () => {
  assertEquals(isInformationalSyncNote("Rate limited, backing off 30s"), true);
  assertEquals(isInformationalSyncNote("Rate limited, backing off 300s"), true);
  assertEquals(isInformationalSyncNote("Rate limit retries exhausted — paused with resumable cursor"), true);
  assertEquals(isInformationalSyncNote("Meta API error — code: 100, subcode: ?, type: ?, msg: Unsupported get request"), false);
  assertEquals(isInformationalSyncNote("Daily upsert failed: duplicate key"), false);
  assertEquals(isInformationalSyncNote(""), false);
});

Deno.test("countRealErrors filters backoff notes but keeps genuine errors", () => {
  const onlyBackoffs = [
    { message: "Rate limited, backing off 30s" },
    { message: "Rate limited, backing off 60s" },
    { message: "Rate limit retries exhausted — paused with resumable cursor" },
  ];
  assertEquals(countRealErrors(onlyBackoffs), 0);
  const mixed = [...onlyBackoffs, { message: "Phase 2 pagination halted on API error" }, {}];
  assertEquals(countRealErrors(mixed), 2);
});
