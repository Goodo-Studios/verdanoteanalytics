// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/preview-drain-logic.test.ts
//
// Covers the preview-capture pure decision logic: rescue enqueue gating (media-intent,
// no archive-id gate), drain batch selection/ordering (capture_status='pending'), and
// the preview-capture health findings. Style mirrors preview-capture-logic.test.ts.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type DrainCandidate,
  isCaptureCovered,
  previewCaptureHealthFindings,
  rescueEnqueueDecision,
  selectDrainBatch,
} from "./preview-drain-logic.ts";

const STORAGE = "https://x.supabase.co/storage/v1/object/public/ad-videos/a/assets/h.mp4";
const CDN = "https://video.fbcdn.net/v/x.mp4"; // expiring CDN, NOT owned

// ── rescueEnqueueDecision: resolution-status gate (AC#1/#2) ───────────────────

Deno.test("rescue: resolved + first-attempt hard failure → enqueue (new-ad fast path)", () => {
  const d = rescueEnqueueDecision({
    outcome: "failed",
    reasons: ["expired"],
    attempts: 1,
    maxAttempts: 5,
    hasMediaIntent: true,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, true);
  assertEquals(d.trigger, "new_ad_first_attempt");
});

Deno.test("rescue: no media intent (no video ids, not an image ad) → never enqueue", () => {
  const d = rescueEnqueueDecision({
    outcome: "failed",
    reasons: ["no-video"],
    attempts: 1,
    maxAttempts: 5,
    hasMediaIntent: false,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, false);
  assertEquals(d.skip, "no_media_intent");
});

Deno.test("rescue: no media intent even for a terminal video sentinel → never enqueue", () => {
  const d = rescueEnqueueDecision({
    outcome: "skipped",
    reasons: ["no-video-permission"],
    attempts: 1,
    maxAttempts: 5,
    hasMediaIntent: false,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, false);
  assertEquals(d.skip, "no_media_intent");
});

// ── rescueEnqueueDecision: trigger cases (AC#1) ───────────────────────────────

Deno.test("rescue: terminal video sentinel (permission) → enqueue on first sight, any attempt", () => {
  for (const reason of ["no-video-permission", "no-video-deleted"]) {
    const d = rescueEnqueueDecision({
      outcome: "skipped",
      reasons: [reason],
      attempts: 1, // even the first attempt
      maxAttempts: 5,
      hasMediaIntent: true,
      alreadyCovered: false,
      captureStatus: null,
    });
    assertEquals(d.enqueue, true, reason);
    assertEquals(d.trigger, "terminal_video_sentinel", reason);
  }
});

Deno.test("rescue: exhausted retries on video_unresolved/image_missing → enqueue", () => {
  const d = rescueEnqueueDecision({
    outcome: "skipped",
    reasons: ["no-video"],
    attempts: 5,
    maxAttempts: 5,
    hasMediaIntent: true,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, true);
  assertEquals(d.trigger, "retries_exhausted");
});

Deno.test("rescue: mid-retry media gap (not first, not exhausted) → keep retrying via Meta", () => {
  const d = rescueEnqueueDecision({
    outcome: "failed",
    reasons: ["expired"],
    attempts: 3,
    maxAttempts: 5,
    hasMediaIntent: true,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, false);
  assertEquals(d.skip, "retrying");
});

// ── rescueEnqueueDecision: never-enqueue guards (AC#4 + idempotency) ───────────

Deno.test("rescue: already-covered → never (AC#4)", () => {
  const d = rescueEnqueueDecision({
    outcome: "failed",
    reasons: ["no-video"],
    attempts: 1,
    maxAttempts: 5,
    hasMediaIntent: true,
    alreadyCovered: true,
    captureStatus: null,
  });
  assertEquals(d.enqueue, false);
  assertEquals(d.skip, "already_covered");
});

Deno.test("rescue: existing apify lifecycle → never overwrite", () => {
  for (const st of ["pending", "captured", "failed", "skipped"]) {
    const d = rescueEnqueueDecision({
      outcome: "failed",
      reasons: ["no-video"],
      attempts: 1,
      maxAttempts: 5,
      hasMediaIntent: true,
      alreadyCovered: false,
      captureStatus: st,
    });
    assertEquals(d.enqueue, false, st);
    assertEquals(d.skip, "already_queued", st);
  }
});

Deno.test("rescue: a Meta throttle is inconclusive → never rescue on it", () => {
  const d = rescueEnqueueDecision({
    outcome: "throttled",
    reasons: ["rate-limited"],
    attempts: 1,
    maxAttempts: 5,
    hasMediaIntent: true,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, false);
  assertEquals(d.skip, "throttled");
});

Deno.test("rescue: cached (media landed) → nothing to rescue", () => {
  const d = rescueEnqueueDecision({
    outcome: "cached",
    reasons: [],
    attempts: 1,
    maxAttempts: 5,
    hasMediaIntent: true,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, false);
  assertEquals(d.skip, "media_ok");
});

Deno.test("rescue: oversized video is EXCLUDED from gap reasons (Apify would refetch same)", () => {
  const d = rescueEnqueueDecision({
    outcome: "skipped",
    reasons: ["no-video-oversized"],
    attempts: 1,
    maxAttempts: 5,
    hasMediaIntent: true,
    alreadyCovered: false,
    captureStatus: null,
  });
  assertEquals(d.enqueue, false);
  assertEquals(d.skip, "media_ok");
});

// ── selectDrainBatch (AC#3) ───────────────────────────────────────────────────

function cand(over: Partial<DrainCandidate>): DrainCandidate {
  return {
    ad_id: "1",
    account_id: "act_1",
    created_time: "2026-07-01T00:00:00Z",
    capture_status: "pending",
    video_url: null,
    full_res_url: null,
    ...over,
  };
}

Deno.test("selectDrainBatch: newest-first by created_time, sliced to batchSize", () => {
  const rows = [
    cand({ ad_id: "old", created_time: "2026-07-01T00:00:00Z" }),
    cand({ ad_id: "new", created_time: "2026-07-20T00:00:00Z" }),
    cand({ ad_id: "mid", created_time: "2026-07-10T00:00:00Z" }),
  ];
  const out = selectDrainBatch(rows, 2);
  assertEquals(out.map((r) => r.ad_id), ["new", "mid"]);
});

Deno.test("selectDrainBatch: null created_time sorts last (treated as oldest)", () => {
  const rows = [
    cand({ ad_id: "nulldate", created_time: null }),
    cand({ ad_id: "dated", created_time: "2026-07-05T00:00:00Z" }),
  ];
  const out = selectDrainBatch(rows, 5);
  assertEquals(out.map((r) => r.ad_id), ["dated", "nulldate"]);
});

Deno.test("selectDrainBatch: filters non-pending and already-covered (no archive-id gate)", () => {
  const rows = [
    cand({ ad_id: "ok" }),
    cand({ ad_id: "not-pending", capture_status: "captured" }),
    cand({ ad_id: "covered-video", video_url: STORAGE }),
    cand({ ad_id: "covered-static", full_res_url: STORAGE }),
    cand({ ad_id: "cdn-only-ok", video_url: CDN }), // CDN url is NOT owned → still drainable
  ];
  const out = selectDrainBatch(rows, 10);
  assertEquals(out.map((r) => r.ad_id).sort(), ["cdn-only-ok", "ok"]);
});

// ── selectDrainBatch: retry-eligibility (the prod stall regression) ────────────
// Fixed clock: rows attempted <30 min ago are in backoff (30min * 2^(attempts-1)).
const NOW = Date.parse("2026-07-22T22:00:00Z");
const MIN = 60_000;

Deno.test("selectDrainBatch: excludes rows still inside their retry-backoff window", () => {
  const rows = [
    // attempted 5 min ago (attempts=1 → 30-min window) → NOT eligible yet.
    cand({
      ad_id: "backoff",
      capture_attempts: 1,
      capture_last_attempt_at: new Date(NOW - 5 * MIN).toISOString(),
    }),
    // never attempted → always eligible.
    cand({ ad_id: "untried", capture_attempts: 0, capture_last_attempt_at: null }),
    // attempted 45 min ago (attempts=1 → 30-min window elapsed) → eligible again.
    cand({
      ad_id: "past-backoff",
      capture_attempts: 1,
      capture_last_attempt_at: new Date(NOW - 45 * MIN).toISOString(),
    }),
  ];
  const out = selectDrainBatch(rows, 10, NOW);
  assertEquals(out.map((r) => r.ad_id).sort(), ["past-backoff", "untried"]);
});

Deno.test("selectDrainBatch: excludes terminal rows past the attempt cap", () => {
  const rows = [
    cand({ ad_id: "terminal", capture_attempts: 3, capture_last_attempt_at: new Date(NOW - 999 * MIN).toISOString() }),
    cand({ ad_id: "untried" }),
  ];
  const out = selectDrainBatch(rows, 10, NOW);
  assertEquals(out.map((r) => r.ad_id), ["untried"]);
});

Deno.test("selectDrainBatch: backoff rows at the ad_id-DESC head do NOT starve untried rows (prod stall)", () => {
  // Reproduces the prod stall: the whole backlog shares ONE bulk-import created_time,
  // so "newest-first" degenerates to the ad_id DESC tiebreak. The highest-ad_id rows
  // happen to be already-attempted + in backoff. Before the fix they were re-selected
  // every tick (skipped/backoff) and starved the never-attempted rows behind them.
  const ONE_TIME = "2026-05-29T10:11:44Z";
  const recent = new Date(NOW - 2 * MIN).toISOString(); // inside the 30-min window
  const rows = [
    // Highest ad_ids, attempted 2 min ago → in backoff (the poison rows).
    cand({ ad_id: "z-9999-b", created_time: ONE_TIME, capture_attempts: 2, capture_last_attempt_at: recent }),
    cand({ ad_id: "z-9998-b", created_time: ONE_TIME, capture_attempts: 2, capture_last_attempt_at: recent }),
    cand({ ad_id: "z-9997-b", created_time: ONE_TIME, capture_attempts: 2, capture_last_attempt_at: recent }),
    // Never-attempted rows behind them (lower ad_ids).
    cand({ ad_id: "a-0003", created_time: ONE_TIME }),
    cand({ ad_id: "a-0002", created_time: ONE_TIME }),
    cand({ ad_id: "a-0001", created_time: ONE_TIME }),
  ];
  const out = selectDrainBatch(rows, 3, NOW);
  // The batch must be the drainable untried rows, NOT the backoff poison rows.
  assertEquals(out.map((r) => r.ad_id), ["a-0003", "a-0002", "a-0001"]);
});

Deno.test("isCaptureCovered: owned storage url only, not an expiring CDN url", () => {
  assertEquals(isCaptureCovered({ video_url: STORAGE, full_res_url: null }), true);
  assertEquals(isCaptureCovered({ video_url: null, full_res_url: STORAGE }), true);
  assertEquals(isCaptureCovered({ video_url: CDN, full_res_url: null }), false);
  assertEquals(isCaptureCovered({ video_url: null, full_res_url: null }), false);
});

// ── previewCaptureHealthFindings ──────────────────────────────────────────────

Deno.test("health: >50% failure over 6h (above min sample) → fail finding", () => {
  const f = previewCaptureHealthFindings({ attempts6h: 20, failures6h: 12, queueDepth: 0 });
  assertEquals(f.length, 1);
  assertEquals(f[0].severity, "fail");
  assertEquals(f[0].category, "preview_capture");
});

Deno.test("health: failure rate above threshold but below min sample → no spike finding", () => {
  const f = previewCaptureHealthFindings({ attempts6h: 4, failures6h: 3, queueDepth: 0 });
  assertEquals(f.length, 1);
  assertEquals(f[0].severity, "pass"); // too few attempts to trust the rate
});

Deno.test("health: queue depth > 200 → warn finding", () => {
  const f = previewCaptureHealthFindings({ attempts6h: 0, failures6h: 0, queueDepth: 201 });
  assertEquals(f.some((x) => x.severity === "warn" && /queue depth/i.test(x.message)), true);
});

Deno.test("health: Tier-B iframe 400 drift (above min sample) → fail finding", () => {
  const f = previewCaptureHealthFindings({
    attempts6h: 0, failures6h: 0, queueDepth: 0, iframeAttempts6h: 20, iframe400s6h: 8,
  });
  assertEquals(f.some((x) => x.severity === "fail" && /iframe HTTP-400/i.test(x.message)), true);
});

Deno.test("health: iframe 400 rate high but below min sample → no drift finding", () => {
  const f = previewCaptureHealthFindings({
    attempts6h: 0, failures6h: 0, queueDepth: 0, iframeAttempts6h: 4, iframe400s6h: 3,
  });
  assertEquals(f.length, 1);
  assertEquals(f[0].severity, "pass");
});

Deno.test("health: all clean → single pass finding", () => {
  const f = previewCaptureHealthFindings({
    attempts6h: 30, failures6h: 1, queueDepth: 5, iframeAttempts6h: 20, iframe400s6h: 0,
  });
  assertEquals(f.length, 1);
  assertEquals(f[0].severity, "pass");
});

Deno.test("health: multiple problems → multiple findings, no pass", () => {
  const f = previewCaptureHealthFindings({
    attempts6h: 40, failures6h: 30, queueDepth: 500, iframeAttempts6h: 20, iframe400s6h: 12,
  });
  assertEquals(f.length, 3);
  assertEquals(f.some((x) => x.severity === "pass"), false);
});
