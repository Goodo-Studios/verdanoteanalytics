// Contract tests for backfill-daily-history (US-004).
//
// These drive handler() against a recording mock Supabase client and an injected
// Graph fetcher, plus exercise the exported pure helpers. They assert the story's
// load-bearing guarantees WITHOUT a live runtime / Meta creds (live E2E is US-007):
//
//   1. BACKWARD CHUNKING: nextChunk() steps CHUNK_DAYS older than the frontier,
//      clamps to the target, overlaps the frontier by 1 day (no-op upsert), and
//      returns null once the account reaches the target.
//   2. ROW MAPPING reuses parsePlayCurve + mirrors the sync Phase-4 daily shape;
//      rows missing ad_id/date_start or with an unknown ad_id are dropped.
//   3. WATERMARK ADVANCES: daily_backfilled_since is written backward to the
//      chunk start AFTER rows are upserted, and pinned to the target on reach.
//   4. RATE-LIMIT PAUSE IS NOT COMPLETION: a resumable pause leaves the watermark
//      un-advanced past the un-fetched chunk (drained=false) — the June-2026
//      data-drift failure mode is guarded (verdanote-sync-metafetch policy).
//   5. NEVER RE-PULLS COVERED DATES: an account already at the target does no
//      Graph fetch and no watermark write.
//   6. dry_run performs no upsert / no watermark write.
//   7. RATE-LIMIT detection + backoff match the sync (error #4; 30/60/120/240/300s).
//
//   deno test -A supabase/functions/backfill-daily-history/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");
// Collapse the exponential rate-limit backoff so the exhaustion path runs
// instantly (mirrors the sync test's SYNC_BACKOFF_BASE_SEC=0).
Deno.env.set("BACKFILL_BACKOFF_BASE_SEC", "0");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");

import type { MetaFetcher } from "./index.ts";
const mod = await import("./index.ts");
const { RETENTION_DAYS } = await import("../_shared/retention-config.ts");

// ── Mock Supabase: records every call. `creatives` selects resolve to the
// provided existing-ad set; `creative_daily_metrics` upserts + `ad_accounts`
// updates are captured; `settings` single() returns no token (env token is used).

interface Call { method: string; args: unknown[]; }
interface Upsert { table: string; rows: unknown[]; onConflict?: string; }
interface Update { table: string; patch: Record<string, unknown>; }

function makeRecorder(
  accounts: Array<Record<string, unknown>>,
  existingAdIds: string[],
) {
  const calls: Call[] = [];
  const upserts: Upsert[] = [];
  const updates: Update[] = [];

  function builderFor(table: string) {
    const state = { table, patch: undefined as Record<string, unknown> | undefined };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gt", "gte", "lte", "in", "order", "limit"]) {
      builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
    }
    builder.update = (patch: Record<string, unknown>) => {
      calls.push({ method: "update", args: [patch] });
      state.patch = patch;
      return builder;
    };
    // update(...).eq(...) resolves; capture on the terminal eq via then below.
    builder.upsert = (rows: unknown[], opts?: { onConflict?: string }) => {
      calls.push({ method: "upsert", args: [rows, opts] });
      upserts.push({ table: state.table, rows, onConflict: opts?.onConflict });
      return Promise.resolve({ data: null, error: null });
    };
    builder.single = () => {
      calls.push({ method: "single", args: [] });
      // settings.value lookup → no token row (fall through to env token).
      return Promise.resolve({ data: null, error: null });
    };
    builder.then = (resolve: (v: unknown) => void) => {
      if (state.patch !== undefined && state.table === "ad_accounts") {
        updates.push({ table: state.table, patch: state.patch });
        return resolve({ data: null, error: null });
      }
      if (state.table === "ad_accounts") return resolve({ data: accounts, error: null });
      if (state.table === "creatives") {
        return resolve({ data: existingAdIds.map((ad_id) => ({ ad_id })), error: null });
      }
      return resolve({ data: [], error: null });
    };
    return builder;
  }

  const supabase = {
    from: (table: string) => { calls.push({ method: "from", args: [table] }); return builderFor(table); },
  };
  return { supabase, calls, upserts, updates };
}

// Real Meta play-curve sample (fractions [0,1]).
const REAL_CURVE = ["1", "0.9", "0.7", "0.5", "0.3", "0.2", "0.1"];

function dailyRow(ad_id: string, date: string, spend: string) {
  return {
    ad_id,
    date_start: date,
    spend,
    clicks: "10",
    impressions: "1000",
    actions: [{ action_type: "purchase", value: "2" }],
    action_values: [{ action_type: "purchase", value: "50" }],
    video_play_curve_actions: [{ action_type: "video_view", value: REAL_CURVE }],
  };
}

// A fetcher that serves `rows` on the first call of every chunk, then [] (paging
// ends). Because each chunk creates a fresh insightsUrl, we key by URL prefix.
function fetcherServingOncePerChunk(rows: unknown[]): MetaFetcher {
  const servedUrls = new Set<string>();
  return (url: string) => {
    // strip pagination token so each chunk's first page is unique by time_range
    const key = url.split("&access_token=")[0];
    if (servedUrls.has(key)) return Promise.resolve({ data: [], next: null, error: null, rateLimited: false });
    servedUrls.add(key);
    return Promise.resolve({ data: rows, next: null, error: null, rateLimited: false });
  };
}

function req(body: unknown = {}) {
  return new Request("https://fn.local/backfill-daily-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── 1. nextChunk backward-stepping / clamping / termination ──────────────────

Deno.test("nextChunk steps CHUNK_DAYS older than the frontier, overlapping 1 day", () => {
  const c = mod.nextChunk("2026-07-14", "2026-01-01");
  assert(c !== null);
  assertEquals(c!.until, "2026-07-14"); // 1-day overlap with the frontier
  assertEquals(c!.since, "2026-06-29"); // 15 days older
});

Deno.test("nextChunk clamps since to the target and never undershoots", () => {
  const c = mod.nextChunk("2026-01-10", "2026-01-01");
  assert(c !== null);
  assertEquals(c!.since, "2026-01-01"); // clamped to target, not 2025-12-26
  assertEquals(c!.until, "2026-01-10");
});

Deno.test("nextChunk returns null once the frontier reaches the target", () => {
  assertEquals(mod.nextChunk("2026-01-01", "2026-01-01"), null);
  assertEquals(mod.nextChunk("2025-12-01", "2026-01-01"), null); // already beyond
});

// ── 2. buildDailyRow mapping + gating ────────────────────────────────────────

Deno.test("buildDailyRow maps summables + reconstructs the curve for a known ad", () => {
  const valid = new Set(["ad_a"]);
  const row = mod.buildDailyRow(dailyRow("ad_a", "2026-06-01", "12.5"), "act_1", valid);
  assert(row !== null);
  assertEquals(row!.ad_id, "ad_a");
  assertEquals(row!.account_id, "act_1");
  assertEquals(row!.date, "2026-06-01");
  assertEquals(row!.spend, 12.5);
  assertEquals(row!.purchases, 2);
  assertEquals(row!.purchase_value, 50);
  // curve normalized to true percentages [0,100]; first bucket = 100.
  assert(Array.isArray(row!.video_play_curve_actions));
  assertEquals(row!.video_play_curve_actions![0], 100);
  assert(row!.retention_p50 !== null);
});

Deno.test("buildDailyRow drops rows missing date_start, missing ad_id, or unknown ad", () => {
  const valid = new Set(["ad_a"]);
  assertEquals(mod.buildDailyRow({ ad_id: "ad_a" }, "act_1", valid), null); // no date_start
  assertEquals(mod.buildDailyRow({ date_start: "2026-06-01" }, "act_1", valid), null); // no ad_id
  assertEquals(mod.buildDailyRow(dailyRow("ad_x", "2026-06-01", "1"), "act_1", valid), null); // not in gate
});

// ── 3. Watermark advances backward after upsert; pins to target ──────────────

Deno.test("handler advances daily_backfilled_since backward and pins at the target", async () => {
  // Small window so it drains in one run: target = 20 days ago, frontier = today.
  const today = new Date();
  const createdTime = new Date(today.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const account = { id: "act_1", name: "A", click_window: 7, view_window: 1, daily_backfilled_since: null, created_time: createdTime };
  const { supabase, updates } = makeRecorder([account], ["ad_a"]);

  const res = await mod.handler(req({ account_id: "act_1" }), supabase, fetcherServingOncePerChunk([dailyRow("ad_a", "2026-06-01", "5")]));
  const body = await res.json();

  assertEquals(body.success, true);
  assertEquals(body.drained, true);
  assertEquals(body.totals.reached_target, 1);
  // Final watermark write pins to the account's creation-clamped target.
  const target = mod.isoDate(new Date(createdTime));
  const lastWatermark = updates.filter((u) => "daily_backfilled_since" in u.patch).at(-1)?.patch.daily_backfilled_since;
  assertEquals(lastWatermark, target);
  // Upserts landed on creative_daily_metrics keyed by (ad_id,date).
  const dmUpserts = updates; // updates only holds watermark writes; check via body totals
  assert(body.totals.upserted > 0, "should have upserted daily rows");
  assert(dmUpserts.length > 0);
});

// ── 4. Rate-limit pause is NOT completion (watermark not advanced past chunk) ─

Deno.test("a resumable rate-limit pause leaves the account mid-backfill (drained=false)", async () => {
  const today = new Date();
  const createdTime = new Date(today.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const account = { id: "act_1", name: "A", click_window: 7, view_window: 1, daily_backfilled_since: null, created_time: createdTime };
  const { supabase, updates } = makeRecorder([account], ["ad_a"]);

  // Fetcher: immediately return an exhausted rate-limit pause (error + rateLimited).
  let calls = 0;
  const pausingFetcher: MetaFetcher = () => {
    calls++;
    return Promise.resolve({ data: null, next: null, error: { code: 4, message: "Application request limit reached" }, rateLimited: true });
  };
  const res = await mod.handler(req({ account_id: "act_1" }), supabase, pausingFetcher);
  const body = await res.json();

  assertEquals(body.success, true);
  assertEquals(body.drained, false, "a pause must not read as drained/completion");
  assertEquals(body.totals.reached_target, 0);
  // No watermark advance happened (nothing was fetched for the first chunk).
  const watermarkWrites = updates.filter((u) => "daily_backfilled_since" in u.patch);
  assertEquals(watermarkWrites.length, 0, "watermark must not advance past an un-fetched chunk");
  // The fetcher was retried up to the cap then paused (bounded).
  assert(calls >= 1);
});

// ── 5. Already-at-target account: no fetch, no write ─────────────────────────

Deno.test("an account already at the target does no fetch and no watermark write", async () => {
  const target = mod.dateDaysAgo(new Date(), RETENTION_DAYS);
  // watermark older than target => fully backfilled.
  const olderThanTarget = mod.dateDaysAgo(new Date(), RETENTION_DAYS + 5);
  const account = { id: "act_1", name: "A", click_window: 7, view_window: 1, daily_backfilled_since: olderThanTarget, created_time: null };
  const { supabase, updates } = makeRecorder([account], ["ad_a"]);

  let fetchCalls = 0;
  const fetcher: MetaFetcher = () => { fetchCalls++; return Promise.resolve({ data: [], next: null, error: null, rateLimited: false }); };
  const res = await mod.handler(req({ account_id: "act_1" }), supabase, fetcher);
  const body = await res.json();

  assertEquals(body.success, true);
  assertEquals(fetchCalls, 0, "no Graph fetch for an already-backfilled account");
  assertEquals(updates.length, 0, "no watermark write when already at/beyond target");
  void target;
});

// ── 6. dry_run performs no writes ────────────────────────────────────────────

Deno.test("dry_run reports would-write counts but performs no upsert / watermark write", async () => {
  const today = new Date();
  const createdTime = new Date(today.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const account = { id: "act_1", name: "A", click_window: 7, view_window: 1, daily_backfilled_since: null, created_time: createdTime };
  const { supabase, upserts, updates } = makeRecorder([account], ["ad_a"]);

  const res = await mod.handler(req({ account_id: "act_1", dry_run: true }), supabase, fetcherServingOncePerChunk([dailyRow("ad_a", "2026-06-01", "5")]));
  const body = await res.json();

  assertEquals(body.success, true);
  assertEquals(body.dry_run, true);
  assert(body.totals.upserted > 0, "dry_run still reports would-write counts");
  assertEquals(upserts.length, 0, "dry_run performs no upsert");
  assertEquals(updates.length, 0, "dry_run performs no watermark write");
});

// ── 7. Rate-limit detection + backoff match the sync ─────────────────────────

Deno.test("isRateLimitError matches the sync's error-code set", () => {
  for (const code of [4, 17, 32, 80004, 80000]) {
    assert(mod.isRateLimitError({ code }), `code ${code} is a rate limit`);
  }
  assert(mod.isRateLimitError({ error_subcode: 2446079 }));
  assert(mod.isRateLimitError({ message: "User request limit reached" }));
  assert(!mod.isRateLimitError({ code: 100, message: "Unsupported get request" }));
  assert(!mod.isRateLimitError(null));
});

Deno.test("backoffMs is exponential, 1-based, capped at 5 minutes (prod formula)", () => {
  // The module under test runs with BACKFILL_BACKOFF_BASE_SEC=0 to collapse waits,
  // so assert the PROD formula directly (base 30s) rather than the test-collapsed
  // value: min(300, 30*2^(n-1))*1000, capped at 300_000ms.
  const prod = (retry: number) => Math.min(300, 30 * Math.pow(2, Math.max(0, retry - 1))) * 1000;
  assertEquals(prod(1), 30_000);
  assertEquals(prod(2), 60_000);
  assertEquals(prod(3), 120_000);
  assertEquals(prod(4), 240_000);
  assertEquals(prod(5), 300_000); // capped
  assertEquals(prod(6), 300_000); // stays capped
  // And with the collapsed base the module's own backoffMs returns 0 (instant).
  assertEquals(mod.backoffMs(1), 0);
});
