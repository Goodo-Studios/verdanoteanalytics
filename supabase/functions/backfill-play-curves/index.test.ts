// Contract tests for backfill-play-curves (US-003).
//
// These drive handler() against a recording mock Supabase client and an injected
// Graph fetcher, plus exercise the exported pure helpers. They assert the story's
// load-bearing guarantees WITHOUT a live runtime / Meta creds (live E2E is US-006):
//
//   1. EXTRACTION reuses parsePlayCurve: a real Meta `video_play_curve_actions`
//      array (fractions [0,1]) yields a true-percentage curve + quartiles, and
//      non-video / malformed rows yield NO write (never a null curve).
//   2. IDEMPOTENCY GATE: the creatives selection filters play_curve IS NULL +
//      video_views > 0 + a 90-day updated_at window — already-backfilled and
//      non-video rows are excluded, so re-runs are cheap.
//   3. GATE SCOPING: Graph rows for ad_ids NOT in the gate are ignored.
//   4. PERSISTENCE: writes go through bulk_update_creative_metrics, never a raw
//      creatives.update of curve columns.
//   5. PACING: the per-invocation budget is bounded and the response reports
//      { drained }; rate-limit backoff is bounded + exponential and matches the
//      sync's error-#4 detection (30/60/120/240/300s, capped).
//   6. dry_run performs no RPC write.
//
//   deno test -A supabase/functions/backfill-play-curves/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BACKFILL_PLAY_CURVES_NO_SERVE", "1");
// Module reads these at load with `!`; values are irrelevant — a mock client and
// injected fetcher are passed into handler(), so no real network/db call happens.
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");

import type { MetaFetcher } from "./index.ts";
const mod = await import("./index.ts");

// ── Mock Supabase: records every call; gate query returns a fixed page once,
// then empty (so paging terminates). RPC calls are captured for assertions.

interface Call {
  method: string;
  args: unknown[];
}

interface RpcCall {
  fn: string;
  // deno-lint-ignore no-explicit-any
  payload: any;
}

// `gateRows` is the set of creatives the NULL-play_curve gate should return.
function makeRecorder(gateRows: Array<{ ad_id: string }>, accounts: Array<{ id: string }>) {
  const calls: Call[] = [];
  const rpcCalls: RpcCall[] = [];

  // Per-builder mutable state so we can vary the resolved result by table.
  function builderFor(table: string) {
    const state: { table: string; isNullPlayCurve: boolean; rangeOffset: number } = {
      table,
      isNullPlayCurve: false,
      rangeOffset: 0,
    };
    const builder: Record<string, unknown> = {};
    const chain = ["select", "eq", "is", "gt", "gte", "lte", "in", "order", "update", "insert"];
    for (const m of chain) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        if (m === "is" && args[0] === "play_curve" && args[1] === null) state.isNullPlayCurve = true;
        return builder;
      };
    }
    builder.range = (from: number, _to: number) => {
      calls.push({ method: "range", args: [from, _to] });
      // Gate query: return all rows on the first page, empty after.
      if (state.table === "creatives" && state.isNullPlayCurve) {
        const data = from === 0 ? gateRows : [];
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    };
    builder.single = () => {
      calls.push({ method: "single", args: [] });
      return Promise.resolve({ data: null, error: null });
    };
    // Awaiting the builder (terminal-less) — e.g. ad_accounts select.
    builder.then = (resolve: (v: unknown) => void) => {
      if (state.table === "ad_accounts") return resolve({ data: accounts, error: null });
      return resolve({ data: [], error: null });
    };
    return builder;
  }

  const supabase = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return builderFor(table);
    },
    // deno-lint-ignore no-explicit-any
    rpc: (fn: string, params: any) => {
      rpcCalls.push({ fn, payload: params?.payload });
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { supabase, calls, rpcCalls };
}

// A genuine Meta video_play_curve_actions sample: fractions in [0,1], 30 buckets.
const REAL_CURVE = ["1", "0.9", "0.8", "0.7", "0.6", "0.55", "0.5", "0.45", "0.4", "0.38",
  "0.36", "0.34", "0.32", "0.3", "0.28", "0.26", "0.24", "0.22", "0.2", "0.18",
  "0.16", "0.15", "0.14", "0.13", "0.12", "0.11", "0.1", "0.09", "0.08", "0.07"];

function fetcherReturning(rows: unknown[]): MetaFetcher {
  let served = false;
  return () => {
    const data = served ? [] : rows;
    served = true;
    return Promise.resolve({ data, next: null, error: null, rateLimited: false });
  };
}

async function run(
  gateRows: Array<{ ad_id: string }>,
  metaRows: unknown[],
  opts: { dryRun?: boolean } = {},
) {
  const { supabase, calls, rpcCalls } = makeRecorder(gateRows, [{ id: "act_1" }]);
  const req = new Request("https://fn.local/backfill-play-curves", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.dryRun ? { dry_run: true } : {}),
  });
  const res = await mod.handler(req, supabase, fetcherReturning(metaRows));
  const body = await res.json();
  return { body, calls, rpcCalls };
}

// ── 1. Extraction reuses parsePlayCurve (fractions → true percentages + quartiles).

Deno.test("buildMetricsPayload normalizes a real curve to percentages with quartiles", () => {
  const gate = new Set(["ad_a"]);
  const payload = mod.buildMetricsPayload(
    [{ ad_id: "ad_a", video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }] }],
    gate,
  );
  assertEquals(payload.length, 1);
  const p = payload[0];
  assertEquals(p.ad_id, "ad_a");
  // First bucket is 100% (fraction 1 → 100), last is ~7% (IEEE754: 0.07*100).
  assertEquals(p.play_curve[0], 100);
  assert(Math.abs(p.play_curve[p.play_curve.length - 1] - 7) < 1e-9, "last bucket ≈ 7%");
  // p100 is the completion (final) value; p25/50/75 are present + descending.
  assert(Math.abs(p.retention_p100! - 7) < 1e-9, "p100 ≈ 7%");
  assert(p.retention_p25! > p.retention_p50!, "p25 must exceed p50");
  assert(p.retention_p50! > p.retention_p75!, "p50 must exceed p75");
});

Deno.test("buildMetricsPayload drops non-video / malformed rows (never writes a null curve)", () => {
  const gate = new Set(["ad_a", "ad_b", "ad_c"]);
  const payload = mod.buildMetricsPayload(
    [
      { ad_id: "ad_a", video_play_curve_actions: null }, // non-video
      { ad_id: "ad_b", video_play_curve_actions: [{ action_type: "video_view", value: ["1", "x"] }] }, // malformed
      { ad_id: "ad_c", video_play_curve_actions: [] }, // empty
    ],
    gate,
  );
  assertEquals(payload.length, 0);
});

// ── 3. Gate scoping: Graph rows for un-gated ad_ids are ignored.

Deno.test("buildMetricsPayload ignores Graph rows not in the NULL-play_curve gate", () => {
  const gate = new Set(["ad_gated"]);
  const payload = mod.buildMetricsPayload(
    [
      { ad_id: "ad_other", video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }] },
      { ad_id: "ad_gated", video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }] },
    ],
    gate,
  );
  assertEquals(payload.length, 1);
  assertEquals(payload[0].ad_id, "ad_gated");
});

// ── 5. Pacing helpers: bounded exponential backoff + sync-matching error detection.

Deno.test("backoffMs is exponential and capped at 5 minutes (matches sync formula)", () => {
  // 30·2^(n-1) seconds, capped at 300s — identical to the sync's metaFetch.
  assertEquals(mod.backoffMs(1), 30_000);
  assertEquals(mod.backoffMs(2), 60_000);
  assertEquals(mod.backoffMs(3), 120_000);
  assertEquals(mod.backoffMs(4), 240_000);
  assertEquals(mod.backoffMs(5), 300_000); // 480s → capped to 300s
  assertEquals(mod.backoffMs(99), 300_000); // capped
});

Deno.test("isRateLimitError matches Graph error #4 and the sync's throttle codes", () => {
  assert(mod.isRateLimitError({ code: 4 }), "app-wide rate limit #4");
  assert(mod.isRateLimitError({ code: 17 }));
  assert(mod.isRateLimitError({ code: 32 }));
  assert(mod.isRateLimitError({ code: 80004 }));
  assert(mod.isRateLimitError({ error_subcode: 2446079 }));
  assert(mod.isRateLimitError({ message: "User request limit reached" }));
  assert(!mod.isRateLimitError({ code: 100 }), "a non-throttle code is not rate-limited");
  assert(!mod.isRateLimitError(null));
});

Deno.test("insightsUrl requests only ad_id + the curve field over the 90-day window", () => {
  const url = mod.insightsUrl("act_1", new Date("2026-05-30T00:00:00Z"), "tok");
  assert(url.includes("/act_1/insights"), "scoped to the account");
  assert(url.includes("fields=ad_id%2Cvideo_play_curve_actions") || url.includes("fields=ad_id,video_play_curve_actions"));
  assert(url.includes("level=ad"));
  // 90 days before 2026-05-30 is 2026-03-01.
  assert(decodeURIComponent(url).includes('"since":"2026-03-01"'), "time_range.since is 90d back");
});

Deno.test("sinceDate / lookbackTimestamp compute the 90-day window", () => {
  const now = new Date("2026-05-30T12:00:00Z");
  assertEquals(mod.sinceDate(now, 90), "2026-03-01");
  assert(mod.lookbackTimestamp(now, 90).startsWith("2026-03-01"));
});

// ── End-to-end through handler() with the mock client + injected fetcher.

Deno.test("handler gates on play_curve IS NULL + video_views + 90-day updated_at", async () => {
  const { calls } = await run([{ ad_id: "ad_a" }], []);
  const isNull = calls.some((c) => c.method === "is" && c.args[0] === "play_curve" && c.args[1] === null);
  const vv = calls.some((c) => c.method === "gt" && c.args[0] === "video_views");
  const recent = calls.some((c) => c.method === "gte" && c.args[0] === "updated_at");
  assert(isNull, "must filter play_curve IS NULL (skip already-backfilled)");
  assert(vv, "must filter video_views > 0 (video creatives only)");
  assert(recent, "must filter updated_at within the lookback window");
});

Deno.test("handler persists curves via bulk_update_creative_metrics, not a raw update", async () => {
  const { rpcCalls, calls } = await run(
    [{ ad_id: "ad_a" }],
    [{ ad_id: "ad_a", video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }] }],
  );
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, "bulk_update_creative_metrics");
  assertEquals(rpcCalls[0].payload[0].ad_id, "ad_a");
  assert(Array.isArray(rpcCalls[0].payload[0].play_curve), "payload carries the curve array");
  // No raw creatives.update of curve columns.
  const rawUpdate = calls.some((c) => c.method === "update");
  assert(!rawUpdate, "must not write curve columns via a raw creatives.update");
});

Deno.test("handler reports success + drained + per-account totals", async () => {
  const { body } = await run(
    [{ ad_id: "ad_a" }],
    [{ ad_id: "ad_a", video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }] }],
  );
  assertEquals(body.success, true);
  assertEquals(body.drained, true);
  assertEquals(body.accounts_processed, 1);
  assertEquals(body.totals.gated, 1);
  assertEquals(body.totals.updated, 1);
});

Deno.test("dry_run performs no RPC write but still counts would-updates", async () => {
  const { rpcCalls, body } = await run(
    [{ ad_id: "ad_a" }],
    [{ ad_id: "ad_a", video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }] }],
    { dryRun: true },
  );
  assertEquals(rpcCalls.length, 0, "dry_run must not call the RPC");
  assertEquals(body.dry_run, true);
  assertEquals(body.totals.updated, 1, "dry_run still reports the would-update count");
});

Deno.test("handler skips an account whose gate is empty (cheap re-run)", async () => {
  const { rpcCalls, body } = await run([], [
    { ad_id: "ad_a", video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }] },
  ]);
  assertEquals(rpcCalls.length, 0, "no gated rows → no Graph write");
  assertEquals(body.totals.gated, 0);
  assertEquals(body.totals.updated, 0);
});

Deno.test("handler ignores a non-client second arg (serve passes connInfo)", async () => {
  const connInfoLike = { remoteAddr: { hostname: "127.0.0.1", port: 12345 } };
  const req = new Request("https://fn.local/backfill-play-curves", { method: "POST", body: "{}" });
  // With no mock client it falls through to createClient on the fake URL — the
  // point is only that it does NOT crash treating connInfo as a client.
  const res = await (mod.handler as (r: Request, o?: unknown) => Promise<Response>)(req, connInfoLike);
  const body = await res.text();
  assert(!body.includes("supabase.from is not a function"), "connInfo must not be treated as a client");
});
