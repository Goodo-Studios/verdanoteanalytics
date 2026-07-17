// US-005 tests for the self-healing media refresh poller (refresh-media-queue).
//
// Proves the acceptance criteria WITHOUT any live network / DB call:
//   * refreshOnce calls the enqueue_media_refresh_candidates feeder and reports the
//     count; it pokes drain-media-queue ONLY when something was enqueued.
//   * the handler self-chains a fresh invocation while the feeder fills full batches
//     (bounded by MAX_REFRESH_CHAIN) and does NOT chain at the tail of the backlog.
//   * a coverage regression (latest_coverage_regression → regressed) fires a Slack alert;
//     no regression fires nothing.
//
// Run: REFRESH_MEDIA_QUEUE_NO_SERVE is set before import so serve() never binds.
//   deno test -A supabase/functions/refresh-media-queue/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("REFRESH_MEDIA_QUEUE_NO_SERVE", "1");
Deno.env.set("REFRESH_NO_CHAIN", "1"); // default: no live drain-poke / self-chain fetch
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.delete("SLACK_WEBHOOK_URL"); // default: alerting off unless a test sets it

const mod = await import("./index.ts");

// ── Test double ────────────────────────────────────────────────────────────
// A minimal Supabase stand-in covering exactly the rpc() calls refreshOnce makes:
// enqueue_media_refresh_candidates (returns a count) and latest_coverage_regression
// (returns a single-row table). Records the calls for assertions.
function makeDb(opts: {
  enqueued: number;
  regression?: Record<string, unknown> | null;
}) {
  const calls: Record<string, unknown[]> = {};
  const supabase = {
    // deno-lint-ignore no-explicit-any
    rpc: (name: string, args: any) => {
      (calls[name] ||= []).push(args);
      if (name === "enqueue_media_refresh_candidates") {
        return Promise.resolve({ data: opts.enqueued, error: null });
      }
      if (name === "latest_coverage_regression") {
        return Promise.resolve({ data: opts.regression ? [opts.regression] : [], error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    // present so the isClient() guard accepts the override
    from: () => {
      throw new Error("refresh-media-queue must not touch tables directly");
    },
  };
  return { supabase, calls };
}

// ── Global fetch stub ──────────────────────────────────────────────────────
type Responder = (url: string, init?: RequestInit) => Response;
const realFetch = globalThis.fetch;
function withFetch(responder: Responder, fn: () => Promise<void>) {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(responder(url, init));
  };
  return fn().finally(() => {
    globalThis.fetch = realFetch;
  });
}

// ── refreshOnce ──────────────────────────────────────────────────────────────

Deno.test("refreshOnce calls the feeder and reports the enqueued count", async () => {
  const { supabase, calls } = makeDb({ enqueued: 42 });
  const summary = await mod.refreshOnce(supabase);
  assertEquals(summary.enqueued, 42);
  assertEquals(calls["enqueue_media_refresh_candidates"].length, 1);
  // No SLACK_WEBHOOK_URL → no alert attempt.
  assertEquals(summary.regressionAlerted, false);
});

Deno.test("refreshOnce does NOT poke drain-media-queue (decoupled — drain runs on its own guarded cadence)", async () => {
  // The feeder used to fire-and-forget a drain poke here; that stacked on top of the
  // drain's own cron + self-chain and the overlapping workers throttled Meta on
  // re-enable. The feeder now only fills the queue; the drain drains it single-flight.
  const { supabase } = makeDb({ enqueued: 5 });
  Deno.env.delete("REFRESH_NO_CHAIN");
  let drainPoked = false;
  try {
    await withFetch((url) => {
      if (url.includes("/functions/v1/drain-media-queue")) drainPoked = true;
      return new Response("{}", { status: 200 });
    }, async () => {
      const summary = await mod.refreshOnce(supabase);
      assertEquals(summary.drainPoked, false);
    });
  } finally {
    Deno.env.set("REFRESH_NO_CHAIN", "1");
  }
  assert(!drainPoked, "feeder must NOT poke the drain — decoupled so only one bounded drain chain runs at a time");
});

Deno.test("refreshOnce does NOT poke the drain when nothing was enqueued (no-op poll)", async () => {
  const { supabase } = makeDb({ enqueued: 0 });
  const summary = await mod.refreshOnce(supabase);
  assertEquals(summary.enqueued, 0);
  assertEquals(summary.drainPoked, false);
});

Deno.test("refreshOnce fires a Slack alert on a coverage regression, and none without one", async () => {
  Deno.env.set("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
  try {
    // Regression present → alert.
    {
      const { supabase } = makeDb({
        enqueued: 0,
        regression: {
          regressed: true,
          prev_pct: 98.5,
          curr_pct: 95.0,
          delta_pct: -3.5,
          prev_captured_at: "t0",
          curr_captured_at: "t1",
        },
      });
      let posted = false;
      await withFetch((url) => {
        if (url.includes("hooks.slack.test")) posted = true;
        return new Response("{}", { status: 200 });
      }, async () => {
        const summary = await mod.refreshOnce(supabase);
        assertEquals(summary.regressionAlerted, true);
      });
      assert(posted, "a coverage regression must POST to the Slack webhook");
    }
    // No regression → no alert.
    {
      const { supabase } = makeDb({
        enqueued: 0,
        regression: { regressed: false, prev_pct: 98.5, curr_pct: 98.5, delta_pct: 0, prev_captured_at: "t0", curr_captured_at: "t1" },
      });
      let posted = false;
      await withFetch((url) => {
        if (url.includes("hooks.slack.test")) posted = true;
        return new Response("{}", { status: 200 });
      }, async () => {
        const summary = await mod.refreshOnce(supabase);
        assertEquals(summary.regressionAlerted, false);
      });
      assert(!posted, "no Slack post when coverage did not regress");
    }
  } finally {
    Deno.env.delete("SLACK_WEBHOOK_URL");
  }
});

// ── handler self-chain ───────────────────────────────────────────────────────

Deno.test("handler self-chains while the feeder fills full batches (large account)", async () => {
  // A full batch (BATCH_LIMIT=100) enqueued at chain depth 0 → chain a fresh invocation.
  const { supabase } = makeDb({ enqueued: 100 });
  Deno.env.delete("REFRESH_NO_CHAIN");
  let chainFired = false;
  try {
    await withFetch((url) => {
      if (url.includes("/functions/v1/refresh-media-queue")) chainFired = true;
      return new Response("{}", { status: 200 });
    }, async () => {
      const req = new Request("https://example.supabase.co/functions/v1/refresh-media-queue?chain=0", {
        method: "POST",
        body: "{}",
      });
      const resp = await mod.handler(req, supabase);
      const json = await resp.json();
      assertEquals(json.status, "completed");
      assertEquals(json.enqueued, 100);
      assertEquals(json.chained, true);
    });
  } finally {
    Deno.env.set("REFRESH_NO_CHAIN", "1");
  }
  assert(chainFired, "handler must self-chain a fresh invocation while full batches remain");
});

Deno.test("handler does NOT self-chain at the tail of the backlog (partial batch)", async () => {
  // Fewer than a full batch → reached the tail; stop (no fanout, no runaway chain).
  const { supabase } = makeDb({ enqueued: 3 });
  Deno.env.delete("REFRESH_NO_CHAIN");
  let chainFired = false;
  try {
    await withFetch((url) => {
      if (url.includes("/functions/v1/refresh-media-queue")) chainFired = true;
      return new Response("{}", { status: 200 });
    }, async () => {
      const req = new Request("https://example.supabase.co/functions/v1/refresh-media-queue?chain=0", {
        method: "POST",
        body: "{}",
      });
      const resp = await mod.handler(req, supabase);
      const json = await resp.json();
      assertEquals(json.chained, false);
    });
  } finally {
    Deno.env.set("REFRESH_NO_CHAIN", "1");
  }
  assert(!chainFired, "no self-chain once the feeder returns a partial batch");
});
