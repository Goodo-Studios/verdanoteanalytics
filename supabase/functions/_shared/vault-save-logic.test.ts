// deno test supabase/functions/_shared/vault-save-logic.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { selectMediaSources, needsMediaRecovery, cleanUrl, isDurableStorageUrl, isImageOnlyItem } from "./vault-save-logic.ts";

const STORAGE = "https://gwyxaqoaldnaavkjqquv.supabase.co/storage/v1/object/public/ad-thumbnails/abc/123.jpg";
const CDN = "https://video.xx.fbcdn.net/v/signed-token/abc.jpg";
const EXPIRED_CDN = "https://scontent.xx.fbcdn.net/v/expired/abc.jpg";

// ── selectMediaSources ────────────────────────────────────────────────────────

Deno.test("selectMediaSources: storage full_res preferred over CDN", () => {
  const { imageSrc } = selectMediaSources({
    full_res_url: STORAGE,
    thumbnail_url: CDN,
  });
  assertEquals(imageSrc, STORAGE);
});

Deno.test("selectMediaSources: storage thumb preferred over expired CDN full_res", () => {
  // Regression: refresh-thumbnails can overwrite full_res_url with a CDN URL
  // even when thumbnail_url is already a storage URL → copyMedia 403 → 500.
  const { imageSrc } = selectMediaSources({
    full_res_url: EXPIRED_CDN,
    thumbnail_url: STORAGE,
  });
  assertEquals(imageSrc, STORAGE);
});

Deno.test("selectMediaSources: CDN full_res used when both are CDN (no storage)", () => {
  const { imageSrc } = selectMediaSources({
    full_res_url: CDN,
    thumbnail_url: "https://video.xx.fbcdn.net/thumb.jpg",
  });
  assertEquals(imageSrc, CDN);
});

Deno.test("selectMediaSources: null full_res falls back to thumb", () => {
  const { imageSrc } = selectMediaSources({
    full_res_url: null,
    thumbnail_url: STORAGE,
  });
  assertEquals(imageSrc, STORAGE);
});

Deno.test("selectMediaSources: sentinel full_res falls back to thumb", () => {
  const { imageSrc } = selectMediaSources({
    full_res_url: "no-thumbnail",
    thumbnail_url: CDN,
  });
  assertEquals(imageSrc, CDN);
});

Deno.test("selectMediaSources: video_url mapped to videoSrc only", () => {
  const { videoSrc, imageSrc } = selectMediaSources({
    video_url: CDN,
    full_res_url: STORAGE,
    thumbnail_url: null,
  });
  assertEquals(videoSrc, CDN);
  assertEquals(imageSrc, STORAGE);
});

Deno.test("selectMediaSources: all null → both null", () => {
  const { videoSrc, imageSrc } = selectMediaSources({});
  assertEquals(videoSrc, null);
  assertEquals(imageSrc, null);
});

// ── needsMediaRecovery ────────────────────────────────────────────────────────

Deno.test("needsMediaRecovery: both storage → false", () => {
  assertEquals(needsMediaRecovery({ video_url: STORAGE, thumbnail_url: STORAGE }), false);
});

Deno.test("needsMediaRecovery: CDN video → true", () => {
  assertEquals(needsMediaRecovery({ video_url: CDN, thumbnail_url: STORAGE }), true);
});

Deno.test("needsMediaRecovery: null video → true", () => {
  assertEquals(needsMediaRecovery({ video_url: null, thumbnail_url: STORAGE }), true);
});

Deno.test("needsMediaRecovery: sentinels → false (confirmed absent)", () => {
  assertEquals(needsMediaRecovery({ video_url: "no-video", thumbnail_url: "no-thumbnail" }), false);
});

// ── isImageOnlyItem (vault-transcribe skip guard) ──────────────────────────────

Deno.test("isImageOnlyItem: file_path === thumbnail_path → true (image-only save)", () => {
  const p = "analytics/u/ad/thumb.jpg";
  assertEquals(isImageOnlyItem({ file_path: p, thumbnail_path: p }), true);
});

Deno.test("isImageOnlyItem: image extension on file_path → true", () => {
  assertEquals(isImageOnlyItem({ file_path: "analytics/u/ad/thumb.png", thumbnail_path: null }), true);
  assertEquals(isImageOnlyItem({ file_path: "analytics/u/ad/thumb.webp" }), true);
});

Deno.test("isImageOnlyItem: video file_path distinct from thumb → false", () => {
  assertEquals(
    isImageOnlyItem({ file_path: "analytics/u/ad/media.mp4", thumbnail_path: "analytics/u/ad/thumb.jpg" }),
    false,
  );
});

Deno.test("isImageOnlyItem: webm video → false", () => {
  assertEquals(isImageOnlyItem({ file_path: "analytics/u/ad/media.webm", thumbnail_path: "analytics/u/ad/thumb.jpg" }), false);
});

Deno.test("isImageOnlyItem: missing/empty paths → false", () => {
  assertEquals(isImageOnlyItem({ file_path: null, thumbnail_path: null }), false);
  assertEquals(isImageOnlyItem({}), false);
});
