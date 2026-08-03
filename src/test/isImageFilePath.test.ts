// Regression coverage for isImageFilePath (src/features/vault/types/vault.ts),
// the single source of truth for "is this vault item's primary media a still
// image" — used both by InspirationCard (to decide <img> vs <video>) and by
// LibraryPage's new video/static filter (Library "Video" / "Static" pills).
// Kept as one shared helper so the filter and the card rendering can never
// disagree about what counts as a static ad.
import { describe, it, expect } from "vitest";
import { isImageFilePath } from "../features/vault/types/vault";

describe("isImageFilePath", () => {
  it("recognizes common still-image extensions, case-insensitively", () => {
    expect(isImageFilePath("atria/user/item/thumb.jpg")).toBe(true);
    expect(isImageFilePath("atria/user/item/thumb.JPEG")).toBe(true);
    expect(isImageFilePath("path/to/file.png")).toBe(true);
    expect(isImageFilePath("path/to/file.gif")).toBe(true);
    expect(isImageFilePath("path/to/file.webp")).toBe(true);
    expect(isImageFilePath("path/to/file.AVIF")).toBe(true);
  });

  it("treats video extensions as NOT static", () => {
    expect(isImageFilePath("atria/user/item/media.mp4")).toBe(false);
    expect(isImageFilePath("atria/user/item/media.webm")).toBe(false);
    expect(isImageFilePath("atria/user/item/media.mov")).toBe(false);
  });

  it("treats null, undefined, and empty file_path as NOT static", () => {
    expect(isImageFilePath(null)).toBe(false);
    expect(isImageFilePath(undefined)).toBe(false);
    expect(isImageFilePath("")).toBe(false);
  });

  it("only matches the trailing extension, not an image extension mid-path", () => {
    expect(isImageFilePath("path/thumb.jpg.mp4")).toBe(false);
  });
});
