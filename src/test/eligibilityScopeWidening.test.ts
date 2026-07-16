// US-006 (widen eligibility — archived + zero-impression ads) — acceptance tests.
//
// e2e criteria:
//   "Given an account with include_archived enabled, when sync runs, then archived
//    ads appear in creatives and count toward eligibility."
//   "Given an account with the flags disabled, when sync runs, then behavior matches
//    today (no archived/zero-impression ads) and coverage is measured only against
//    active/delivered ads."
//
// The sync-side fetch widening (campaign effective_status + the impressions>0
// deliveredFilter in supabase/functions/sync/index.ts) needs a live Meta account to
// exercise end-to-end. Per this project's testable-seam convention (see
// carouselFrameCoverage.test.ts) we pin the *eligibility contract* — the single
// documented predicate that decides what "counts toward coverage" — via the exported
// TS mirror `isEligibleForCoverage(creative, scope)`. This is the exact mirror of the
// widened WHERE clause in the public.media_coverage view (migration
// 20260714000029_ad_accounts_scope_flags.sql):
//     (NOT archived  OR scope.include_archived)
// AND (impressions>0 OR scope.include_zero_impression)
// Keeping both sides pinned here is what prevents the DB metric and the TS callers
// from drifting apart (the US-001 invariant the story reasserts).
import { describe, it, expect } from "vitest";
import {
  isEligibleForCoverage,
  classifyCoverage,
} from "../../supabase/functions/_shared/media-discovery.ts";

const ARCHIVED = { ad_status: "ARCHIVED", impressions: 999 };
const ZERO_IMP = { ad_status: "ACTIVE", impressions: 0 };
const NULL_IMP = { ad_status: "ACTIVE", impressions: null };
const ARCHIVED_ZERO = { ad_status: "ARCHIVED", impressions: 0 };
const NORMAL = { ad_status: "ACTIVE", impressions: 10 };

describe("US-006 default scope (both flags off) — behavior matches today", () => {
  it("no scope arg → identical to the US-001 predicate", () => {
    // A call with no scope is the byte-for-byte US-001 predicate: this is what
    // guarantees no behavior change for accounts that have not opted in.
    expect(isEligibleForCoverage(NORMAL)).toBe(true);
    expect(isEligibleForCoverage(ARCHIVED)).toBe(false);
    expect(isEligibleForCoverage(ZERO_IMP)).toBe(false);
    expect(isEligibleForCoverage(NULL_IMP)).toBe(false);
  });

  it("explicit both-false scope → still excludes archived + zero-impression", () => {
    const off = { include_archived: false, include_zero_impression: false };
    expect(isEligibleForCoverage(ARCHIVED, off)).toBe(false);
    expect(isEligibleForCoverage(ZERO_IMP, off)).toBe(false);
    expect(isEligibleForCoverage(ARCHIVED_ZERO, off)).toBe(false);
    expect(isEligibleForCoverage(NORMAL, off)).toBe(true);
  });
});

describe("US-006 include_archived — archived ads count toward eligibility", () => {
  it("archived ad becomes eligible ONLY when include_archived is on", () => {
    expect(isEligibleForCoverage(ARCHIVED, { include_archived: false })).toBe(false);
    expect(isEligibleForCoverage(ARCHIVED, { include_archived: true })).toBe(true);
  });

  it("case-insensitive: lowercase 'archived' honors the flag too", () => {
    const lower = { ad_status: "archived", impressions: 5 };
    expect(isEligibleForCoverage(lower, { include_archived: false })).toBe(false);
    expect(isEligibleForCoverage(lower, { include_archived: true })).toBe(true);
  });

  it("include_archived alone does NOT admit a zero-impression archived ad", () => {
    // Both predicates must pass: an ARCHIVED + impressions=0 ad needs BOTH flags.
    expect(isEligibleForCoverage(ARCHIVED_ZERO, { include_archived: true })).toBe(false);
    expect(
      isEligibleForCoverage(ARCHIVED_ZERO, {
        include_archived: true,
        include_zero_impression: true,
      }),
    ).toBe(true);
  });
});

describe("US-006 include_zero_impression — zero-impression ads count toward eligibility", () => {
  it("impressions=0 ad becomes eligible ONLY when include_zero_impression is on", () => {
    expect(isEligibleForCoverage(ZERO_IMP, { include_zero_impression: false })).toBe(false);
    expect(isEligibleForCoverage(ZERO_IMP, { include_zero_impression: true })).toBe(true);
  });

  it("null impressions is treated as zero (eligible only when flag on)", () => {
    expect(isEligibleForCoverage(NULL_IMP, { include_zero_impression: false })).toBe(false);
    expect(isEligibleForCoverage(NULL_IMP, { include_zero_impression: true })).toBe(true);
  });

  it("include_zero_impression alone does NOT admit an archived ad", () => {
    expect(isEligibleForCoverage(ARCHIVED, { include_zero_impression: true })).toBe(false);
  });
});

describe("US-006 classifyCoverage threads the scope through eligibility", () => {
  const CACHED = {
    full_res_url:
      "https://x.supabase.co/storage/v1/object/public/media/act_1/assets/img.jpg",
    video_url:
      "https://x.supabase.co/storage/v1/object/public/media/act_1/assets/vid.mp4",
  };

  it("an archived, fully-cached ad is NOT eligible by default but IS covered-eligible when opted in", () => {
    const archivedCached = { ...ARCHIVED, ...CACHED };
    // Default scope: not part of the measured universe at all.
    const off = classifyCoverage(archivedCached, true);
    expect(off.eligible).toBe(false);
    // image/video classification is independent of eligibility and still computes.
    expect(off.image_ok).toBe(true);
    expect(off.video_ok).toBe(true);

    // Opted in: now eligible AND (media cached) covered — it joins the numerator.
    const on = classifyCoverage(archivedCached, true, { include_archived: true });
    expect(on.eligible).toBe(true);
    expect(on.covered).toBe(true);
  });
});
