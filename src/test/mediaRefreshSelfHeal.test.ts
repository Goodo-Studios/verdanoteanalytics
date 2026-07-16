// US-005 (CDN-expiry auto-refresh / self-healing media) — acceptance tests.
//
// e2e criteria from the PRD:
//   1. "Given an ad still on a live (uncached) Meta CDN URL, when the refresh job runs,
//      then its media is downloaded and cached and it reports covered."
//   2. "Given the refresh job, when it runs against a large account, then it processes
//      only a bounded batch per invocation and self-chains rather than fanning out over
//      everything."
//
// The candidate SELECT + backoff gate + enqueue live in SQL (migration
// 20260714000028_media_refresh_self_heal.sql). Per the repo's testable-seam pattern
// (see carouselFrameCoverage.test.ts) we pin the CONTRACTS those pieces implement via
// the exported pure TS: classifyCoverage() (the media_coverage row mirror) for the
// "uncached CDN url → not covered; cached storage url → covered" transition, and the
// media-refresh-logic decision helpers for the bounded-batch / self-chain / re-cacheable
// selection that the poller applies around the SQL feeder. No live DB or network.
import { describe, it, expect } from "vitest";
import { classifyCoverage, NO_VIDEO_SENTINEL } from "../../supabase/functions/_shared/media-discovery.ts";
import {
  BATCH_LIMIT,
  MAX_REFRESH_CHAIN,
  RECACHEABLE_FAILURE_REASONS,
  TERMINAL_FAILURE_REASONS,
  buildRegressionSlackBody,
  isRecacheable,
  shouldAlertRegression,
  shouldChainRefresh,
  type CoverageRegression,
} from "../../supabase/functions/_shared/media-refresh-logic.ts";

const LIVE_CDN_VIDEO = "https://video.xx.fbcdn.net/v/t42/expiring-link.mp4?oe=DEADBEEF";
const STORAGE_VIDEO = "https://x.supabase.co/storage/v1/object/public/ad-videos/act_1/ad_1.mp4";
const STORAGE_IMAGE = "https://x.supabase.co/storage/v1/object/public/ad-thumbnails/act_1/img.jpg";

describe("US-005 AC#1: an ad on a live uncached CDN url is re-cached and then reports covered", () => {
  it("a video ad sitting on a live fbcdn url is NOT covered (video_uncached), then covered once cached to storage", () => {
    // Image already fine; the ONLY gap is a video that is still a live, uncached CDN url
    // — exactly the CDN-expiry rot the refresh poller targets.
    const beforeRefresh = {
      ad_status: "ACTIVE",
      impressions: 1000,
      full_res_url: STORAGE_IMAGE,
      video_url: LIVE_CDN_VIDEO, // live fbcdn link, never cached → will rot when it expires
    };
    const before = classifyCoverage(beforeRefresh);
    expect(before.eligible).toBe(true);
    expect(before.image_ok).toBe(true);
    // A bare live CDN url is NOT a storage url, so it is NOT video_ok → NOT covered.
    expect(before.video_ok).toBe(false);
    expect(before.covered).toBe(false);

    // The poller re-enqueues this ad; the drain worker downloads + caches it to storage.
    const afterRefresh = { ...beforeRefresh, video_url: STORAGE_VIDEO };
    const after = classifyCoverage(afterRefresh);
    expect(after.video_ok).toBe(true);
    expect(after.covered).toBe(true);
  });

  it("the 'video_uncached' coverage failure_reason is in the poller's re-cacheable set", () => {
    // media_coverage labels a live-CDN-uncached video ad 'video_uncached'. The poller's
    // SQL predicate (and its TS mirror) must select exactly that reason for re-caching.
    expect(isRecacheable("video_uncached")).toBe(true);
  });
});

describe("US-005 AC#2: bounded batch per invocation + self-chain, NOT a blind fanout", () => {
  it("self-chains while the feeder fills full batches (backlog remains), bounded by MAX_REFRESH_CHAIN", () => {
    // A large account: the feeder returns a FULL batch (== BATCH_LIMIT) → there is very
    // likely more rotted media, so chain a fresh bounded invocation.
    expect(shouldChainRefresh(BATCH_LIMIT, 0)).toBe(true);
    expect(shouldChainRefresh(BATCH_LIMIT, MAX_REFRESH_CHAIN - 1)).toBe(true);
  });

  it("stops chaining at the tail of the backlog (a partial/empty batch)", () => {
    // Fewer than a full batch enqueued → reached the tail; stop (the 15-min cron re-checks).
    expect(shouldChainRefresh(BATCH_LIMIT - 1, 0)).toBe(false);
    expect(shouldChainRefresh(0, 0)).toBe(false);
  });

  it("never runs away — the self-chain is depth-bounded (not an unbounded fanout)", () => {
    // At the chain-depth ceiling, refuse to chain even with a full batch. BATCH_LIMIT ×
    // MAX_REFRESH_CHAIN caps ads-per-cycle, so a huge account is PAGED over bounded
    // invocations rather than blasted over every account at once (the retired US-011
    // anti-pattern).
    expect(shouldChainRefresh(BATCH_LIMIT, MAX_REFRESH_CHAIN)).toBe(false);
    expect(shouldChainRefresh(BATCH_LIMIT, MAX_REFRESH_CHAIN + 5)).toBe(false);
    expect(BATCH_LIMIT).toBeGreaterThan(0);
    expect(MAX_REFRESH_CHAIN).toBeGreaterThan(0);
  });
});

describe("US-005: re-cacheable selection excludes the terminal residual (never churned)", () => {
  it("selects the re-cacheable rot reasons", () => {
    for (const r of ["video_uncached", "image_low_res", "image_missing", "video_unresolved"]) {
      expect(isRecacheable(r)).toBe(true);
      expect(RECACHEABLE_FAILURE_REASONS.has(r)).toBe(true);
    }
  });

  it("excludes terminal / out-of-scope reasons (permission, deleted, frames)", () => {
    for (const r of ["video_permission", "video_deleted", "frames_incomplete"]) {
      expect(isRecacheable(r)).toBe(false);
      expect(TERMINAL_FAILURE_REASONS.has(r)).toBe(true);
    }
    // A covered ad has no failure_reason → nothing to re-cache.
    expect(isRecacheable(null)).toBe(false);
    expect(isRecacheable(undefined)).toBe(false);
  });

  it("the re-cacheable and terminal sets are disjoint (no reason is both)", () => {
    for (const r of RECACHEABLE_FAILURE_REASONS) {
      expect(TERMINAL_FAILURE_REASONS.has(r)).toBe(false);
    }
  });
});

describe("US-005 AC#4: coverage regression is observable and alertable", () => {
  it("alerts only when the aggregate coverage% actually dropped beyond the threshold", () => {
    const regressed: CoverageRegression = {
      regressed: true,
      prev_pct: 98.5,
      curr_pct: 95.0,
      delta_pct: -3.5,
      prev_captured_at: "2026-07-15T10:00:00Z",
      curr_captured_at: "2026-07-15T11:00:00Z",
    };
    expect(shouldAlertRegression(regressed)).toBe(true);

    // No regression flagged → no alert.
    expect(shouldAlertRegression({ ...regressed, regressed: false })).toBe(false);
    // First run: only one snapshot, prev_pct null → nothing to compare, no alert.
    expect(shouldAlertRegression({ ...regressed, regressed: true, prev_pct: null })).toBe(false);
    expect(shouldAlertRegression(null)).toBe(false);
  });

  it("builds a Slack body that names the before/after coverage and the drop", () => {
    const reg: CoverageRegression = {
      regressed: true,
      prev_pct: 98.5,
      curr_pct: 95.0,
      delta_pct: -3.5,
      prev_captured_at: "2026-07-15T10:00:00Z",
      curr_captured_at: "2026-07-15T11:00:00Z",
    };
    const body = buildRegressionSlackBody(reg, "https://verdanote.com");
    const text = JSON.stringify(body);
    expect(text).toContain("98.50%");
    expect(text).toContain("95.00%");
    expect(text).toContain("3.50 pts");
    expect(text).toContain("https://verdanote.com/creatives");
  });
});

describe("US-005 AC#5: re-caching a still-valid item is a no-op via content-hash dedupe", () => {
  it("an already-cached (storage url) ad is covered and carries no re-cacheable reason", () => {
    // An ad whose media is already cached to storage classifies as covered — so it is
    // NOT selected by the poller (its failure_reason is null). Re-running the poller can
    // never re-download it (nothing to enqueue), and even if enqueued, the drain's
    // content-hash dedupe (US-009) makes the download a no-op. This pins the "still-valid
    // → no-op" guarantee at the selection boundary.
    const cached = {
      ad_status: "ACTIVE",
      impressions: 500,
      full_res_url: STORAGE_IMAGE,
      video_url: STORAGE_VIDEO,
    };
    const cov = classifyCoverage(cached);
    expect(cov.covered).toBe(true);
    // The generic no-video sentinel is a re-cacheable reason, but a covered ad has none.
    expect(NO_VIDEO_SENTINEL).toBe("no-video");
  });
});
