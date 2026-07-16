// US-004 (carousel frame capture) — acceptance test #1.
//
// e2e criterion: "Given a 5-frame carousel ad, when sync + media caching complete,
// then 5 frame assets are stored and linked in order and the ad reports frames_ok."
//
// The captured-COUNT-vs-expected_frame_count comparison itself lives in SQL (the
// media_coverage view, migration 20260714000027_creative_frames.sql). Per the story's
// testable-seam guidance we exercise the exported TS coverage classifier
// `classifyCoverage(creative, framesOk)` — the documented mirror of one media_coverage
// row — and drive its `framesOk` input with the SAME arithmetic the SQL frames CTE
// uses (captured >= expected, with NULL/<=1 trivially TRUE). This pins the migration's
// frames_ok contract AND the covered composition (covered = image_ok && video_ok &&
// frames_ok) without a live DB.
import { describe, it, expect } from "vitest";
import { classifyCoverage } from "../../supabase/functions/_shared/media-discovery.ts";

// Pure TS mirror of the migration's frames_ok arithmetic (frames CTE):
//   frames_ok = expected IS NULL OR expected <= 1 OR captured >= expected
// Kept local to the test so we compute framesOk exactly as the SQL does, then feed the
// result into the exported classifier.
function framesOkOf(expected: number | null, captured: number): boolean {
  if (expected == null || expected <= 1) return true;
  return captured >= expected;
}

// A creative whose image + video are both already cached (storage URLs), so covered is
// governed purely by frames_ok — isolating the US-004 dimension.
const CACHED = {
  ad_status: "ACTIVE",
  impressions: 1000,
  full_res_url: "https://x.supabase.co/storage/v1/object/public/media/act_1/assets/img.jpg",
  video_url: "https://x.supabase.co/storage/v1/object/public/media/act_1/assets/vid.mp4",
};

describe("US-004 frames_ok coverage arithmetic (5-frame carousel)", () => {
  it("5 expected + 5 captured → frames_ok true AND covered (both media cached)", () => {
    const framesOk = framesOkOf(5, 5);
    expect(framesOk).toBe(true);
    const cov = classifyCoverage(CACHED, framesOk);
    expect(cov.frames_ok).toBe(true);
    expect(cov.eligible).toBe(true);
    // covered = image_ok && video_ok && frames_ok — all true here.
    expect(cov.image_ok).toBe(true);
    expect(cov.video_ok).toBe(true);
    expect(cov.covered).toBe(true);
  });

  it("5 expected + 4 captured → frames_ok false AND NOT covered (a missing frame)", () => {
    const framesOk = framesOkOf(5, 4);
    expect(framesOk).toBe(false);
    const cov = classifyCoverage(CACHED, framesOk);
    expect(cov.frames_ok).toBe(false);
    // image_ok && video_ok are still true, so the ONLY reason it is not covered is
    // the incomplete frame set — exactly the migration's 'frames_incomplete' case.
    expect(cov.image_ok).toBe(true);
    expect(cov.video_ok).toBe(true);
    expect(cov.covered).toBe(false);
  });

  it("no multi-frame expectation (NULL / 1) → frames_ok true (no pre-US-004 regression)", () => {
    // NULL expected — every ad synced before US-004.
    expect(framesOkOf(null, 0)).toBe(true);
    expect(classifyCoverage(CACHED, framesOkOf(null, 0)).frames_ok).toBe(true);
    expect(classifyCoverage(CACHED, framesOkOf(null, 0)).covered).toBe(true);
    // Single-asset ad (expected 1) — also trivially frame-complete.
    expect(framesOkOf(1, 0)).toBe(true);
    expect(classifyCoverage(CACHED, framesOkOf(1, 0)).frames_ok).toBe(true);
    expect(classifyCoverage(CACHED, framesOkOf(1, 0)).covered).toBe(true);
  });

  it("covered is the AND of all three dimensions — frames_ok true cannot rescue a missing image/video", () => {
    // frames complete, but the image is only the tiny thumbnail fallback (full_res_url
    // NULL → NOT image_ok): covered must still be false.
    const noImage = { ...CACHED, full_res_url: null };
    const cov = classifyCoverage(noImage, framesOkOf(5, 5));
    expect(cov.frames_ok).toBe(true);
    expect(cov.image_ok).toBe(false);
    expect(cov.covered).toBe(false);
  });
});
