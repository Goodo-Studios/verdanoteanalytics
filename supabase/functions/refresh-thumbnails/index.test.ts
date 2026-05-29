// Regression test for the refresh-thumbnails (cron auto-rotation) self-healing behavior.
//
// Two bugs this guards against:
//   1. The "impressions > 0" gate — every media-selection query filtered `.gt("impressions", 0)`,
//      so creatives with 0/null impressions were never given a thumbnail or video, yet they
//      still render in the library as permanently-broken cards. (Same bug fixed in
//      enrich-thumbnails; refresh-thumbnails is the cron loop that re-runs forever, so the
//      gate here made the breakage self-perpetuating.)
//   2. No retry/backoff — sentinels (`no-thumbnail` / `no-video`) were only re-attempted on a
//      first sync or after a 7-day window above hard spend thresholds, so a transient failure
//      became permanent. The fix gates the sentinel slow-path on `*_retry_after`.
//
// This drives handler() against a recording mock Supabase client (empty result sets, so the
// phases short-circuit before any Meta/network call) and asserts:
//   - NO selection query filters on `impressions`
//   - the thumbnail + video slow-path queries carry a retry-backoff gate (`*_retry_after`)
//   - the per-account scoping is still applied
//
// REFRESH_NO_SERVE is set before import so the module-level serve() never binds a port.
//   deno test -A supabase/functions/refresh-thumbnails/index.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("REFRESH_NO_SERVE", "1");
// Module reads these at load with `!`; values are irrelevant because we inject a mock client
// and the empty result sets stop execution before any Meta call.
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

interface Call {
  method: string;
  args: unknown[];
}

/**
 * Chainable Supabase query-builder stand-in. Every filter/modifier records its call and
 * returns `this`. Terminal `.limit()` and awaiting the builder resolve to an empty data set
 * (so each phase returns before touching Meta/storage). `.single()` resolves to `{id:1}` so
 * pickAccount finds the requested account and the progress-log insert gets an id.
 */
function makeRecorder() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "from", "select", "is", "eq", "neq", "not", "or", "gt", "lt",
    "like", "order", "update", "insert", "in",
  ];
  for (const m of chainMethods) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: "limit", args });
    return Promise.resolve({ data: [], error: null });
  };
  builder.single = (...args: unknown[]) => {
    calls.push({ method: "single", args });
    return Promise.resolve({ data: { id: 1, name: "act_test" }, error: null });
  };
  // Awaiting the builder directly (no terminal) also yields empty data.
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

function hasOrContaining(calls: Call[], needle: string): boolean {
  return calls.some(
    (c) => c.method === "or" && typeof c.args[0] === "string" && (c.args[0] as string).includes(needle),
  );
}

function hasCall(calls: Call[], method: string, arg0: unknown): boolean {
  return calls.some((c) => c.method === method && c.args[0] === arg0);
}

async function runHandler() {
  const { supabase, calls } = makeRecorder();
  // account_id in the query string → pickAccount takes the single-account path.
  const req = new Request("https://fn.local/refresh-thumbnails?account_id=act_test");
  const res = await mod.handler(req, supabase);
  // Drain the body so the response is fully realized.
  await res.text();
  return calls;
}

Deno.test("refresh-thumbnails issues no impressions filter on any selection query", async () => {
  const calls = await runHandler();
  assert(!hasImpressionsFilter(calls), "refresh-thumbnails must not filter on impressions");
});

Deno.test("thumbnail slow path is gated by a retry-backoff window, not a threshold", async () => {
  const calls = await runHandler();
  assert(
    hasOrContaining(calls, "thumb_retry_after"),
    "thumbnail slow-path query must carry a thumb_retry_after backoff gate",
  );
});

Deno.test("video discovery is gated by a retry-backoff window", async () => {
  const calls = await runHandler();
  assert(
    hasOrContaining(calls, "video_retry_after"),
    "video discovery query must carry a video_retry_after backoff gate",
  );
});

Deno.test("per-account scoping is still applied", async () => {
  const calls = await runHandler();
  assert(hasCall(calls, "eq", "account_id"), "selection queries must still scope by account_id");
});

Deno.test("handler ignores a non-client second arg (serve passes connInfo, not an override)", async () => {
  // Regression: Deno's serve() calls handler(req, connInfo). The connInfo object
  // is truthy but has no `.from`, so `supabaseOverride ?? createClient(...)` used to
  // return it and blow up with "supabase.from is not a function". The handler must
  // detect a non-client arg and fall back to createClient (which fails later on the
  // fake URL/key — but NOT with the connInfo TypeError).
  const connInfoLike = { remoteAddr: { hostname: "127.0.0.1", port: 12345 } };
  const req = new Request("https://fn.local/refresh-thumbnails?account_id=act_test");
  const res = await (mod.handler as (r: Request, o?: unknown) => Promise<Response>)(req, connInfoLike);
  const body = await res.text();
  assert(
    !body.includes("supabase.from is not a function"),
    "handler must not treat connInfo as a supabase client",
  );
});

Deno.test("nextRetryAfter implements bounded exponential backoff", () => {
  const t1 = new Date(mod.nextRetryAfter(1)).getTime();
  const t2 = new Date(mod.nextRetryAfter(2)).getTime();
  const now = Date.now();
  // First retry ~1h out, second ~4h out, and each is strictly in the future and increasing.
  assert(t1 > now, "first retry must be in the future");
  assert(t2 > t1, "backoff must increase with retry count");
  // Cap: a very high count should not exceed the 7-day ceiling.
  const tCap = new Date(mod.nextRetryAfter(999)).getTime();
  assert(tCap - now <= 7 * 24 * 60 * 60 * 1000 + 60_000, "backoff must cap at 7 days");
});
