// Regression coverage for the static-image-upload bug. Uploading a static image
// ad to the Creative Vault failed with "No transcript found for item" because
// vault-analyze unconditionally required a video transcript. The branch-selection
// decision now lives in supabase/functions/_shared/vault-analyze-logic.ts so it can
// be exercised here with no Deno globals and no live network/DB. Deterministic.
import { describe, it, expect } from "vitest";
import {
  isImageOnlyAnalysis,
  isImagePath,
  parseLooseJson,
} from "../../supabase/functions/_shared/vault-analyze-logic.ts";

// ─── isImagePath ────────────────────────────────────────────────────────────
describe("isImagePath", () => {
  it("recognizes the image extensions the vault stores", () => {
    for (const ext of ["jpg", "jpeg", "png", "gif", "webp", "avif"]) {
      expect(isImagePath(`uploads/u/123.${ext}`)).toBe(true);
      expect(isImagePath(`uploads/u/123.${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it("rejects video files and non-strings", () => {
    expect(isImagePath("uploads/u/123.mp4")).toBe(false);
    expect(isImagePath("uploads/u/123.mov")).toBe(false);
    expect(isImagePath("uploads/u/123.webm")).toBe(false);
    expect(isImagePath(null)).toBe(false);
    expect(isImagePath(undefined)).toBe(false);
    expect(isImagePath(42)).toBe(false);
    expect(isImagePath("")).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(isImagePath("  uploads/u/1.png  ")).toBe(true);
  });
});

// ─── isImageOnlyAnalysis — the bug's core decision ───────────────────────────
describe("isImageOnlyAnalysis", () => {
  it("runs the image branch for a fresh image upload (media_kind hint)", () => {
    // vault-save forwards media_kind: "image"; there is no transcript yet.
    expect(
      isImageOnlyAnalysis({ hasTranscript: false, mediaKind: "image", filePath: "uploads/u/1.png" }),
    ).toBe(true);
  });

  it("runs the image branch on re-analyze (no media_kind, infer from file_path)", () => {
    // The re-analyze button calls vault-analyze with just { item_id } — no hint.
    expect(
      isImageOnlyAnalysis({ hasTranscript: false, mediaKind: undefined, filePath: "uploads/u/1.jpg" }),
    ).toBe(true);
  });

  it("NEVER runs the image branch when a transcript exists (video path)", () => {
    // Even a bogus image-looking file_path must not override a real transcript.
    expect(
      isImageOnlyAnalysis({ hasTranscript: true, mediaKind: "image", filePath: "uploads/u/1.png" }),
    ).toBe(false);
  });

  it("keeps a transcription-failed VIDEO on the video branch (surfaces the error)", () => {
    // No transcript, no image hint, video file_path → stay on video branch so the
    // "No transcript found" error surfaces rather than mis-analyzing as an image.
    expect(
      isImageOnlyAnalysis({ hasTranscript: false, mediaKind: "video", filePath: "uploads/u/1.mp4" }),
    ).toBe(false);
    expect(
      isImageOnlyAnalysis({ hasTranscript: false, mediaKind: undefined, filePath: "uploads/u/1.mp4" }),
    ).toBe(false);
  });

  it("does not run the image branch when there is no signal at all", () => {
    expect(
      isImageOnlyAnalysis({ hasTranscript: false, mediaKind: undefined, filePath: null }),
    ).toBe(false);
  });
});

// ─── parseLooseJson ──────────────────────────────────────────────────────────
describe("parseLooseJson", () => {
  it("parses bare JSON", () => {
    expect(parseLooseJson('{"hook_text":"Buy now"}')).toEqual({ hook_text: "Buy now" });
  });

  it("parses JSON wrapped in a ```json fence", () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("returns an empty object when nothing parses", () => {
    expect(parseLooseJson("not json")).toEqual({});
    expect(parseLooseJson(null)).toEqual({});
    expect(parseLooseJson(undefined)).toEqual({});
  });
});
