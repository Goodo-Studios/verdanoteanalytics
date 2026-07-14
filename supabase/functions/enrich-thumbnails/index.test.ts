// Regression test for the media-ingestion "impressions > 0" gate.
//
// Bug: every media-selection query in enrich-thumbnails filtered `.gt("impressions", 0)`,
// so creatives with 0/null impressions were never given a thumbnail or video — yet they
// are still rendered in the ad library, producing permanently broken cards.
//
// This test runs each phase function against a recording mock Supabase client (which
// returns empty result sets, so the phases short-circuit before any Meta/network call)
// and asserts that NO selection query filters on `impressions`, while the per-row
// skip-gates that bound the work (thumbnail_url IS NULL, etc.) remain in place.
//
// Run: ENRICH_NO_SERVE is set before import so serve() never starts a listener.
//   deno test -A supabase/functions/enrich-thumbnails/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isStorageUrl as isStorageUrlLocal,
  looksLikeHtml,
  NO_THUMB_SENTINEL as NO_THUMB_SENTINEL_LOCAL,
  NO_VIDEO_SENTINEL as NO_VIDEO_SENTINEL_LOCAL,
} from "../_shared/media-discovery.ts";

// Must be set BEFORE importing index.ts so the module-level serve() call is skipped.
Deno.env.set("ENRICH_NO_SERVE", "1");
// scope=all chains a live POST to itself; disable so the handler test never hits the network.
Deno.env.set("ENRICH_NO_CHAIN", "1");
// Token resolved from env first; set it so the handler skips the settings-table lookup
// (the recorder has no .single()). Values are irrelevant — the mock client returns empty sets.
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

interface Call {
  method: string;
  args: unknown[];
}

/**
 * A chainable Supabase query-builder stand-in. Every PostgREST filter/modifier
 * method records its call and returns `this`; terminal `.limit()` (and awaiting
 * the builder directly) resolves to an empty result set so the phase under test
 * returns before touching Meta or storage.
 */
function makeRecorder() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "from", "select", "is", "eq", "neq", "not", "or", "gt", "lt",
    "order", "update", "insert", "in",
  ];
  for (const m of chainMethods) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  // Terminal: resolves to an empty data set.
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: "limit", args });
    return Promise.resolve({ data: [], error: null });
  };
  // Awaiting the builder directly (no .limit) also yields empty data.
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });

  const supabase = {
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder;
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  };

  return { supabase, calls };
}

function hasImpressionsFilter(calls: Call[]): boolean {
  return calls.some(
    (c) =>
      ["gt", "lt", "eq", "neq", "is"].includes(c.method) &&
      c.args[0] === "impressions",
  );
}

function hasCall(calls: Call[], method: string, arg0: unknown): boolean {
  return calls.some((c) => c.method === method && c.args[0] === arg0);
}

function hasOrContaining(calls: Call[], needle: string): boolean {
  return calls.some(
    (c) => c.method === "or" && typeof c.args[0] === "string" && (c.args[0] as string).includes(needle),
  );
}

const TOKEN = "fake-meta-token";

Deno.test("runDiscovery does not filter on impressions but gates on the sentinel-inclusive null-thumbnail set with a retry-backoff window", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runDiscovery(supabase, null, TOKEN);
  assert(!hasImpressionsFilter(calls), "runDiscovery must not filter on impressions");
  // Now picks up both NULL thumbnails AND due sentinels via .or(), not a bare .is() skip-gate.
  assert(
    hasOrContaining(calls, "thumbnail_url.is.null"),
    "runDiscovery must select rows where thumbnail_url IS NULL or equals the sentinel",
  );
  assert(
    hasOrContaining(calls, "thumb_retry_after"),
    "runDiscovery must carry a thumb_retry_after backoff gate so transient failures aren't re-hammered",
  );
});

Deno.test("runCaching does not filter on impressions but keeps the storage-path skip-gate", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runCaching(supabase, null);
  assert(!hasImpressionsFilter(calls), "runCaching must not filter on impressions");
  assert(hasCall(calls, "is", "thumbnail_storage_path"), "runCaching must keep .is(thumbnail_storage_path, null) skip-gate");
});

Deno.test("runVideoDiscovery does not filter on impressions but gates on the sentinel-inclusive null-video set with a retry-backoff window", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runVideoDiscovery(supabase, null, TOKEN);
  assert(!hasImpressionsFilter(calls), "runVideoDiscovery must not filter on impressions");
  assert(
    hasOrContaining(calls, "video_url.is.null"),
    "runVideoDiscovery must select rows where video_url IS NULL or equals the sentinel",
  );
  assert(
    hasOrContaining(calls, "video_retry_after"),
    "runVideoDiscovery must carry a video_retry_after backoff gate so transient failures aren't re-hammered",
  );
});

Deno.test("runForcedRediscovery does not filter on impressions but targets the thumbnail sentinel", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runForcedRediscovery(supabase, null, TOKEN);
  assert(!hasImpressionsFilter(calls), "runForcedRediscovery must not filter on impressions");
  assert(hasCall(calls, "eq", "thumbnail_url"), "runForcedRediscovery must target .eq(thumbnail_url, sentinel)");
});

Deno.test("runVideoRediscovery does not filter on impressions but targets the video sentinel", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runVideoRediscovery(supabase, null, TOKEN);
  assert(!hasImpressionsFilter(calls), "runVideoRediscovery must not filter on impressions");
  assert(hasCall(calls, "eq", "video_url"), "runVideoRediscovery must target .eq(video_url, sentinel)");
});

Deno.test("runVideoCaching does not filter on impressions but skips already-cached storage URLs", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runVideoCaching(supabase, null);
  assert(!hasImpressionsFilter(calls), "runVideoCaching must not filter on impressions");
  assert(hasCall(calls, "not", "video_url"), "runVideoCaching must keep the storage-URL exclusion");
});

Deno.test("account filter is still applied when provided", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runDiscovery(supabase, "act_123", TOKEN);
  assertEquals(hasCall(calls, "eq", "account_id"), true, "account filter must scope the query");
});

// ── P0.1: discovery must run before (and separately from) caching for scope=all ──
// Root cause of "videos not saved": the old scope=all ran video caching before video
// discovery, so on a fresh account video_url was still null when caching ran (nothing to
// cache); discovery then wrote a raw CDN url that expired before the next run. The fix
// runs discovery inline and chains caching to a SEPARATE invocation, so a scope=all pass
// must (a) issue the discovery selection gates and (b) NOT run the caching skip-gates inline.
Deno.test("scope=all runs discovery inline and defers caching to a separate invocation", async () => {
  const { supabase, calls } = makeRecorder();
  const req = new Request("https://fn.local/enrich-thumbnails?scope=all");
  const res = await mod.handler(req, supabase);
  await res.text();

  // Discovery ran: both thumbnail and video selection gates are present.
  assert(hasOrContaining(calls, "thumbnail_url.is.null"), "scope=all must run thumbnail discovery inline");
  assert(hasOrContaining(calls, "video_url.is.null"), "scope=all must run video discovery inline");

  // Caching did NOT run inline — it is chained to a separate ?scope=cache invocation.
  assert(
    !hasCall(calls, "is", "thumbnail_storage_path"),
    "scope=all must NOT run image caching inline (it's chained to a separate invocation)",
  );
  assert(
    !hasCall(calls, "not", "video_url"),
    "scope=all must NOT run video caching inline (it's chained to a separate invocation)",
  );
});

Deno.test("scope=cache runs the caching phases (and no discovery)", async () => {
  const { supabase, calls } = makeRecorder();
  const req = new Request("https://fn.local/enrich-thumbnails?scope=cache");
  const res = await mod.handler(req, supabase);
  await res.text();

  assert(hasCall(calls, "is", "thumbnail_storage_path"), "scope=cache must run image caching");
  assert(hasCall(calls, "not", "video_url"), "scope=cache must run video caching");
  assert(!hasOrContaining(calls, "thumbnail_url.is.null"), "scope=cache must not run thumbnail discovery");
});

Deno.test("nextRetryAfter implements bounded exponential backoff", () => {
  const t1 = new Date(mod.nextRetryAfter(1)).getTime();
  const t2 = new Date(mod.nextRetryAfter(2)).getTime();
  const now = Date.now();
  assert(t1 > now, "first retry must be in the future");
  assert(t2 > t1, "backoff must increase with retry count");
  const tCap = new Date(mod.nextRetryAfter(999)).getTime();
  assert(tCap - now <= 7 * 24 * 60 * 60 * 1000 + 60_000, "backoff must cap at 7 days");
});

// ════════════════════════════════════════════════════════════════════════════
// Repair pass (scope=repair) — heal poisoned storage objects
//
// Root cause of the live failure: 15/20 Cane Masters thumbnails were Facebook
// error/login HTML pages stored as `<adId>.jpg` (content-type text/plain), and
// the video bucket the same (HTML as .mp4). The URL is a valid storage URL, so
// the old skip-gate `isStorageUrl(thumbnail_url)` treated the row as healthy and
// never re-fetched — a permanent stuck state. These tests cover the magic-byte
// sniff + the validate/delete/null/reset repair pass that frees the row.
// ════════════════════════════════════════════════════════════════════════════

// Leading bytes of a Facebook error/login page (what got saved as <adId>.jpg/.mp4).
const HTML_BYTES = new TextEncoder().encode(
  "<!DOCTYPE html>\n<html lang=\"en\"><head><title>Error</title></head><body>Sorry</body></html>",
);
// Real JPEG SOI + JFIF marker — must NOT be mistaken for HTML.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

Deno.test("looksLikeHtml: HTML/text bytes are caught, real media bytes pass", () => {
  assert(looksLikeHtml(HTML_BYTES), "a <!DOCTYPE html> page must be flagged");
  assert(looksLikeHtml(new TextEncoder().encode("<html><body>hi</body></html>")), "<html> must be flagged");
  assert(looksLikeHtml(new TextEncoder().encode("  \n  <!doctype HTML>")), "leading whitespace + mixed case must still be flagged");
  assert(looksLikeHtml(new TextEncoder().encode("<?xml version=\"1.0\"?>")), "an XML error doc must be flagged");
  assert(!looksLikeHtml(JPEG_BYTES), "real JPEG bytes must pass");
  assert(!looksLikeHtml(new Uint8Array([0x47, 0x49, 0x46, 0x38])), "GIF bytes must pass");
  assert(!looksLikeHtml(new Uint8Array(0)), "empty buffer is not HTML");
  assert(!looksLikeHtml(null), "null is not HTML");
});

Deno.test("parseStoragePublicUrl extracts bucket + path, ignores query string, rejects non-storage URLs", () => {
  const parsed = mod.parseStoragePublicUrl(
    "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1058298398102027/12345.jpg?t=1",
  );
  assertEquals(parsed, { bucket: "ad-thumbnails", path: "act_1058298398102027/12345.jpg" });
  assertEquals(mod.parseStoragePublicUrl("https://scontent.fbcdn.net/v/whatever.jpg"), null);
});

// Stub globalThis.fetch for validateStorageObject. `res` shapes a minimal Response.
function withFetch(
  impl: () => { ok: boolean; status: number; contentType: string; body: Uint8Array },
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((..._a: unknown[]) => {
    const r = impl();
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? r.contentType : null) },
      arrayBuffer: () => Promise.resolve(r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength)),
      body: { cancel: () => Promise.resolve() },
    });
  }) as any;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("validateStorageObject: HTML-as-jpg ⇒ poison", async () => {
  await withFetch(
    () => ({ ok: true, status: 206, contentType: "text/plain", body: HTML_BYTES }),
    async () => {
      assertEquals(await mod.validateStorageObject("https://x/storage/v1/object/public/ad-thumbnails/a/1.jpg"), "poison");
    },
  );
});

Deno.test("validateStorageObject: real JPEG ⇒ ok", async () => {
  await withFetch(
    () => ({ ok: true, status: 206, contentType: "image/jpeg", body: JPEG_BYTES }),
    async () => {
      assertEquals(await mod.validateStorageObject("https://x/storage/v1/object/public/ad-thumbnails/a/1.jpg"), "ok");
    },
  );
});

Deno.test("validateStorageObject: fetch failure ⇒ unknown (never destroys a healthy asset on a network blip)", async () => {
  await withFetch(
    () => ({ ok: false, status: 500, contentType: "", body: new Uint8Array(0) }),
    async () => {
      assertEquals(await mod.validateStorageObject("https://x/storage/v1/object/public/ad-thumbnails/a/1.jpg"), "unknown");
    },
  );
});

// Repair recorder: like makeRecorder but the select terminal (.limit) yields the
// supplied rows, and storage.remove / table .update(...).eq("ad_id", …) are captured.
function makeRepairRecorder(rows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const removed: { bucket: string; paths: string[] }[] = [];
  const updates: { adId: unknown; updates: Record<string, unknown> }[] = [];
  let pendingUpdate: Record<string, unknown> | null = null;

  const builder: Record<string, unknown> = {};
  const chainMethods = ["from", "select", "is", "eq", "neq", "not", "or", "gt", "lt", "order", "update", "insert", "in"];
  for (const m of chainMethods) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      if (m === "update") pendingUpdate = args[0] as Record<string, unknown>;
      if (m === "eq" && args[0] === "ad_id" && pendingUpdate) {
        updates.push({ adId: args[1], updates: pendingUpdate });
        pendingUpdate = null;
      }
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: "limit", args });
    return Promise.resolve({ data: rows, error: null });
  };
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });

  const supabase = {
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder;
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          removed.push({ bucket, paths });
          return Promise.resolve({ error: null });
        },
        upload: () => Promise.resolve({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  };
  return { supabase, calls, removed, updates };
}

Deno.test("runRepair: poisoned thumbnail ⇒ deletes object, NULLs columns + storage path + full_res, resets retry counter", async () => {
  const row = {
    ad_id: "ad_1",
    account_id: "act_1058298398102027",
    thumbnail_url: "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1058298398102027/ad_1.jpg",
    full_res_url: "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1058298398102027/ad_1.jpg",
    video_url: null,
    thumbnail_storage_path: "act_1058298398102027/ad_1.jpg",
  };
  const { supabase, removed, updates } = makeRepairRecorder([row]);

  await withFetch(
    () => ({ ok: true, status: 206, contentType: "text/plain", body: HTML_BYTES }),
    async () => {
      const repaired = await mod.runRepair(supabase, "act_1058298398102027");
      assertEquals(repaired, 1, "one poisoned row repaired");
    },
  );

  assertEquals(removed.length, 1, "poisoned object deleted from its bucket");
  assertEquals(removed[0], { bucket: "ad-thumbnails", paths: ["act_1058298398102027/ad_1.jpg"] });

  assertEquals(updates.length, 1, "one row update issued");
  const u = updates[0].updates;
  assertEquals(u.thumbnail_url, null, "thumbnail_url nulled so discovery re-runs");
  assertEquals(u.thumbnail_storage_path, null, "storage path nulled so caching re-runs");
  assertEquals(u.full_res_url, null, "full_res_url (mirror of poison) nulled too");
  assertEquals(u.thumb_retry_count, 0, "retry counter reset");
  assertEquals(u.thumb_retry_after, null, "retry backoff cleared");
});

Deno.test("runRepair: healthy media ⇒ leaves the row completely untouched", async () => {
  const row = {
    ad_id: "ad_ok",
    account_id: "act_1058298398102027",
    thumbnail_url: "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1058298398102027/ad_ok.jpg",
    full_res_url: null,
    video_url: null,
    thumbnail_storage_path: "act_1058298398102027/ad_ok.jpg",
  };
  const { supabase, removed, updates } = makeRepairRecorder([row]);

  await withFetch(
    () => ({ ok: true, status: 206, contentType: "image/jpeg", body: JPEG_BYTES }),
    async () => {
      const repaired = await mod.runRepair(supabase, "act_1058298398102027");
      assertEquals(repaired, 0, "healthy row is not counted as repaired");
    },
  );

  assertEquals(removed.length, 0, "healthy object must NOT be deleted");
  assertEquals(updates.length, 0, "healthy row must NOT be updated");
});

Deno.test("runRepair: transient fetch failure ⇒ row untouched (no destructive action on a blip)", async () => {
  const row = {
    ad_id: "ad_blip",
    account_id: "act_1058298398102027",
    thumbnail_url: "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1058298398102027/ad_blip.jpg",
    full_res_url: null,
    video_url: null,
    thumbnail_storage_path: "act_1058298398102027/ad_blip.jpg",
  };
  const { supabase, removed, updates } = makeRepairRecorder([row]);

  await withFetch(
    () => ({ ok: false, status: 503, contentType: "", body: new Uint8Array(0) }),
    async () => {
      const repaired = await mod.runRepair(supabase, "act_1058298398102027");
      assertEquals(repaired, 0, "transient failure is not a repair");
    },
  );

  assertEquals(removed.length, 0, "must NOT delete on transient failure");
  assertEquals(updates.length, 0, "must NOT null columns on transient failure");
});

Deno.test("scope=repair runs the repair selection and does not run discovery/caching inline", async () => {
  const { supabase, calls } = makeRepairRecorder([]);
  const req = new Request("https://fn.local/enrich-thumbnails?scope=repair&account_id=act_1058298398102027");
  const res = await mod.handler(req, supabase);
  const body = await res.json();
  assertEquals(body.scope, "repair");
  // The repair pass selects storage-cached rows via an .or() on the storage marker.
  assert(
    hasOrContaining(calls, "/storage/v1/object/public/"),
    "scope=repair must select rows whose media is a storage URL",
  );
  // With zero rows returned there is nothing to chain — discovery gates must not fire.
  assert(!hasOrContaining(calls, "thumbnail_url.is.null"), "scope=repair (no rows) must not run discovery inline");
});

// ── Video caching: success + expired-CDN self-heal ───────────────────────────
//
// Bug: a creative whose video_url is a raw (non-storage) FB CDN url is a dead-end
// once that time-limited url expires. runVideoCaching can't download it (CDN 4xx)
// and runVideoDiscovery skips it (video_url is non-null and not the sentinel), so
// the row is permanently stuck with an unplayable url — the same "looks-set-but-
// broken" gap the poison repair closed for storage objects. Fix: on an expired
// (non-2xx) CDN response, NULL the url + reset the retry window so the next
// discovery pass re-fetches a fresh url that the cache phase can then store.

// mp4 'ftyp' box — passes isMediaContentType + the looksLikeHtml magic-byte guard.
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

// Fetch stub that, unlike withFetch, exposes a streaming body.getReader() because
// cacheVideoToStorage reads large bodies via readBodyCapped (reader path).
function withVideoFetch(
  impl: () => { ok: boolean; status: number; contentType: string; body: Uint8Array },
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((..._a: unknown[]) => {
    const r = impl();
    let sent = false;
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? r.contentType : null) },
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength)),
      body: {
        getReader: () => ({
          read: () => sent
            ? Promise.resolve({ done: true, value: undefined })
            : (sent = true, Promise.resolve({ done: false, value: r.body })),
          cancel: () => Promise.resolve(),
        }),
        cancel: () => Promise.resolve(),
      },
    });
  }) as any;
  return run().finally(() => { globalThis.fetch = original; });
}

Deno.test("runVideoCaching: live CDN video ⇒ downloaded, stored, video_url updated to a storage URL", async () => {
  const { supabase, updates } = makeRepairRecorder([
    { ad_id: "v1", account_id: "act_x", video_url: "https://video.fbcdn.net/v1.mp4" },
  ]);
  await withVideoFetch(
    () => ({ ok: true, status: 200, contentType: "video/mp4", body: MP4_BYTES }),
    async () => {
      const summary = await mod.runVideoCaching(supabase, null);
      assertEquals(summary.cached, 1);
      assertEquals(summary.failed, 0);
      assertEquals(summary.reDiscoverQueued, 0);
      assertEquals(updates.length, 1);
      assertEquals(updates[0].adId, "v1");
      assert(
        String((updates[0].updates as Record<string, unknown>).video_url).includes("/storage/v1/object/public/ad-videos/"),
        "cached video_url must be rewritten to a storage URL",
      );
    },
  );
});

// Table-aware recorder: the concurrency-guard query hits `media_refresh_logs`
// (must be empty so the handler proceeds), while the video-cache query hits
// `creatives` (returns the supplied batch). Lets us exercise the scope=cache
// self-chaining drain end-to-end through the handler.
function makeTableAwareRecorder(creativeRows: Record<string, unknown>[]) {
  let currentTable = "";
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "is", "eq", "neq", "not", "or", "gt", "lt", "order", "update", "insert", "in"];
  for (const m of chainMethods) builder[m] = (..._a: unknown[]) => builder;
  const rowsFor = () => (currentTable === "creatives" ? creativeRows : []);
  builder.limit = () => Promise.resolve({ data: rowsFor(), error: null });
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rowsFor(), error: null });
  const supabase = {
    from: (t: string) => { currentTable = t; return builder; },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  };
  return supabase;
}

// Stub fetch so video downloads "expire" (drives a full failed batch with no body
// handling) while capturing any chained scope=cache POST the drain fires.
function withDrainFetch(chained: string[], run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const hadNoChain = Deno.env.get("ENRICH_NO_CHAIN");
  Deno.env.delete("ENRICH_NO_CHAIN");
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((u: unknown) => {
    const url = String(u);
    if (url.includes("scope=cache&cache_chain=")) {
      chained.push(url);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(""), headers: { get: () => null } });
    }
    return Promise.resolve({
      ok: false, status: 403,
      text: () => Promise.resolve(""),
      headers: { get: () => null },
      body: { cancel: () => Promise.resolve() },
    });
  }) as any;
  return run().finally(() => {
    globalThis.fetch = original;
    if (hadNoChain !== undefined) Deno.env.set("ENRICH_NO_CHAIN", hadNoChain);
  });
}

Deno.test("scope=cache drain: a FULL video batch chains a fresh cache invocation (cache_chain++)", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ ad_id: `d${i}`, account_id: "act_x", video_url: `https://cdn.fb/${i}.mp4` }));
  const supabase = makeTableAwareRecorder(rows);
  const chained: string[] = [];
  await withDrainFetch(chained, async () => {
    const req = new Request("https://fn.local/enrich-thumbnails?scope=cache&account_id=act_x");
    await mod.handler(req, supabase);
  });
  assertEquals(chained.length, 1);
  assert(chained[0].includes("cache_chain=1"), "drain must increment cache_chain");
  assert(chained[0].includes("account_id=act_x"), "drain must preserve the account scope");
});

Deno.test("scope=cache drain: a PARTIAL video batch (fewer than VIDEO_CACHE_LIMIT) does NOT chain (drain terminates)", async () => {
  // 1 row < VIDEO_CACHE_LIMIT ⇒ not a full batch ⇒ no more work ⇒ no chain.
  const rows = Array.from({ length: 1 }, (_, i) => ({ ad_id: `p${i}`, account_id: "act_x", video_url: `https://cdn.fb/${i}.mp4` }));
  const supabase = makeTableAwareRecorder(rows);
  const chained: string[] = [];
  await withDrainFetch(chained, async () => {
    const req = new Request("https://fn.local/enrich-thumbnails?scope=cache&account_id=act_x");
    await mod.handler(req, supabase);
  });
  assertEquals(chained.length, 0);
});

Deno.test("runVideoCaching: expired CDN url (non-2xx) ⇒ NULLs video_url + resets retry so discovery re-fetches", async () => {
  const { supabase, updates } = makeRepairRecorder([
    { ad_id: "v2", account_id: "act_x", video_url: "https://video.fbcdn.net/expired.mp4" },
  ]);
  await withVideoFetch(
    () => ({ ok: false, status: 403, contentType: "", body: new Uint8Array(0) }),
    async () => {
      const summary = await mod.runVideoCaching(supabase, null);
      assertEquals(summary.cached, 0);
      assertEquals(summary.failed, 1);
      assertEquals(summary.reasons.expired, 1);
      assertEquals(summary.reDiscoverQueued, 1);
      assertEquals(updates.length, 1);
      assertEquals(updates[0].adId, "v2");
      const u = updates[0].updates as Record<string, unknown>;
      assertEquals(u.video_url, null);
      assertEquals(u.video_retry_count, 0);
      assertEquals(u.video_retry_after, null);
    },
  );
});

// ════════════════════════════════════════════════════════════════════════════
// US-012 — Workstream 2 verification: new-ad caching, dedupe, no re-download.
//
// This block is the WS2 END-TO-END gate. Rather than re-asserting the individual
// unit contracts (US-008 enqueue helper, US-009 hash/path helpers, US-010 drain
// batching, US-011 isStorageUrl) — which their own suites already pin — it drives
// the REAL drain-media-queue handler + processQueuedAd against a faithful
// in-memory Supabase (queue + creatives + media_assets with the live
// UNIQUE(account_id, asset_key) dedupe constraint) and a storage layer that COUNTS
// every byte download and every stored object. It proves the four workstream
// invariants hold when the actual production code paths run together:
//
//   1. NEW-AD-ONLY, EXACTLY ONCE  — an enqueued new ad is cached exactly once; a
//      second full drain re-touches nothing (queue is idempotent — no re-claim of
//      a done row).
//   2. WITHIN-ACCOUNT DEDUPE       — two ads reusing the identical creative bytes
//      store ONE object and register ONE media_assets row; both creatives point at
//      it (US-009), and the tenant boundary holds (same bytes in a 2nd account =>
//      its own copy).
//   3. NO RE-DOWNLOAD OF CACHED    — once a creative's media column is a storage
//      URL, a subsequent drain short-circuits via isStorageUrl and issues ZERO
//      network downloads for it (US-011 guarantee).
//   4. LARGE-VIDEO DRAIN, NO OOM   — the queue streams a large video to storage
//      without buffering and leaves NO row stuck in 'processing' (US-010).
//
// All Meta/CDN/storage I/O is stubbed — no live prod/Meta call (per policy). The
// drain worker module is imported with its serve() bind + self-chain disabled.
// ════════════════════════════════════════════════════════════════════════════

Deno.env.set("DRAIN_MEDIA_QUEUE_NO_SERVE", "1");
Deno.env.set("DRAIN_NO_CHAIN", "1"); // no live self-chain fetch during the gate
const drain = await import("../drain-media-queue/index.ts");

interface QRow {
  ad_id: string;
  account_id: string;
  status: string;
  attempts: number;
  enqueued_at: string;
  updated_at: string;
  last_error: string | null;
}
interface CRow {
  ad_id: string;
  account_id: string;
  thumbnail_url: string | null;
  full_res_url: string | null;
  video_url: string | null;
  thumb_asset_id: string | null;
  video_asset_id: string | null;
}

/**
 * A faithful in-memory Supabase covering exactly the calls processQueuedAd /
 * drainOnce make: the claim RPC, media_cache_queue reads/updates, a creatives
 * select/update, media_assets select/upsert honoring UNIQUE(account_id,asset_key),
 * and the head/count pending check. storage.from().upload() records each stored
 * object path. Enforcing the dedupe uniqueness in the double is what makes the
 * "one stored copy per account" assertion meaningful.
 */
function makeWs2Db(opts: { queue: QRow[]; creatives: CRow[] }) {
  const queue = opts.queue;
  const creatives = opts.creatives;
  // key: `${account_id}:${asset_key}` → the single registered asset row.
  const assets = new Map<string, { id: string; public_url: string; storage_path: string }>();
  const storedObjects: string[] = []; // every storage upload path (image path)
  let assetSeq = 0;

  function creativesBuilder() {
    const filters: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    let updatePayload: any = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: string) => { filters[col] = val; return b; };
    // deno-lint-ignore no-explicit-any
    b.update = (p: any) => { updatePayload = p; return b; };
    b.maybeSingle = () =>
      Promise.resolve({ data: creatives.find((c) => c.ad_id === filters.ad_id) ?? null, error: null });
    // deno-lint-ignore no-explicit-any
    b.then = (resolve: (v: any) => void) => {
      if (updatePayload) {
        const row = creatives.find((c) => c.ad_id === filters.ad_id);
        if (row) Object.assign(row, updatePayload);
      }
      resolve({ data: null, error: null });
    };
    return b;
  }

  function queueBuilder() {
    const filters: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    let updatePayload: any = null;
    let headCount = false;
    const b: Record<string, unknown> = {};
    // deno-lint-ignore no-explicit-any
    b.select = (_c?: string, o?: any) => { if (o?.head) headCount = true; return b; };
    b.eq = (col: string, val: string) => { filters[col] = val; return b; };
    // deno-lint-ignore no-explicit-any
    b.update = (p: any) => { updatePayload = p; return b; };
    // deno-lint-ignore no-explicit-any
    const apply = (resolve: (v: any) => void) => {
      if (headCount) {
        const count = queue.filter((q) =>
          Object.entries(filters).every(([k, v]) => (q as unknown as Record<string, string>)[k] === v)
        ).length;
        resolve({ data: null, error: null, count });
        return;
      }
      if (updatePayload) {
        for (const q of queue) {
          if (Object.entries(filters).every(([k, v]) => (q as unknown as Record<string, string>)[k] === v)) {
            Object.assign(q, updatePayload);
          }
        }
      }
      resolve({ data: null, error: null });
    };
    // deno-lint-ignore no-explicit-any
    b.then = (resolve: (v: any) => void) => apply(resolve);
    return b;
  }

  function assetsBuilder() {
    const filters: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    let upsertPayload: any = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: string) => { filters[col] = val; return b; };
    // deno-lint-ignore no-explicit-any
    b.upsert = (p: any) => { upsertPayload = p; return b; };
    b.maybeSingle = () => {
      if (upsertPayload) {
        // Honor UNIQUE(account_id, asset_key): a re-upsert of the same key returns
        // the existing row (no new asset), which is exactly the dedupe invariant.
        const key = `${upsertPayload.account_id}:${upsertPayload.asset_key}`;
        const found = assets.get(key);
        if (found) return Promise.resolve({ data: { id: found.id, public_url: found.public_url }, error: null });
        const row = { id: `asset-${++assetSeq}`, public_url: upsertPayload.public_url, storage_path: upsertPayload.storage_path };
        assets.set(key, row);
        return Promise.resolve({ data: { id: row.id, public_url: row.public_url }, error: null });
      }
      const key = `${filters.account_id}:${filters.asset_key}`;
      const found = assets.get(key);
      return Promise.resolve({ data: found ? { id: found.id, public_url: found.public_url } : null, error: null });
    };
    return b;
  }

  const supabase = {
    // deno-lint-ignore no-explicit-any
    from: (table: string): any => {
      if (table === "creatives") return creativesBuilder();
      if (table === "media_cache_queue") return queueBuilder();
      if (table === "media_assets") return assetsBuilder();
      if (table === "settings") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { value: "fake" }, error: null }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // deno-lint-ignore no-explicit-any
    rpc: (name: string, args: any) => {
      if (name !== "claim_media_cache_queue") throw new Error(`unexpected rpc ${name}`);
      const limit = args.p_limit as number;
      // Only PENDING rows are claimable — a 'done' row is never re-claimed. This is
      // the queue-idempotency guarantee behind "no re-download on a second run".
      const claimable = queue
        .filter((q) => q.status === "pending")
        .sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))
        .slice(0, limit);
      for (const q of claimable) {
        q.status = "processing";
        q.attempts += 1;
        q.updated_at = new Date().toISOString();
      }
      return Promise.resolve({ data: claimable.map((q) => ({ ...q })), error: null });
    },
    storage: {
      from: () => ({
        // Image path: cacheImageToStorage uploads via storage.from().upload(path, bytes).
        // deno-lint-ignore no-explicit-any
        upload: (path: string, _bytes: unknown, _opts?: any) => {
          storedObjects.push(path);
          return Promise.resolve({ error: null });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/ad-thumbnails/${path}` } }),
      }),
    },
  };

  return { supabase, queue, creatives, assets, storedObjects };
}

// A distinct set of bytes per creative-content, so SHA-256 dedupe is exercised for
// real: two ads sharing CREATIVE_A get one asset; an ad with CREATIVE_B gets its own.
const CREATIVE_A = new TextEncoder().encode("us012-shared-creative-A-bytes");
const CREATIVE_B = new TextEncoder().encode("us012-distinct-creative-B-bytes");

/**
 * Fetch stub for the WS2 drain. Counts image downloads keyed by URL so we can prove
 * "cached media is never re-downloaded". Serves the image bytes mapped from the URL,
 * streams video bytes for the storage POST, and 200s the storage upload POST.
 */
function withWs2Fetch(
  imageBytesByUrl: Record<string, Uint8Array>,
  downloads: Record<string, number>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((input: unknown, _init?: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    // Storage streaming-upload POST (video path) — acknowledge, do not count as a download.
    if (url.includes("/storage/v1/object/")) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}"), headers: { get: () => null } });
    }
    // Image CDN download.
    if (imageBytesByUrl[url]) {
      downloads[url] = (downloads[url] ?? 0) + 1;
      const bytes = imageBytesByUrl[url];
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/jpeg" : null) },
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
        body: { cancel: () => Promise.resolve() },
      });
    }
    // Video CDN download (streamable body under the cap).
    if (url.startsWith("https://cdn/") || url.includes("fbcdn")) {
      downloads[url] = (downloads[url] ?? 0) + 1;
      let sent = false;
      const chunk = new Uint8Array(1024);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: (k: string) => {
            const key = k.toLowerCase();
            if (key === "content-type") return "video/mp4";
            if (key === "content-length") return String(120 * 1024 * 1024); // 120MB, under 200MB cap
            return null;
          },
        },
        body: {
          getReader: () => ({
            read: () => sent ? Promise.resolve({ done: true, value: undefined }) : (sent = true, Promise.resolve({ done: false, value: chunk })),
            cancel: () => Promise.resolve(),
          }),
          cancel: () => Promise.resolve(),
        },
      });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(""), headers: { get: () => null }, body: { cancel: () => Promise.resolve() } });
  }) as any;
  return run().finally(() => { globalThis.fetch = original; });
}

const nowIso = () => new Date().toISOString();
function enqueue(adId: string, accountId: string, seq: number): QRow {
  return {
    ad_id: adId,
    account_id: accountId,
    status: "pending",
    attempts: 0,
    enqueued_at: new Date(Date.now() + seq).toISOString(),
    updated_at: nowIso(),
    last_error: null,
  };
}

Deno.test("US-012: a NEW ad enqueued is cached exactly once; a second full drain re-touches nothing", async () => {
  const acct = "act_us012_a";
  const imgUrl = "https://cdn/img/new-ad.jpg";
  const queue = [enqueue("ad_new", acct, 0)];
  const creatives: CRow[] = [{
    ad_id: "ad_new",
    account_id: acct,
    thumbnail_url: imgUrl,               // has a CDN url → cache it (no live discovery)
    full_res_url: null,
    video_url: NO_VIDEO_SENTINEL_LOCAL,  // image-only ad → skip video path
    thumb_asset_id: null,
    video_asset_id: null,
  }];
  const { supabase, storedObjects } = makeWs2Db({ queue, creatives });
  const downloads: Record<string, number> = {};

  await withWs2Fetch({ [imgUrl]: CREATIVE_A }, downloads, async () => {
    const s1 = await drain.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(s1.claimed, 1, "the one new ad is claimed");
    assertEquals(s1.cached, 1, "…and cached exactly once");
  });

  assertEquals(downloads[imgUrl], 1, "the creative was downloaded exactly once");
  assertEquals(storedObjects.length, 1, "exactly one object stored for the new ad");
  assert(isStorageUrlLocal(creatives[0].thumbnail_url), "creative now points at a storage URL");
  assertEquals(queue[0].status, "done", "queue row marked done (no stuck 'processing')");

  // Second full drain: the row is done (not pending) and the media is a storage URL.
  // Nothing is re-claimed and nothing is re-downloaded.
  await withWs2Fetch({ [imgUrl]: CREATIVE_A }, downloads, async () => {
    const s2 = await drain.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(s2.claimed, 0, "no pending rows to re-claim on the second drain");
    assertEquals(s2.cached, 0);
  });
  assertEquals(downloads[imgUrl], 1, "NO re-download of the already-cached creative");
  assertEquals(storedObjects.length, 1, "no second stored object");
});

Deno.test("US-012: two ads reusing the same creative dedupe to ONE stored copy per account", async () => {
  const acct = "act_us012_dedupe";
  // Two ads, two different CDN urls, but the SAME underlying creative bytes.
  const urlA = "https://cdn/img/reused-1.jpg";
  const urlB = "https://cdn/img/reused-2.jpg";
  const queue = [enqueue("ad_a", acct, 0), enqueue("ad_b", acct, 1)];
  const creatives: CRow[] = [
    { ad_id: "ad_a", account_id: acct, thumbnail_url: urlA, full_res_url: null, video_url: NO_VIDEO_SENTINEL_LOCAL, thumb_asset_id: null, video_asset_id: null },
    { ad_id: "ad_b", account_id: acct, thumbnail_url: urlB, full_res_url: null, video_url: NO_VIDEO_SENTINEL_LOCAL, thumb_asset_id: null, video_asset_id: null },
  ];
  const { supabase, storedObjects, assets } = makeWs2Db({ queue, creatives });
  const downloads: Record<string, number> = {};

  await withWs2Fetch({ [urlA]: CREATIVE_A, [urlB]: CREATIVE_A }, downloads, async () => {
    const s = await drain.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(s.claimed, 2);
    assertEquals(s.cached, 2, "both ads processed");
  });

  // Both downloaded their bytes, but only ONE object is stored and ONE asset registered.
  assertEquals(storedObjects.length, 1, "identical creative bytes ⇒ one stored copy within the account");
  assertEquals([...assets.values()].length, 1, "one media_assets row for the shared creative");
  // Both creatives reference the shared asset id, and it is the same id.
  assert(creatives[0].thumb_asset_id, "ad_a references an asset");
  assertEquals(creatives[0].thumb_asset_id, creatives[1].thumb_asset_id, "both creatives share the same asset");
  assert(queue.every((q) => q.status === "done"), "both queue rows done");

  // Tenant boundary: the SAME bytes in a DIFFERENT account get their own copy.
  const acct2 = "act_us012_other";
  const urlC = "https://cdn/img/reused-3.jpg";
  const q2 = [enqueue("ad_c", acct2, 0)];
  const c2: CRow[] = [{ ad_id: "ad_c", account_id: acct2, thumbnail_url: urlC, full_res_url: null, video_url: NO_VIDEO_SENTINEL_LOCAL, thumb_asset_id: null, video_asset_id: null }];
  const db2 = makeWs2Db({ queue: q2, creatives: c2 });
  const dl2: Record<string, number> = {};
  await withWs2Fetch({ [urlC]: CREATIVE_A }, dl2, async () => {
    await drain.drainOnce(db2.supabase, "fake-token", 5, 120_000);
  });
  assertEquals(db2.storedObjects.length, 1, "same creative in a second account stores its OWN copy (no cross-tenant sharing)");
});

Deno.test("US-012: a creative already stored (storage URL) is short-circuited — never re-downloaded", async () => {
  const acct = "act_us012_cached";
  const cachedUrl = `https://example.supabase.co/storage/v1/object/public/ad-thumbnails/${acct}/assets/deadbeef.jpg`;
  const cachedVideo = `https://example.supabase.co/storage/v1/object/public/ad-videos/${acct}/ad_cached.mp4`;
  // The ad was somehow re-enqueued, but its media is already cached to storage.
  const queue = [enqueue("ad_cached", acct, 0)];
  const creatives: CRow[] = [{
    ad_id: "ad_cached",
    account_id: acct,
    thumbnail_url: cachedUrl,
    full_res_url: cachedUrl,
    video_url: cachedVideo,
    thumb_asset_id: "asset-existing",
    video_asset_id: "asset-existing-v",
  }];
  const { supabase, storedObjects } = makeWs2Db({ queue, creatives });
  const downloads: Record<string, number> = {};

  await withWs2Fetch({ [cachedUrl]: CREATIVE_A }, downloads, async () => {
    const s = await drain.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(s.claimed, 1);
    assertEquals(s.cached, 0, "nothing new cached — media already in storage");
    assertEquals(s.skipped, 1, "the ad is a no-op skip (isStorageUrl short-circuit)");
  });

  assertEquals(Object.keys(downloads).length, 0, "ZERO downloads for an already-cached ad");
  assertEquals(storedObjects.length, 0, "nothing re-stored");
  assertEquals(queue[0].status, "done", "the no-op ad is marked done, not left pending");
});

Deno.test("US-012: the queue drains a LARGE video to storage with no OOM and no stuck 'processing' row", async () => {
  const acct = "act_us012_video";
  const queue = [enqueue("ad_vid", acct, 0)];
  const creatives: CRow[] = [{
    ad_id: "ad_vid",
    account_id: acct,
    thumbnail_url: NO_THUMB_SENTINEL_LOCAL, // sentinel → skip image path
    full_res_url: null,
    video_url: "https://cdn/big/large.mp4", // 120MB streamed via the fetch stub
    thumb_asset_id: null,
    video_asset_id: null,
  }];
  const { supabase } = makeWs2Db({ queue, creatives });
  const downloads: Record<string, number> = {};

  await withWs2Fetch({}, downloads, async () => {
    const s = await drain.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(s.claimed, 1);
    assertEquals(s.cached, 1, "the large video streamed to storage");
    assertEquals(s.failed, 0, "no OOM / failure");
  });

  assert(isStorageUrlLocal(creatives[0].video_url), "video_url rewritten to a storage URL");
  assertEquals(queue[0].status, "done", "no row left stuck in 'processing' after the drain");
});

Deno.test("US-012: after a FULL drain of a mixed batch, no queue row remains in 'processing'", async () => {
  const acct = "act_us012_full";
  const imgUrl = "https://cdn/img/mixed.jpg";
  const queue = [
    enqueue("ad_i", acct, 0), // image
    enqueue("ad_v", acct, 1), // video
    enqueue("ad_x", acct, 2), // already cached (storage url) → skip
  ];
  const cachedUrl = `https://example.supabase.co/storage/v1/object/public/ad-thumbnails/${acct}/assets/x.jpg`;
  const creatives: CRow[] = [
    { ad_id: "ad_i", account_id: acct, thumbnail_url: imgUrl, full_res_url: null, video_url: NO_VIDEO_SENTINEL_LOCAL, thumb_asset_id: null, video_asset_id: null },
    { ad_id: "ad_v", account_id: acct, thumbnail_url: NO_THUMB_SENTINEL_LOCAL, full_res_url: null, video_url: "https://cdn/big/v.mp4", thumb_asset_id: null, video_asset_id: null },
    { ad_id: "ad_x", account_id: acct, thumbnail_url: cachedUrl, full_res_url: cachedUrl, video_url: NO_VIDEO_SENTINEL_LOCAL, thumb_asset_id: "a", video_asset_id: null },
  ];
  const { supabase } = makeWs2Db({ queue, creatives });
  const downloads: Record<string, number> = {};

  await withWs2Fetch({ [imgUrl]: CREATIVE_B }, downloads, async () => {
    const s = await drain.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(s.claimed, 3);
    assertEquals(s.failed, 0);
  });

  assert(!queue.some((q) => q.status === "processing"), "NO row left in 'processing' (no stuck-media log)");
  assert(queue.every((q) => q.status === "done"), "every claimed row terminal-done after a full drain");
});
