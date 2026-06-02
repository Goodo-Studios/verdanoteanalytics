// fix/vault-transcribe-large-video-honest — regression coverage for the
// transcription-classification logic extracted into
// supabase/functions/_shared/vault-transcribe-logic.ts.
//
// Root cause this guards against: vault-transcribe sent the whole video file to
// Groq Whisper (25 MB sync cap). A ~28 MB / 2-minute ad 413'd, and the old code
// SILENTLY marked the item `ready` with no transcript — so the card played fine
// but "Run analysis" threw "No transcript found for item". These tests pin the
// honest classification: too-large → error, no-audio/image → graceful skip.
import { describe, it, expect } from "vitest";
import {
  classifyGroqFailure,
  isImageOnlyMedia,
  tooLargeMessage,
} from "../../supabase/functions/_shared/vault-transcribe-logic.ts";

describe("isImageOnlyMedia", () => {
  it("treats a stored image file as image-only (no audio to transcribe)", () => {
    expect(isImageOnlyMedia({ file_path: "analytics/u/123/thumb.jpg" })).toBe(true);
    expect(isImageOnlyMedia({ file_path: "x/y/STATIC.PNG" })).toBe(true);
    expect(isImageOnlyMedia({ file_path: "a/b/c.webp" })).toBe(true);
  });

  it("treats a stored video file as transcribable", () => {
    expect(isImageOnlyMedia({ file_path: "uploads/u/123/media.mp4" })).toBe(false);
    expect(isImageOnlyMedia({ file_path: "uploads/u/123/clip.webm" })).toBe(false);
  });

  it("a real video_url overrides an image-looking path", () => {
    expect(
      isImageOnlyMedia({ file_path: "a/b/thumb.jpg", video_url: "https://cdn/x.mp4" }),
    ).toBe(false);
  });

  it("handles query strings, missing extensions, and empty input", () => {
    expect(isImageOnlyMedia({ file_path: "a/b/thumb.jpg?token=abc#frag" })).toBe(true);
    expect(isImageOnlyMedia({ file_path: "a/b/noext" })).toBe(false);
    expect(isImageOnlyMedia({ file_path: null, video_url: null })).toBe(false);
    expect(isImageOnlyMedia({})).toBe(false);
  });
});

describe("classifyGroqFailure", () => {
  it("classifies a 413 as too-large (honest error, not a silent skip)", () => {
    expect(classifyGroqFailure(413, "Request Entity Too Large")).toBe("error_too_large");
  });

  it("classifies size-limit 400 bodies as too-large", () => {
    expect(
      classifyGroqFailure(400, '{"error":{"message":"file size exceeds maximum allowed size"}}'),
    ).toBe("error_too_large");
    expect(classifyGroqFailure(400, "the audio file is too large")).toBe("error_too_large");
  });

  it("classifies a missing audio track as a graceful skip (image / silent video)", () => {
    expect(
      classifyGroqFailure(400, '{"error":{"message":"no audio track found in file"}}'),
    ).toBe("skip_no_audio");
  });

  it("classifies everything else as an honest other-error", () => {
    expect(classifyGroqFailure(401, "invalid api key")).toBe("error_other");
    expect(classifyGroqFailure(500, "internal server error")).toBe("error_other");
    // The old guard ONLY skipped on the literal "could not process" — that path
    // is gone; unknown 400s now surface honestly instead of vanishing as ready.
    expect(classifyGroqFailure(400, "could not process file")).toBe("error_other");
  });

  it("is case-insensitive on the response body", () => {
    expect(classifyGroqFailure(400, "NO AUDIO TRACK FOUND")).toBe("skip_no_audio");
    expect(classifyGroqFailure(400, "ENTITY TOO LARGE")).toBe("error_too_large");
  });
});

describe("tooLargeMessage", () => {
  it("reports the size in MB and stays user-readable", () => {
    const msg = tooLargeMessage(29277076); // the real 2:06 Earthing Harmony ad
    expect(msg).toContain("27.9 MB");
    expect(msg).toContain("too large");
    expect(msg.toLowerCase()).toContain("saved and viewable");
  });
});
