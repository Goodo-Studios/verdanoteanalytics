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

const TOKEN = "fake-meta-token";

Deno.test("runDiscovery does not filter on impressions but keeps the null-thumbnail skip-gate", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runDiscovery(supabase, null, TOKEN);
  assert(!hasImpressionsFilter(calls), "runDiscovery must not filter on impressions");
  assert(hasCall(calls, "is", "thumbnail_url"), "runDiscovery must keep .is(thumbnail_url, null) skip-gate");
});

Deno.test("runCaching does not filter on impressions but keeps the storage-path skip-gate", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runCaching(supabase, null);
  assert(!hasImpressionsFilter(calls), "runCaching must not filter on impressions");
  assert(hasCall(calls, "is", "thumbnail_storage_path"), "runCaching must keep .is(thumbnail_storage_path, null) skip-gate");
});

Deno.test("runVideoDiscovery does not filter on impressions but keeps the null-video skip-gate", async () => {
  const { supabase, calls } = makeRecorder();
  await mod.runVideoDiscovery(supabase, null, TOKEN);
  assert(!hasImpressionsFilter(calls), "runVideoDiscovery must not filter on impressions");
  assert(hasCall(calls, "is", "video_url"), "runVideoDiscovery must keep .is(video_url, null) skip-gate");
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
