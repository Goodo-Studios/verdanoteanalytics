// US-009: within-account media dedupe helpers.
//
// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/media-discovery.test.ts
//
// These cover the two pure helpers that make creative-level dedupe work:
//   - computeContentHash: identical bytes → identical key (dedupe hit);
//     different bytes → different key (no false dedupe).
//   - assetStoragePath: account-scoped, asset-keyed path so the same creative in
//     two accounts never collides (tenant boundary) while the same creative in one
//     account maps to one shared path (within-account dedupe).

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assetStoragePath,
  classifyCoverage,
  computeContentHash,
  isEligibleForCoverage,
  isImageOk,
  isStorageUrl,
  isVideoAd,
  isVideoOk,
} from "./media-discovery.ts";

const STORAGE_IMG =
  "https://gwyxaqoaldnaavkjqquv.supabase.co/storage/v1/object/public/ad-thumbnails/act_1/assets/abc.jpg";
const STORAGE_VID =
  "https://gwyxaqoaldnaavkjqquv.supabase.co/storage/v1/object/public/ad-videos/act_1/ad_9.mp4";
const LIVE_CDN = "https://scontent.xx.fbcdn.net/v/t42.1790-2/xyz.mp4?oh=abc";

const bytesOf = (s: string) => new TextEncoder().encode(s);

Deno.test("computeContentHash is a 64-char SHA-256 hex string", async () => {
  const hash = await computeContentHash(bytesOf("hello world"));
  assertEquals(hash.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
});

Deno.test("computeContentHash matches the known SHA-256 of 'abc'", async () => {
  // Well-known SHA-256("abc") vector — proves the digest is real SHA-256.
  const hash = await computeContentHash(bytesOf("abc"));
  assertEquals(
    hash,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("identical bytes hash identically (the dedupe key is stable)", async () => {
  // Two ads reusing the same creative download the identical bytes → same key →
  // the second is a dedupe hit (no second stored copy).
  const a = await computeContentHash(bytesOf("same-creative-bytes"));
  const b = await computeContentHash(bytesOf("same-creative-bytes"));
  assertEquals(a, b);
});

Deno.test("different bytes hash differently (no false dedupe)", async () => {
  const a = await computeContentHash(bytesOf("creative-one"));
  const b = await computeContentHash(bytesOf("creative-two"));
  assertNotEquals(a, b);
});

Deno.test("computeContentHash accepts an ArrayBuffer as well as Uint8Array", async () => {
  const u8 = bytesOf("buffer-vs-view");
  const fromView = await computeContentHash(u8);
  const fromBuffer = await computeContentHash(u8.buffer.slice(0));
  assertEquals(fromView, fromBuffer);
});

Deno.test("assetStoragePath is account-scoped and asset-keyed", () => {
  const path = assetStoragePath("act_123", "deadbeef", "jpg");
  assertEquals(path, "act_123/assets/deadbeef.jpg");
});

Deno.test("same asset in two accounts → distinct paths (tenant boundary preserved)", () => {
  const key = "deadbeefcafebabe";
  const inA = assetStoragePath("act_A", key, "mp4");
  const inB = assetStoragePath("act_B", key, "mp4");
  assertNotEquals(inA, inB);
  assertEquals(inA.startsWith("act_A/"), true);
  assertEquals(inB.startsWith("act_B/"), true);
});

Deno.test("same asset key in one account → one shared path (within-account dedupe)", () => {
  // Two ads reusing the same creative resolve to the identical stored path.
  const key = "abc123";
  assertEquals(
    assetStoragePath("act_1", key, "jpg"),
    assetStoragePath("act_1", key, "jpg"),
  );
});

Deno.test("assetStoragePath tolerates a leading dot in the extension", () => {
  assertEquals(assetStoragePath("act_1", "hash", ".png"), "act_1/assets/hash.png");
});

// ── US-011: isStorageUrl short-circuit guard ─────────────────────────────────
// The cutover's core guarantee — "cached media is never re-touched" — rests on this
// predicate: a media column holding a permanent Supabase Storage URL means the asset
// is ALREADY cached, so the pipeline must short-circuit BEFORE any re-discovery or
// re-download. Both drain-media-queue and the manual repair/force paths route their
// skip-gate through this one function, so these tests pin the contract shared by both.

Deno.test("isStorageUrl: a public storage URL is recognized as already-cached", () => {
  assertEquals(
    isStorageUrl(
      "https://gwyxaqoaldnaavkjqquv.supabase.co/storage/v1/object/public/ad-videos/act_1/ad_9.mp4",
    ),
    true,
  );
  assertEquals(
    isStorageUrl(
      "https://gwyxaqoaldnaavkjqquv.supabase.co/storage/v1/object/public/ad-thumbnails/act_1/assets/abc.jpg",
    ),
    true,
  );
});

Deno.test("isStorageUrl: a live Meta CDN url is NOT storage (must still be cached)", () => {
  assertEquals(isStorageUrl("https://scontent.xx.fbcdn.net/v/t42.1790-2/xyz.mp4?oh=abc"), false);
});

Deno.test("isStorageUrl: null / sentinel / empty are not storage urls", () => {
  assertEquals(isStorageUrl(null), false);
  assertEquals(isStorageUrl(undefined), false);
  assertEquals(isStorageUrl(""), false);
  assertEquals(isStorageUrl("no-video"), false);
  assertEquals(isStorageUrl("no-thumbnail"), false);
});

// ── US-001: media-coverage classification helpers ────────────────────────────
// These pure helpers are the TS mirror of the public.media_coverage SQL view.
// Both sides MUST agree on "eligible" and on each of image_ok / video_ok /
// frames_ok / covered so the coverage numerator/denominator never drift between
// the DB metric and any TS caller. These tests pin that shared contract.

Deno.test("isEligibleForCoverage: non-archived with impressions is eligible", () => {
  assertEquals(isEligibleForCoverage({ ad_status: "ACTIVE", impressions: 10 }), true);
  assertEquals(isEligibleForCoverage({ ad_status: "PAUSED", impressions: 1 }), true);
  assertEquals(isEligibleForCoverage({ ad_status: "UNKNOWN", impressions: 500 }), true);
});

Deno.test("isEligibleForCoverage: archived or zero-impression is NOT eligible (today's scope)", () => {
  assertEquals(isEligibleForCoverage({ ad_status: "ARCHIVED", impressions: 999 }), false);
  assertEquals(isEligibleForCoverage({ ad_status: "archived", impressions: 999 }), false); // case-insensitive
  assertEquals(isEligibleForCoverage({ ad_status: "ACTIVE", impressions: 0 }), false);
  assertEquals(isEligibleForCoverage({ ad_status: "ACTIVE", impressions: null }), false);
});

Deno.test("isImageOk: a cached full-res image is ok", () => {
  assertEquals(isImageOk({ full_res_url: STORAGE_IMG }), true);
});

Deno.test("isImageOk: the ~130px thumbnail fallback (full_res_url NULL) is NOT image_ok", () => {
  // Root-cause of blurry statics: the only image is the tiny thumbnail fallback,
  // which never populates full_res_url. That ad must report NOT image_ok.
  assertEquals(isImageOk({ full_res_url: null }), false);
  assertEquals(isImageOk({ full_res_url: undefined }), false);
  assertEquals(isImageOk({ full_res_url: "" }), false);
  assertEquals(isImageOk({ full_res_url: "no-thumbnail" }), false);
});

Deno.test("isVideoAd: only a populated video_url counts as a video ad", () => {
  assertEquals(isVideoAd({ video_url: STORAGE_VID }), true);
  assertEquals(isVideoAd({ video_url: "no-video" }), true); // Meta reported a video, unresolved
  assertEquals(isVideoAd({ video_url: null }), false);
  assertEquals(isVideoAd({ video_url: "" }), false);
});

Deno.test("isVideoOk: non-video ad is trivially ok", () => {
  assertEquals(isVideoOk({ video_url: null }), true);
  assertEquals(isVideoOk({ video_url: "" }), true);
});

Deno.test("isVideoOk: a cached storage video is ok; sentinel and live CDN are NOT", () => {
  assertEquals(isVideoOk({ video_url: STORAGE_VID }), true);
  assertEquals(isVideoOk({ video_url: "no-video" }), false); // unresolved
  assertEquals(isVideoOk({ video_url: LIVE_CDN }), false); // never cached
});

Deno.test("classifyCoverage: fully-covered image+video ad", () => {
  const c = classifyCoverage({
    ad_status: "ACTIVE",
    impressions: 100,
    full_res_url: STORAGE_IMG,
    video_url: STORAGE_VID,
  });
  assertEquals(c, {
    eligible: true,
    image_ok: true,
    video_ok: true,
    frames_ok: true,
    covered: true,
  });
});

Deno.test("classifyCoverage: tiny-thumbnail image ad is not covered (image_ok false)", () => {
  const c = classifyCoverage({
    ad_status: "ACTIVE",
    impressions: 100,
    full_res_url: null, // only the 130px fallback
    video_url: null, // image-only ad
  });
  assertEquals(c.image_ok, false);
  assertEquals(c.video_ok, true); // not a video ad
  assertEquals(c.covered, false);
});

Deno.test("classifyCoverage: frames_ok=false blocks covered even with image+video ok", () => {
  const c = classifyCoverage(
    {
      ad_status: "ACTIVE",
      impressions: 100,
      full_res_url: STORAGE_IMG,
      video_url: STORAGE_VID,
    },
    false, // a carousel missing a frame
  );
  assertEquals(c.image_ok, true);
  assertEquals(c.video_ok, true);
  assertEquals(c.frames_ok, false);
  assertEquals(c.covered, false);
});
