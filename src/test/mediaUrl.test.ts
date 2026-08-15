/**
 * Guard for the media-URL sentinels (`creatives.thumbnail_url` / `video_url`).
 *
 * Regression: several surfaces treated these columns as "has media" on plain
 * truthiness. Discovery never leaves them NULL — a confirmed-absent asset is
 * stored as a sentinel string — so the sentinel reached the DOM as a real URL
 * (`<img src="no-thumbnail">`, an anchor pointing at a relative "no-video").
 */
import { describe, it, expect } from "vitest";
import { MEDIA_SENTINELS, isMediaSentinel, realMediaUrl } from "@/lib/mediaUrl";
import {
  NO_THUMB_SENTINEL,
  NO_VIDEO_SENTINELS,
  NO_COVER_MEDIA_SENTINEL,
} from "../../supabase/functions/_shared/media-discovery.ts";

describe("media sentinel set", () => {
  it("stays in lockstep with the discovery pipeline's own constants", () => {
    // The frontend mirrors these values because media-discovery.ts is Deno-
    // flavoured and cannot be bundled. If the pipeline gains a new sentinel,
    // this fails until the mirror is updated — which is the whole point.
    const fromPipeline = new Set<string>([
      NO_THUMB_SENTINEL,
      ...NO_VIDEO_SENTINELS,
      NO_COVER_MEDIA_SENTINEL,
    ]);
    expect([...MEDIA_SENTINELS].sort()).toEqual([...fromPipeline].sort());
  });

  it("covers the no-video-* variants, not just the generic sentinel", () => {
    // The helper this replaced only knew "no-thumbnail"/"no-video", so a
    // permission-blocked or deleted video still rendered as a real URL.
    expect(isMediaSentinel("no-video-permission")).toBe(true);
    expect(isMediaSentinel("no-video-deleted")).toBe(true);
    expect(isMediaSentinel("no-video-oversized")).toBe(true);
    expect(isMediaSentinel("no-cover-media")).toBe(true);
  });
});

describe("isMediaSentinel", () => {
  it("treats every sentinel value as absent media", () => {
    for (const s of MEDIA_SENTINELS) expect(isMediaSentinel(s)).toBe(true);
  });

  it("treats null / undefined / empty as absent media", () => {
    expect(isMediaSentinel(null)).toBe(true);
    expect(isMediaSentinel(undefined)).toBe(true);
    expect(isMediaSentinel("")).toBe(true);
  });

  it("treats a real URL as present", () => {
    expect(isMediaSentinel("https://cdn.example.com/a.mp4")).toBe(false);
  });
});

describe("realMediaUrl", () => {
  it("passes a real http(s) URL through unchanged", () => {
    const url = "https://scontent.xx.fbcdn.net/v/t42/video.mp4";
    expect(realMediaUrl(url)).toBe(url);
  });

  it("returns null for every sentinel so callers fall through to a placeholder", () => {
    for (const s of MEDIA_SENTINELS) expect(realMediaUrl(s)).toBeNull();
  });

  it("fails closed on a non-http value we have not mirrored yet", () => {
    // A future sentinel we do not know about must not reach <img src> / <a href>.
    expect(realMediaUrl("no-audio-track")).toBeNull();
    expect(realMediaUrl("pending")).toBeNull();
  });

  it("returns null for null / undefined / empty", () => {
    expect(realMediaUrl(null)).toBeNull();
    expect(realMediaUrl(undefined)).toBeNull();
    expect(realMediaUrl("")).toBeNull();
  });
});
