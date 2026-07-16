// US-004 follow-up (meta-media-completeness) — completeness-tightening tests for the
// "expected frame count" side of frames_ok.
//
// Two conservative gaps flagged in the US-004 review are closed here:
//   1. expectedFrameCount() only counted carousel child_attachments, so a dynamic-
//      creative / Advantage+ ad whose multiple frames come from asset_feed_spec.videos
//      returned null → expected_frame_count never set → frames_ok trivially TRUE even
//      though the frames ARE captured into creative_frames. It now mirrors deriveFrames
//      exactly, so that shape declares its expectation and completeness is enforced.
//   2. Tagged ads route through the bulk_update_creative_metadata RPC (metadata-only,
//      to preserve tags), which did not write expected_frame_count. The sync now threads
//      it into that payload and the RPC updates it (COALESCE, never clobbering to null).
//
// The pure derivations live on the Deno-free shared seam (../_shared/media-discovery.ts),
// the same seam classifyCoverage / carouselFrameCoverage.test.ts use, so they unit-test
// without a live DB or Deno. The tagged-ad plumbing (gap 2) is exercised source-invariantly
// — reading the sync source + the RPC migration — exactly like syncPhaseErrorHandling.test.ts,
// because the sync edge function touches Deno at module load and cannot be imported here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  deriveFrames,
  expectedFrameCount,
} from "../../supabase/functions/_shared/media-discovery.ts";

// ── Builders for the Meta creative spec shapes the sync sees ────────────────────
const carousel = (n: number) => ({
  object_story_spec: {
    link_data: {
      child_attachments: Array.from({ length: n }, (_, i) => ({
        picture: `https://cdn.example/card${i}.jpg`,
      })),
    },
  },
});
const dynamicVideos = (n: number) => ({
  asset_feed_spec: {
    videos: Array.from({ length: n }, (_, i) => ({
      video_id: `v${i}`,
      thumbnail_url: `https://cdn.example/vthumb${i}.jpg`,
    })),
  },
});
const dynamicImages = (n: number) => ({
  asset_feed_spec: {
    images: Array.from({ length: n }, (_, i) => ({ hash: `h${i}` })),
  },
});
const singleImage = { object_story_spec: { link_data: { picture: "https://cdn.example/one.jpg" } } };
const singleVideo = { object_story_spec: { video_data: { video_id: "v-solo" } } };

describe("US-004 expectedFrameCount — single-asset ads stay frames_ok-trivial (no regression)", () => {
  it("single image ad → null (no expectation, frames_ok trivially TRUE)", () => {
    expect(expectedFrameCount(singleImage)).toBeNull();
    expect(deriveFrames(singleImage)).toEqual([]);
  });

  it("single video ad → null", () => {
    expect(expectedFrameCount(singleVideo)).toBeNull();
    expect(deriveFrames(singleVideo)).toEqual([]);
  });

  it("degenerate specs (null / empty / one-card carousel / one dynamic video) → null", () => {
    expect(expectedFrameCount(null)).toBeNull();
    expect(expectedFrameCount({})).toBeNull();
    expect(expectedFrameCount(carousel(1))).toBeNull(); // a single card is not multi-frame
    expect(expectedFrameCount(dynamicVideos(1))).toBeNull();
    // A single-asset ad must NEVER produce a ledger (a row would be coverage noise).
    expect(deriveFrames(carousel(1))).toEqual([]);
    expect(deriveFrames(dynamicVideos(1))).toEqual([]);
  });
});

describe("US-004 expectedFrameCount — genuine multi-frame ads declare their expectation", () => {
  it("5-card carousel → 5, ledger has 5 ordered carousel frames", () => {
    expect(expectedFrameCount(carousel(5))).toBe(5);
    const frames = deriveFrames(carousel(5));
    expect(frames).toHaveLength(5);
    expect(frames.map((f) => f.frame_index)).toEqual([0, 1, 2, 3, 4]);
    expect(frames.every((f) => f.media_type === "carousel_frame")).toBe(true);
  });

  it("GAP 1: dynamic-creative asset_feed_spec.videos (>1) → count (was null → frames_ok never enforced)", () => {
    // The core regression the review flagged: this shape's frames ARE captured into
    // creative_frames, but expected_frame_count used to be null so frames_ok was
    // trivially TRUE. It must now equal the number of video variants.
    expect(expectedFrameCount(dynamicVideos(3))).toBe(3);
    const frames = deriveFrames(dynamicVideos(3));
    expect(frames).toHaveLength(3);
    expect(frames.every((f) => f.media_type === "video")).toBe(true);
  });

  it("asset_feed_spec.images (>1) → null (deliberately NOT enforced — never guess)", () => {
    // deriveFrames does not capture image variants (they carry hashes, not resolvable
    // ordered frame urls, and are not rendered as frames). Declaring an expectation for
    // them would create a PERMANENT false 'frames_incomplete' (captured would stay 0),
    // violating the migration-20260714000027 never-guess rule. So it stays null.
    expect(expectedFrameCount(dynamicImages(4))).toBeNull();
    expect(deriveFrames(dynamicImages(4))).toEqual([]);
  });
});

describe("US-004 lockstep invariant — expected count can never exceed capturable frames", () => {
  // This is what structurally forbids a false 'frames_incomplete': expected_frame_count
  // is DERIVED from deriveFrames().length, so a fully-captured multi-frame ad always
  // reaches frames_ok (captured >= expected) and expected never outruns the ledger.
  const shapes = [
    singleImage, singleVideo, {}, null,
    carousel(1), carousel(2), carousel(9),
    dynamicVideos(1), dynamicVideos(2), dynamicVideos(6),
    dynamicImages(3),
  ];
  it("expectedFrameCount(c) === (deriveFrames(c).length > 1 ? length : null) for every shape", () => {
    for (const c of shapes) {
      const captured = deriveFrames(c).length;
      const expectedNumber = captured > 1 ? captured : null;
      expect(expectedFrameCount(c)).toBe(expectedNumber);
      // And the expectation, when set, never exceeds what the ledger can hold.
      const exp = expectedFrameCount(c);
      if (exp != null) expect(exp).toBeLessThanOrEqual(captured);
    }
  });
});

// ── GAP 2: tagged-ad completeness plumbing (source-invariant guards) ────────────
// The sync edge function imports Deno at module load, so (like syncPhaseErrorHandling)
// we read the source + the RPC migration directly to pin the contract.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SYNC_SRC = readFileSync(path.join(REPO, "supabase/functions/sync/index.ts"), "utf8");
const RPC_MIGRATION = readFileSync(
  path.join(REPO, "supabase/migrations/20260714000031_bulk_metadata_expected_frame_count.sql"),
  "utf8",
);

describe("US-004 GAP 2 — tagged ads are held to the same frames_ok bar", () => {
  it("the sync threads expected_frame_count into the tagged metadata payload, only when set", () => {
    // The tagged branch pushes into metadataBatch; it must include expected_frame_count
    // (guarded by frameCount != null so a single-asset ad omits it and never nulls a
    // prior value). We assert the conditional spread of expected_frame_count appears
    // within the metadataBatch.push(...) call.
    const pushIdx = SYNC_SRC.indexOf("metadataBatch.push");
    expect(pushIdx).toBeGreaterThan(-1);
    const pushBlock = SYNC_SRC.slice(pushIdx, pushIdx + 400);
    expect(pushBlock).toMatch(/frameCount != null \? \{ expected_frame_count: frameCount \} : \{\}/);
  });

  it("the bulk_update_creative_metadata RPC updates expected_frame_count with COALESCE (never clobbers to null)", () => {
    expect(RPC_MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.bulk_update_creative_metadata/);
    expect(RPC_MIGRATION).toMatch(
      /expected_frame_count = COALESCE\(\(item->>'expected_frame_count'\)::integer, expected_frame_count\)/,
    );
  });
});
