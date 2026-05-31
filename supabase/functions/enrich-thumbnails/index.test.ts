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
