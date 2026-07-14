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

const { metaFetch, isInformationalSyncNote, countRealErrors, computeDailyWindowDays, rollupDailyRows } = await import("./index.ts");
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
