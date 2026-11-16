// Audit plan items 5.3 and 8.2 (shipped together, as the plan requires).
//
// 5.3: a failed write must not move the watermark. The backfill counted a failed
//      daily-metrics upsert as an error but still moved daily_backfilled_since past
//      the chunk, so those days were never fetched again. A failed creative insert
//      silently dropped that ad's rows without counting anything.
// 8.2: the backfill chained another run after ANY unfinished run (errors and
//      rate-limit pauses included) with no depth limit, and the 20-minute cron
//      started new chains while one was already running.
//
//   deno test -A supabase/functions/backfill-daily-history/writes-and-chaining.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");
Deno.env.set("BACKFILL_BACKOFF_BASE_SEC", "0");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");

import type { MetaFetcher } from "./index.ts";
const mod = await import("./index.ts");

interface Opts {
  existingAdIds?: string[];
  failDailyUpsert?: boolean;
  failCreativeInsert?: boolean;
  claimResult?: boolean;
}

function makeDb(accounts: Array<Record<string, unknown>>, opts: Opts = {}) {
  const watermarks: unknown[] = [];
  const rpcs: string[] = [];
  const dailyUpserts: unknown[][] = [];

  function builderFor(table: string) {
    let patch: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gt", "gte", "lte", "in", "order", "limit", "or"]) {
      b[m] = () => b;
    }
    b.update = (p: Record<string, unknown>) => {
      patch = p;
      return b;
    };
    b.upsert = (rows: unknown[]) => {
      if (table === "creative_daily_metrics") {
        if (opts.failDailyUpsert) return Promise.resolve({ data: null, error: { message: "write failed" } });
        dailyUpserts.push(rows);
      }
      if (table === "creatives" && opts.failCreativeInsert) {
        return Promise.resolve({ data: null, error: { message: "insert failed" } });
      }
      return Promise.resolve({ data: null, error: null });
    };
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (resolve: (v: unknown) => void) => {
      if (patch && table === "ad_accounts") {
        if ("daily_backfilled_since" in patch) watermarks.push(patch.daily_backfilled_since);
        return resolve({ data: null, error: null });
      }
      if (table === "ad_accounts") return resolve({ data: accounts, error: null });
      if (table === "creatives") {
        return resolve({ data: (opts.existingAdIds ?? []).map((ad_id) => ({ ad_id })), error: null });
      }
      return resolve({ data: [], error: null });
    };
    return b;
  }

  const supabase = {
    from: (table: string) => builderFor(table),
    rpc: (name: string) => {
      rpcs.push(name);
      if (name.startsWith("claim_")) return Promise.resolve({ data: opts.claimResult ?? true, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { supabase, watermarks, rpcs, dailyUpserts };
}

function row(ad_id: string, date: string) {
  return { ad_id, date_start: date, spend: "5", impressions: "100", clicks: "1" };
}

function req(body: unknown = {}) {
  return new Request("https://fn.local/backfill-daily-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const onePagePerChunk = (rows: unknown[]): MetaFetcher => {
  const served = new Set<string>();
  return (url: string) => {
    const key = url.split("&access_token=")[0];
    if (served.has(key)) return Promise.resolve({ data: [], next: null, error: null, rateLimited: false });
    served.add(key);
    return Promise.resolve({ data: rows, next: null, error: null, rateLimited: false });
  };
};

const ACCOUNT = { id: "act_1", name: "A", click_window: 7, view_window: 1, daily_backfilled_since: "2026-06-30" };
const NOW = new Date("2026-07-01T12:00:00Z");

// ── 5.3: failed writes never move the watermark ─────────────────────────────

Deno.test("a failed daily-metrics write keeps the watermark and counts the dropped rows", async () => {
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"], failDailyUpsert: true });
  const res = await mod.handler(
    req({ account_id: "act_1" }), db.supabase,
    onePagePerChunk([row("ad_a", "2026-06-20"), row("ad_a", "2026-06-21")]), NOW,
  );
  const body = await res.json();

  assertEquals(db.watermarks, [], "the watermark must not move past days that failed to save");
  assertEquals(body.per_account.act_1.watermark, "2026-06-30");
  assert(body.totals.errors >= 1);
  assertEquals(body.per_account.act_1.dropped_rows, 2);
});

Deno.test("a failed creative insert counts that ad's rows as dropped and keeps the watermark", async () => {
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"], failCreativeInsert: true });
  const res = await mod.handler(
    req({ account_id: "act_1" }), db.supabase,
    onePagePerChunk([row("ad_a", "2026-06-20"), row("ad_new", "2026-06-20"), row("ad_new", "2026-06-21")]), NOW,
  );
  const body = await res.json();

  assertEquals(db.watermarks, [], "rows for the ad that could not be created were not saved");
  assert(body.totals.errors >= 1, "the failed insert is counted");
  assertEquals(body.per_account.act_1.dropped_rows, 2);
});

Deno.test("a clean chunk still moves the watermark", async () => {
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"] });
  await mod.handler(req({ account_id: "act_1" }), db.supabase, onePagePerChunk([row("ad_a", "2026-06-20")]), NOW);
  assert(db.watermarks.length > 0);
  assertEquals(db.watermarks[0], "2026-06-15");
});

// ── 8.2: bounded, single-flight chaining ─────────────────────────────────────

Deno.test("an error stops the chain instead of retrying immediately", async () => {
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"], failDailyUpsert: true });
  const res = await mod.handler(req({ account_id: "act_1" }), db.supabase, onePagePerChunk([row("ad_a", "2026-06-20")]), NOW);
  const body = await res.json();
  assertEquals(body.chained, false);
  assertEquals(body.chain_stop_reason, "error");
});

Deno.test("a rate-limit pause is left for the next cron run, not chained", async () => {
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"] });
  const paused: MetaFetcher = () =>
    Promise.resolve({ data: null, next: null, error: { code: 4, message: "Application request limit reached" }, rateLimited: true });
  const res = await mod.handler(req({ account_id: "act_1" }), db.supabase, paused, NOW);
  const body = await res.json();
  assertEquals(body.drained, false);
  assertEquals(body.chained, false);
  assertEquals(body.chain_stop_reason, "rate_limited");
});

Deno.test("chainDecision only continues a run that ran out of time, up to MAX_CHAIN links", () => {
  const base = { dryRun: false, timedOut: true, errors: 0, paused: false, chain: 0 };
  assertEquals(mod.chainDecision(base), { chain: true, reason: null });
  assertEquals(mod.chainDecision({ ...base, timedOut: false }).chain, false);
  assertEquals(mod.chainDecision({ ...base, errors: 1 }), { chain: false, reason: "error" });
  assertEquals(mod.chainDecision({ ...base, paused: true }), { chain: false, reason: "rate_limited" });
  assertEquals(mod.chainDecision({ ...base, dryRun: true }).chain, false);
  assertEquals(mod.chainDecision({ ...base, chain: mod.MAX_CHAIN }), { chain: false, reason: "max_chain" });
  assertEquals(mod.chainDecision({ ...base, chain: mod.MAX_CHAIN - 1 }).chain, true);
});

Deno.test("a cron poke skips when another backfill run holds the single-flight lock", async () => {
  let fetches = 0;
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"], claimResult: false });
  const res = await mod.handler(req({}), db.supabase, () => {
    fetches++;
    return Promise.resolve({ data: [], next: null, error: null, rateLimited: false });
  }, NOW);
  const body = await res.json();
  assertEquals(body.skipped, "singleflight-active");
  assertEquals(fetches, 0);
  assert(db.rpcs.includes("claim_backfill_history_singleflight"));
});

Deno.test("a cron poke that claims the lock releases it when it does not chain", async () => {
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"] });
  await mod.handler(req({}), db.supabase, onePagePerChunk([row("ad_a", "2026-06-20")]), NOW);
  assert(db.rpcs.includes("claim_backfill_history_singleflight"));
  assert(db.rpcs.includes("release_backfill_history_singleflight"));
});

Deno.test("a chained continuation does not claim the lock again", async () => {
  const db = makeDb([ACCOUNT], { existingAdIds: ["ad_a"] });
  await mod.handler(req({ chain: 3 }), db.supabase, onePagePerChunk([row("ad_a", "2026-06-20")]), NOW);
  assert(!db.rpcs.includes("claim_backfill_history_singleflight"));
  assert(db.rpcs.includes("release_backfill_history_singleflight"), "the last link releases the flight");
});
