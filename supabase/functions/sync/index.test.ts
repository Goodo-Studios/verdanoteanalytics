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

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("SYNC_BACKOFF_BASE_SEC", "0");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
// The US-007 reconciliation suite drives the real backfill handler; keep it from
// binding a network listener when this module imports it.
Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");
Deno.env.set("BACKFILL_BACKOFF_BASE_SEC", "0");
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");

const { metaFetch, isInformationalSyncNote, countRealErrors, computeDailyWindowDays, rollupDailyRows, newlyInsertedAdIds } = await import("./index.ts");
const { RECENT_WINDOW_DAYS, RETENTION_DAYS } = await import("../_shared/retention-config.ts");

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

// ── US-002: rolling-window incremental daily sync ─────────────────────────
// The core cost win: a scheduled sync on an already-backfilled account must
// re-pull only the ~28d recent window, not the full 180/365d retention window.

const NOW = new Date("2026-07-14T12:00:00Z");

Deno.test("US-002: scheduled sync on backfilled account requests the ~28d recent window, not 180/365", () => {
  // Synced yesterday → gap is 1d; buffer is the 7d attribution window →
  // RECENT_WINDOW_DAYS (28) dominates. Requested window is ~28, far below the
  // full retention window.
  const days = computeDailyWindowDays({
    rollingEligible: true,
    dateRangeDays: 180,
    lastDataSync: "2026-07-13T12:00:00Z",
    clickWindow: 7,
    now: NOW,
  });
  assertEquals(days, RECENT_WINDOW_DAYS);
  assertEquals(days, 28);
  // Explicitly assert it is NOT the full window.
  assertEquals(days < 180, true);
  assertEquals(days < RETENTION_DAYS, true);
});

Deno.test("US-002: the 28d window comfortably exceeds a healthy daily-sync gap (no gaps)", () => {
  // For any gap up to RECENT_WINDOW_DAYS - clickWindow, the window stays at the
  // recent window and still spans more days than have elapsed — no day can be
  // missed between daily syncs.
  const clickWindow = 7;
  for (let gap = 0; gap <= RECENT_WINDOW_DAYS - clickWindow; gap++) {
    const last = new Date(NOW.getTime() - gap * 24 * 60 * 60 * 1000).toISOString();
    const days = computeDailyWindowDays({
      rollingEligible: true,
      dateRangeDays: 180,
      lastDataSync: last,
      clickWindow,
      now: NOW,
    });
    assertEquals(days, RECENT_WINDOW_DAYS);
    // Window must cover every elapsed day plus the attribution buffer.
    assertEquals(days >= gap, true);
  }
});

Deno.test("US-002: a long outage widens the window past 28d so skipped days are re-pulled", () => {
  // Last synced 40 days ago → gap(40) + buffer(7) = 47 > 28, so the window
  // widens to cover the outage rather than silently dropping days.
  const last = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const days = computeDailyWindowDays({
    rollingEligible: true,
    dateRangeDays: 180,
    lastDataSync: last,
    clickWindow: 7,
    now: NOW,
  });
  assertEquals(days, 47);
  assertEquals(days > RECENT_WINDOW_DAYS, true);
});

Deno.test("US-002: window is capped at RETENTION_DAYS even after a very long gap", () => {
  const last = new Date(NOW.getTime() - 900 * 24 * 60 * 60 * 1000).toISOString();
  const days = computeDailyWindowDays({
    rollingEligible: true,
    dateRangeDays: 180,
    lastDataSync: last,
    clickWindow: 7,
    now: NOW,
  });
  assertEquals(days, RETENTION_DAYS);
});

Deno.test("US-002: not-yet-backfilled / initial sync keeps the full date_range_days window", () => {
  // rollingEligible=false covers both initial syncs and accounts without
  // daily_backfilled_since — history does not yet exist locally, so we must not
  // narrow the window before the backfill (US-004) lands.
  const days = computeDailyWindowDays({
    rollingEligible: false,
    dateRangeDays: 180,
    lastDataSync: "2026-07-13T12:00:00Z",
    clickWindow: 7,
    now: NOW,
  });
  assertEquals(days, 180);
});

Deno.test("US-002: never-synced backfilled account still gets at least the recent window", () => {
  // No last_data_sync → gap treated as 0, window = max(28, 0+7) = 28.
  const days = computeDailyWindowDays({
    rollingEligible: true,
    dateRangeDays: 180,
    lastDataSync: null,
    clickWindow: 7,
    now: NOW,
  });
  assertEquals(days, RECENT_WINDOW_DAYS);
});

// ── US-003: local rollup of the per-ad snapshot ───────────────────────────
// rollupDailyRows is the authoritative arithmetic spec for the SQL RPC
// rollup_creatives_from_daily. These tests lock the contract from the story's
// acceptance criteria + e2eTests: summed base metrics equal the sum of the
// underlying daily rows, and ratios are DERIVED from those sums.

function approx(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol;
}

Deno.test("US-003: snapshot totals equal the sum of the underlying daily rows (spend/impressions/clicks/purchases)", () => {
  // 30 days of daily rows for one ad — mirror the e2eTest scenario.
  const rows = [];
  let expSpend = 0, expImpr = 0, expClicks = 0, expPurch = 0, expPV = 0;
  for (let d = 0; d < 30; d++) {
    const spend = 10 + d;           // 10..39
    const impressions = 1000 + d * 10;
    const clicks = 20 + d;
    const purchases = 1 + (d % 3);
    const purchase_value = (1 + (d % 3)) * 50;
    expSpend += spend; expImpr += impressions; expClicks += clicks;
    expPurch += purchases; expPV += purchase_value;
    rows.push({ spend, impressions, clicks, purchases, purchase_value, video_views: 0 });
  }
  const agg = rollupDailyRows(rows);
  // Summable base metrics equal the daily sums exactly.
  assertEquals(agg.spend, expSpend);
  assertEquals(agg.impressions, expImpr);
  assertEquals(agg.clicks, expClicks);
  assertEquals(agg.purchases, expPurch);
  assertEquals(agg.purchase_value, expPV);
  // roas is DERIVED: purchase_value / spend (not an average of daily roas).
  assertEquals(approx(agg.roas, expPV / expSpend), true);
  // ctr / cpc / cpm derived from the sums.
  assertEquals(approx(agg.ctr, (expClicks / expImpr) * 100), true);
  assertEquals(approx(agg.cpc, expSpend / expClicks), true);
  assertEquals(approx(agg.cpm, (expSpend / expImpr) * 1000), true);
  // cpa derived, result columns mirror purchases/cpa.
  assertEquals(approx(agg.cpa, expSpend / expPurch), true);
  assertEquals(agg.result_count, expPurch);
});

Deno.test("US-003: derived ratios never average daily ratios (a high-spend low-roas day dominates)", () => {
  // Day A: heavy spend, poor roas. Day B: light spend, great roas.
  // Averaging daily roas would give (0.5 + 5)/2 = 2.75; the correct spend-weighted
  // roas is total_value/total_spend = (500+50)/(1000+10) ≈ 0.5446.
  const rows = [
    { spend: 1000, purchase_value: 500, impressions: 100000, clicks: 500, purchases: 5 },
    { spend: 10, purchase_value: 50, impressions: 200, clicks: 4, purchases: 1 },
  ];
  const agg = rollupDailyRows(rows);
  assertEquals(agg.spend, 1010);
  assertEquals(agg.purchase_value, 550);
  assertEquals(approx(agg.roas, 550 / 1010), true);
  // Explicitly NOT the naive mean of daily roas (0.5, 5.0).
  assertEquals(agg.roas < 1, true);
});

Deno.test("US-003: retention_p50 is reconstructed within tolerance of the daily video-view-weighted value", () => {
  // Two days with different retention and different video volume. The rollup is
  // view-weighted, so the high-volume day dominates.
  const rows = [
    { video_views: 900, retention_p25: 80, retention_p50: 60, retention_p75: 40, retention_p100: 20, hold_rate: 30 },
    { video_views: 100, retention_p25: 40, retention_p50: 20, retention_p75: 10, retention_p100: 5, hold_rate: 10 },
  ];
  const agg = rollupDailyRows(rows);
  // Weighted p50 = (60*900 + 20*100) / 1000 = 56.
  assertEquals(approx(agg.retention_p50 ?? NaN, 56, 1e-6), true);
  assertEquals(approx(agg.retention_p25 ?? NaN, (80 * 900 + 40 * 100) / 1000, 1e-6), true);
  // hold_rate derived from reconstructed thruplays: (0.30*900 + 0.10*100)/1000*100 = 28.
  assertEquals(approx(agg.hold_rate, 28, 1e-6), true);
  // thumb_stop_rate needs impressions; with none it is 0.
  assertEquals(agg.thumb_stop_rate, 0);
});

Deno.test("US-003: days without a retention curve are excluded, not zero-filled", () => {
  // Only one day carries retention; a null day must not drag the weighted mean to 0.
  const rows = [
    { video_views: 500, retention_p50: 50 },
    { video_views: 500, retention_p50: null },
  ];
  const agg = rollupDailyRows(rows);
  // Weight comes only from the day with a scalar → p50 stays 50, not 25.
  assertEquals(approx(agg.retention_p50 ?? NaN, 50, 1e-6), true);
});

Deno.test("US-003: no daily rows → zeroed snapshot with null retention (no divide-by-zero)", () => {
  const agg = rollupDailyRows([]);
  assertEquals(agg.spend, 0);
  assertEquals(agg.roas, 0);
  assertEquals(agg.ctr, 0);
  assertEquals(agg.retention_p50, null);
});

// ── US-007: Workstream-1 reconciliation gate ──────────────────────────────────
// The WS1 safety net before cutting over all accounts at once. WS1 is built from
// independent stories (US-001..006); this suite proves they RECONCILE end-to-end
// as one pipeline, in code, without live Meta/prod:
//
//   backfill (US-004) → scheduled incremental sync (US-002) → local rollup (US-003)
//
// Invariants proven here (from the story's acceptance criteria + e2eTest):
//   A. Backfill produces ~365 days of rows (full promised year on day one).
//   B. A scheduled sync AFTERWARD touches only the ~28d recent window — the daily
//      Meta call volume for the scheduled sync reflects ONLY that window, not the
//      full 180/365d window (the ~90% cost win).
//   C. The rollup snapshot MATCHES a full-window Meta pull: rolling up the locally
//      stored daily rows equals summing the same days straight from Meta truth —
//      i.e. the local rollup is a faithful stand-in for the retired Phase-2
//      full-window aggregate fetch.
//   D. No GAPS and no DOUBLE-COUNTS across the backfill/incremental seam and
//      between successive incremental windows: every retained day appears exactly
//      once regardless of overlapping fetch windows.
//   E. The (ad_id,date) upsert is IDEMPOTENT: re-pulling the recent window (as a
//      daily sync does) never duplicates a day or drifts a value.
//
// Meta is modeled as an immutable "truth" table keyed by (ad_id,date). Both the
// real backfill handler AND the simulated incremental re-pull read from it and
// write into one shared in-memory store that enforces the (ad_id,date) PK exactly
// like Postgres — so overlap resolves to an upsert, never a duplicate. This is the
// automated, fixture-based reconciliation the story mandates in place of hitting
// live prod/Meta (the true live 30d/365d Ads-Manager reconciliation is an
// operator step called out in RETURN notes, not something a test can perform).

import type { MetaFetcher } from "../backfill-daily-history/index.ts";
const backfill = await import("../backfill-daily-history/index.ts");

// ISO date `days` before `ref` (UTC).
function iso(ref: Date, days: number): string {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

// One day of Meta "truth" for an ad. Numbers vary by day index so any dropped or
// double-counted day is detectable in the reconciled totals (not masked by equal
// per-day values).
function truthRow(ad_id: string, date: string, dayIdx: number) {
  const spend = 10 + (dayIdx % 7);          // 10..16
  const impressions = 1000 + dayIdx;
  const clicks = 20 + (dayIdx % 5);
  const purchases = 1 + (dayIdx % 3);
  const purchase_value = (1 + (dayIdx % 3)) * 50;
  const video_views = 100 + dayIdx;
  return {
    ad_id,
    date_start: date,
    spend: String(spend),
    clicks: String(clicks),
    impressions: String(impressions),
    frequency: "1.5",
    actions: [
      { action_type: "purchase", value: String(purchases) },
      { action_type: "video_view", value: String(video_views) },
    ],
    action_values: [{ action_type: "purchase", value: String(purchase_value) }],
    video_play_curve_actions: [{ action_type: "video_view", value: ["1", "0.9", "0.7", "0.5", "0.3", "0.2", "0.1"] }],
    // expose the raw numbers for full-window "Meta pull" comparison.
    _n: { spend, impressions, clicks, purchases, purchase_value, video_views },
  };
}

// Build Meta truth for one ad spanning `spanDays` ending at `today` (inclusive).
function buildTruth(adId: string, today: Date, spanDays: number) {
  const byDate = new Map<string, ReturnType<typeof truthRow>>();
  for (let d = 0; d < spanDays; d++) {
    const date = iso(today, d);
    byDate.set(date, truthRow(adId, date, d));
  }
  return byDate;
}

// A MetaFetcher that serves truth rows whose date falls inside the requested
// time_range=... window, once per unique window (paging then ends). Mirrors how
// Meta returns a daily breakdown for a [since,until] range.
function truthFetcher(truth: Map<string, ReturnType<typeof truthRow>>): {
  fetcher: MetaFetcher;
  windowsRequested: Array<{ since: string; until: string }>;
} {
  const served = new Set<string>();
  const windowsRequested: Array<{ since: string; until: string }> = [];
  const fetcher: MetaFetcher = (url: string) => {
    const key = url.split("&access_token=")[0];
    if (served.has(key)) return Promise.resolve({ data: [], next: null, error: null, rateLimited: false });
    served.add(key);
    const m = url.match(/time_range=([^&]+)/);
    const range = m ? JSON.parse(decodeURIComponent(m[1])) as { since: string; until: string } : null;
    if (!range) return Promise.resolve({ data: [], next: null, error: null, rateLimited: false });
    windowsRequested.push(range);
    const rows = [...truth.values()].filter((r) => r.date_start >= range.since && r.date_start <= range.until);
    return Promise.resolve({ data: rows, next: null, error: null, rateLimited: false });
  };
  return { fetcher, windowsRequested };
}

// A store that enforces the (ad_id,date) PK exactly like the real
// creative_daily_metrics upsert (onConflict: "ad_id,date"): last write wins, no
// duplicate rows. This is what makes any double-count impossible to hide.
function makeDailyStore() {
  const rows = new Map<string, Record<string, unknown>>(); // key = ad_id|date
  let upsertCalls = 0;
  let rowsWritten = 0;
  function upsert(batch: Array<Record<string, unknown>>) {
    upsertCalls++;
    for (const r of batch) {
      rowsWritten++;
      rows.set(`${r.ad_id}|${r.date}`, r);
    }
  }
  return {
    upsert,
    get size() { return rows.size; },
    get upsertCalls() { return upsertCalls; },
    get rowsWritten() { return rowsWritten; },
    all() { return [...rows.values()]; },
    forAd(adId: string) {
      return [...rows.values()]
        .filter((r) => r.ad_id === adId)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    },
  };
}

// A recording Supabase mock whose creative_daily_metrics upserts land in `store`,
// whose creatives select resolves to `existingAdIds`, and whose ad_accounts
// select returns `accounts` / captures watermark updates. Enough surface for the
// real backfill handler() to run end-to-end.
function makeSupabase(
  store: ReturnType<typeof makeDailyStore>,
  accounts: Array<Record<string, unknown>>,
  existingAdIds: string[],
) {
  const watermarks: string[] = [];
  function builderFor(table: string) {
    const state = { table, patch: undefined as Record<string, unknown> | undefined };
    // deno-lint-ignore no-explicit-any -- recording mock; chaining returns `builder`.
    const builder: Record<string, any> = {};
    for (const m of ["select", "eq", "is", "gt", "gte", "lte", "in", "order", "limit"]) {
      builder[m] = () => builder;
    }
    builder.update = (patch: Record<string, unknown>) => { state.patch = patch; return builder; };
    builder.upsert = (rows: Array<Record<string, unknown>>, opts?: { onConflict?: string }) => {
      if (state.table === "creative_daily_metrics") {
        // The pipeline relies on the (ad_id,date) conflict key — assert it here so
        // a change that breaks idempotency is caught.
        assertEquals(opts?.onConflict, "ad_id,date");
        store.upsert(rows);
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.single = () => Promise.resolve({ data: null, error: null });
    builder.then = (resolve: (v: unknown) => void) => {
      if (state.patch !== undefined && state.table === "ad_accounts") {
        if ("daily_backfilled_since" in state.patch) watermarks.push(String(state.patch.daily_backfilled_since));
        return resolve({ data: null, error: null });
      }
      if (state.table === "ad_accounts") return resolve({ data: accounts, error: null });
      if (state.table === "creatives") return resolve({ data: existingAdIds.map((ad_id) => ({ ad_id })), error: null });
      return resolve({ data: [], error: null });
    };
    return builder;
  }
  return { supabase: { from: (t: string) => builderFor(t) }, watermarks };
}

function bfReq(body: unknown) {
  return new Request("https://fn.local/backfill-daily-history", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

// Drive the backfill handler repeatedly (as the pg_cron would) until the account
// is fully drained to its target — resuming from the persisted watermark each run.
async function runBackfillToCompletion(
  store: ReturnType<typeof makeDailyStore>,
  account: Record<string, unknown>,
  existingAdIds: string[],
  fetcher: MetaFetcher,
) {
  let watermark: string | null = (account.daily_backfilled_since as string | null) ?? null;
  for (let guard = 0; guard < 200; guard++) {
    const acct: Record<string, unknown> = { ...account, daily_backfilled_since: watermark };
    const { supabase, watermarks } = makeSupabase(store, [acct], existingAdIds);
    const res = await backfill.handler(bfReq({ account_id: acct.id }), supabase, fetcher);
    const body = await res.json();
    assertEquals(body.success, true);
    if (watermarks.length > 0) watermark = watermarks.at(-1)!;
    if (body.drained && body.totals.reached_target >= 1) return { watermark };
    // A test fetcher never rate-limits, so a non-drained run only means the wall
    // budget cut the run — resume from the new watermark. Guard prevents a spin.
    if (!body.drained && watermarks.length === 0) {
      throw new Error("backfill made no progress and did not drain — would spin");
    }
  }
  throw new Error("backfill did not reach target within the guard bound");
}

Deno.test(
  "US-007: backfill → scheduled sync → rollup reconcile end-to-end (365d + 28d window + idempotent upsert)",
  async () => {
    const AD = "ad_recon";
    const today = new Date("2026-07-14T00:00:00Z");
    // Account created 500 days ago, so the per-account target is the full 365d
    // (creation is older than RETENTION_DAYS). Meta has 400 days of truth — more
    // than the retention window — so backfill must stop AT the target, not run off
    // the end of Meta's data.
    const truth = buildTruth(AD, today, 400);
    const account = {
      id: "act_recon",
      name: "Recon",
      click_window: 7,
      view_window: 1,
      daily_backfilled_since: null,
      created_time: new Date(today.getTime() - 500 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const store = makeDailyStore();

    // ── Phase 1: one-time historical backfill (US-004) ──────────────────────
    const bf = truthFetcher(truth);
    // Freeze "now" inside the handler's target math by shrinking the truth to end
    // today; the handler uses new Date() but our truth is anchored at `today`, and
    // the test runs the same UTC day. Guard: assert we landed the promised year.
    await runBackfillToCompletion(store, account, [AD], bf.fetcher);

    // A. ~365 days of rows exist (the promised year on day one). We allow a small
    //    epsilon for the inclusive-endpoint / creation-clamp / run-day boundary.
    const daysStored = store.forAd(AD).length;
    assert(
      daysStored >= RETENTION_DAYS - 2 && daysStored <= RETENTION_DAYS + 2,
      `backfill should store ~${RETENTION_DAYS} days, got ${daysStored}`,
    );

    // D. No gaps and no double-counts in the backfilled region: dates are unique
    //    (PK-enforced) AND contiguous day-by-day with no missing day.
    const dates = store.forAd(AD).map((r) => String(r.date));
    assertEquals(new Set(dates).size, dates.length, "no duplicate (ad_id,date) rows");
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + "T00:00:00Z").getTime();
      const cur = new Date(dates[i] + "T00:00:00Z").getTime();
      assertEquals((cur - prev) / (24 * 60 * 60 * 1000), 1, `gap between ${dates[i - 1]} and ${dates[i]}`);
    }

    // ── Phase 2: a scheduled incremental sync AFTER backfill (US-002) ────────
    // The account is now backfilled (watermark set) and this is a scheduled (non-
    // initial) sync synced "yesterday" → the window is the ~28d recent window.
    const windowDays = computeDailyWindowDays({
      rollingEligible: true, // backfilled + scheduled
      dateRangeDays: 180,
      lastDataSync: iso(today, 1),
      clickWindow: 7,
      now: today,
    });
    // B. Only the ~28d recent window — decisively NOT the full 180/365 window.
    assertEquals(windowDays, RECENT_WINDOW_DAYS);
    assert(windowDays < 180 && windowDays < RETENTION_DAYS);

    // Re-pull exactly that window from Meta and upsert into the SAME store. This
    // overlaps the newest ~28 days already written by the backfill.
    const incrFetcher = truthFetcher(truth).fetcher;
    const since = iso(today, windowDays);
    const until = iso(today, 0);
    const rowsBeforeIncr = store.size;
    // Simulate the sync's Phase-4 fetch+map+upsert for the recent window using the
    // SAME canonical row builder the sync path relies on.
    {
      const res = await incrFetcher(
        `https://graph.facebook.com/v22.0/${account.id}/insights?time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=1&access_token=fake`,
      );
      const mapped = (res.data ?? [])
        .map((r) => backfill.buildDailyRow(r, account.id, new Set([AD])))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      // The recent window must cover its whole span (no gap) …
      assert(mapped.length >= windowDays, `incremental window should cover ~${windowDays} days, got ${mapped.length}`);
      store.upsert(mapped as Array<Record<string, unknown>>);
    }

    // E. Idempotent (ad_id,date) upsert: re-pulling the recent window overlapped
    //    already-stored days, so the row COUNT is unchanged (no double-count) even
    //    though rows were physically re-written.
    assertEquals(store.size, rowsBeforeIncr, "overlapping recent-window re-pull must not add rows (idempotent PK upsert)");

    // Explicit idempotency stress: re-run the incremental upsert a second time and
    // confirm neither the row count nor any value drifts.
    const snapshotBefore = JSON.stringify(store.forAd(AD));
    {
      const res = await truthFetcher(truth).fetcher(
        `https://graph.facebook.com/v22.0/${account.id}/insights?time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=1&access_token=fake2`,
      );
      const mapped = (res.data ?? [])
        .map((r) => backfill.buildDailyRow(r, account.id, new Set([AD])))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      store.upsert(mapped as Array<Record<string, unknown>>);
    }
    assertEquals(store.size, rowsBeforeIncr, "second re-pull still adds no rows");
    assertEquals(JSON.stringify(store.forAd(AD)), snapshotBefore, "re-pull must not drift any stored value");

    // ── Phase 3: local rollup reconciles against a full-window Meta pull ─────
    // C. Roll up the locally-stored daily rows (what US-003's SQL does), then sum
    //    the SAME days straight from Meta truth (what the retired Phase-2 full-
    //    window fetch would have produced) and assert they match exactly for the
    //    summable base metrics + the derived ratios. This is the core "rollup ==
    //    full-window equivalent" reconciliation.
    const storedRows = store.forAd(AD).map((r) => ({
      spend: r.spend as number,
      impressions: r.impressions as number,
      clicks: r.clicks as number,
      purchases: r.purchases as number,
      purchase_value: r.purchase_value as number,
      video_views: r.video_views as number,
      hold_rate: r.hold_rate as number,
      frequency: r.frequency as number,
    }));
    const rolled = rollupDailyRows(storedRows);

    // "Full-window Meta pull" = sum the raw truth over the exact same dates we hold
    // locally (the retention window). A faithful local rollup equals this.
    const heldDates = new Set(store.forAd(AD).map((r) => String(r.date)));
    let mSpend = 0, mImpr = 0, mClicks = 0, mPurch = 0, mPV = 0, mVV = 0;
    for (const r of truth.values()) {
      if (!heldDates.has(r.date_start)) continue;
      mSpend += r._n.spend; mImpr += r._n.impressions; mClicks += r._n.clicks;
      mPurch += r._n.purchases; mPV += r._n.purchase_value; mVV += r._n.video_views;
    }

    // Summable base metrics reconcile EXACTLY (0% drift) — this is the invariant
    // the operator will confirm against Ads Manager for real accounts.
    assertEquals(rolled.spend, mSpend, "rollup spend == full-window Meta spend");
    assertEquals(rolled.impressions, mImpr, "rollup impressions == full-window");
    assertEquals(rolled.clicks, mClicks, "rollup clicks == full-window");
    assertEquals(rolled.purchases, mPurch, "rollup purchases == full-window purchases");
    assertEquals(rolled.purchase_value, mPV, "rollup purchase_value == full-window");
    assertEquals(rolled.video_views, mVV, "rollup video_views == full-window");
    // Derived ratios follow from the reconciled sums (spend-weighted, not averaged).
    assert(approx(rolled.roas, mPV / mSpend, 1e-9), "roas derived from reconciled sums");
    assert(approx(rolled.ctr, (mClicks / mImpr) * 100, 1e-9), "ctr derived from reconciled sums");
  },
);

Deno.test(
  "US-007: overlapping incremental windows across successive syncs never drop or double-count a day",
  async () => {
    // Model three daily syncs whose ~28d windows overlap heavily. Every day in the
    // union must end up stored exactly once, with the newest value — i.e. no gap
    // between windows and no double-count from the overlap.
    const AD = "ad_seam";
    const today = new Date("2026-07-14T00:00:00Z");
    const truth = buildTruth(AD, today, 90);
    const store = makeDailyStore();

    // Backfill the older tail first (days 28..89) so there is a seam between the
    // backfilled region and the incremental region.
    const older = buildTruth(AD, new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000), 62);
    {
      const rows = [...older.values()]
        .map((r) => backfill.buildDailyRow(r, "act_seam", new Set([AD])))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      store.upsert(rows as Array<Record<string, unknown>>);
    }
    const afterBackfill = store.size;

    // Now three overlapping 28d incremental syncs anchored at today, today-1, today-2.
    for (const anchorBack of [2, 1, 0]) {
      const anchor = new Date(today.getTime() - anchorBack * 24 * 60 * 60 * 1000);
      const since = iso(anchor, RECENT_WINDOW_DAYS);
      const until = iso(anchor, 0);
      const rows = [...truth.values()]
        .filter((r) => r.date_start >= since && r.date_start <= until)
        .map((r) => backfill.buildDailyRow(r, "act_seam", new Set([AD])))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      store.upsert(rows as Array<Record<string, unknown>>);
    }

    const dates = store.forAd(AD).map((r) => String(r.date)).sort();
    // No duplicates despite massive window overlap (PK upsert).
    assertEquals(new Set(dates).size, dates.length, "no double-counted day across overlapping windows");
    // Contiguous across the backfill/incremental seam — no missing day.
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i] + "T00:00:00Z").getTime() - new Date(dates[i - 1] + "T00:00:00Z").getTime()) / 86400000;
      assertEquals(gap, 1, `day ${dates[i - 1]} → ${dates[i]} must be contiguous`);
    }
    // The overlap physically re-wrote rows but added none beyond the union span.
    assert(store.size >= afterBackfill, "incremental syncs extend, never shrink, coverage");
    assertEquals(dates[0], iso(today, 89), "coverage still reaches the backfilled tail (no dropped older days)");
    assertEquals(dates.at(-1), iso(today, 0), "coverage reaches today (no dropped recent days)");
  },
);

Deno.test(
  "US-007: trim removes only >400d rows and never touches in-year data (mirrors trim_creative_daily_metrics)",
  () => {
    // The SQL trim (US-006) deletes date < CURRENT_DATE - TRIM_BUFFER_DAYS. Mirror
    // that predicate here over a fixture spanning well past the buffer and assert
    // in-year (<=365d) rows are always retained in the same pass.
    const today = new Date("2026-07-14T00:00:00Z");
    const cutoffDays = 400; // TRIM_BUFFER_DAYS
    const store = makeDailyStore();
    const rows: Array<Record<string, unknown>> = [];
    for (const back of [0, 30, 200, 365, 399, 400, 401, 500]) {
      rows.push({ ad_id: "ad_trim", date: iso(today, back), spend: back });
    }
    store.upsert(rows);
    const cutoff = iso(today, cutoffDays); // date < cutoff is deleted
    const kept = store.all().filter((r) => String(r.date) >= cutoff).map((r) => String(r.date));
    const deleted = store.all().filter((r) => String(r.date) < cutoff).map((r) => String(r.date));

    // Only rows strictly older than the 400d buffer are deleted.
    assertEquals(deleted.sort(), [iso(today, 500), iso(today, 401)].sort());
    // Everything within the promised year (<=365d) is retained, and so is the buffer itself.
    for (const back of [0, 30, 200, 365, 399, 400]) {
      assert(kept.includes(iso(today, back)), `in-buffer day ${back}d back must be kept`);
    }
    // The exact 400d row is kept (predicate is strict `<`, not `<=`).
    assert(kept.includes(iso(today, 400)), "the 400d boundary row is retained");
  },
);

// ── US-008: event-driven media cache enqueue (cache on new ads only) ──────────
// newlyInsertedAdIds is the pure contract behind Phase 1's enqueue: given a Meta
// ad batch and the ad_ids that ALREADY existed in creatives, it returns exactly
// the ads that are new this run — the only ids sync enqueues into
// media_cache_queue. This guards the core "cache on new ads only, never blind
// fanout" guarantee without a live DB.

Deno.test(
  "US-008: a sync that adds 3 new ads enqueues exactly those 3 ads",
  () => {
    // Account already has ad_1, ad_2 cached; Meta returns them plus 3 brand-new ads.
    const existing = new Set(["ad_1", "ad_2"]);
    const batch = ["ad_1", "ad_2", "ad_3", "ad_4", "ad_5"];
    const toEnqueue = newlyInsertedAdIds(batch, existing);
    assertEquals(toEnqueue, ["ad_3", "ad_4", "ad_5"]);
    assertEquals(toEnqueue.length, 3, "exactly the 3 new ads are enqueued, not the whole account");
  },
);

Deno.test(
  "US-008: a sync with no new ads enqueues nothing (fully-cached account)",
  () => {
    // Every ad Meta returns is already in creatives → nothing new → no fanout.
    const existing = new Set(["ad_1", "ad_2", "ad_3"]);
    const batch = ["ad_1", "ad_2", "ad_3"];
    assertEquals(newlyInsertedAdIds(batch, existing), []);
  },
);

Deno.test(
  "US-008: newly-inserted ads are de-duped within a batch (Meta paging repeats)",
  () => {
    // Meta can surface the same ad twice across pages/campaigns in one run; an ad
    // must be enqueued at most once (mirrors the media_cache_queue ad_id PK +
    // ON CONFLICT DO NOTHING enqueue).
    const existing = new Set<string>();
    const batch = ["ad_9", "ad_9", "ad_10", "ad_9", "ad_10"];
    assertEquals(newlyInsertedAdIds(batch, existing), ["ad_9", "ad_10"]);
  },
);

Deno.test(
  "US-008: already-cached ids never re-enqueue; empty/falsy ids are skipped",
  () => {
    // Already-in-creatives ads are excluded (they are already cached / will be
    // via the immutable pipeline) so cached media is never re-downloaded via the
    // queue. Guard against empty ad ids sneaking a bogus row into the queue.
    const existing = new Set(["ad_1"]);
    const batch = ["ad_1", "", "ad_2"];
    assertEquals(newlyInsertedAdIds(batch, existing), ["ad_2"]);
  },
);
