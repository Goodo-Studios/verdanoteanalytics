/**
 * Regression: every InspirationCard used to mint its own signed Storage URL
 * for both thumbnail_path and file_path on mount, uncached — up to 2 network
 * round-trips per card, fired the instant the Vault grid rendered. LibraryPage
 * now batches every visible item's paths into one `createSignedUrls` call.
 * These pin the two pure pieces of that batching: which paths get signed,
 * and how the batch response turns back into a lookup map.
 */
import { describe, it, expect } from "vitest";
import { buildSignedUrlMap, collectVaultStoragePaths, resolveProvidedSignedUrl } from "@/features/vault/utils/signedUrls";

describe("collectVaultStoragePaths", () => {
  it("collects both thumbnail_path and file_path across items, deduped", () => {
    const paths = collectVaultStoragePaths([
      { thumbnail_path: "a/thumb1.jpg", file_path: "a/file1.mp4" },
      { thumbnail_path: "a/thumb2.jpg", file_path: "a/file2.mp4" },
      // duplicate path (e.g. thumbnail reused as file_path) should appear once
      { thumbnail_path: "a/thumb1.jpg", file_path: null },
    ]);
    expect(paths.sort()).toEqual(
      ["a/thumb1.jpg", "a/file1.mp4", "a/thumb2.jpg", "a/file2.mp4"].sort(),
    );
  });

  it("skips null/undefined paths instead of signing garbage", () => {
    const paths = collectVaultStoragePaths([
      { thumbnail_path: null, file_path: undefined },
      { thumbnail_path: "a/thumb.jpg" },
    ]);
    expect(paths).toEqual(["a/thumb.jpg"]);
  });

  it("returns an empty array for an empty item list", () => {
    expect(collectVaultStoragePaths([])).toEqual([]);
  });
});

describe("buildSignedUrlMap", () => {
  it("maps path -> signedUrl from a batch response", () => {
    const map = buildSignedUrlMap([
      { path: "a/thumb1.jpg", signedUrl: "https://signed.example/thumb1" },
      { path: "a/file1.mp4", signedUrl: "https://signed.example/file1" },
    ]);
    expect(map).toEqual({
      "a/thumb1.jpg": "https://signed.example/thumb1",
      "a/file1.mp4": "https://signed.example/file1",
    });
  });

  it("drops entries that errored, even if a stale signedUrl is present", () => {
    const map = buildSignedUrlMap([
      { path: "a/broken.jpg", signedUrl: "https://signed.example/broken", error: "not found" },
      { path: "a/ok.jpg", signedUrl: "https://signed.example/ok", error: null },
    ]);
    expect(map).toEqual({ "a/ok.jpg": "https://signed.example/ok" });
  });

  it("drops entries missing a path or signedUrl", () => {
    const map = buildSignedUrlMap([
      { path: null, signedUrl: "https://signed.example/x" },
      { path: "a/y.jpg", signedUrl: null },
    ]);
    expect(map).toEqual({});
  });

  it("returns an empty map for null/undefined input", () => {
    expect(buildSignedUrlMap(null)).toEqual({});
    expect(buildSignedUrlMap(undefined)).toEqual({});
  });
});

/**
 * Incident (2026-08-04): the first version of the batching shipped with no
 * fallback — every InspirationCard skipped self-signing whenever the parent
 * "opted in", full stop, even if the parent's one batched request failed.
 * That turned an isolated failure into a page-wide one: every thumbnail in
 * the Creative Vault went blank at once. `resolveProvidedSignedUrl` is the
 * three-state signal LibraryPage now feeds each card so a batch failure
 * degrades to the old self-signing behavior instead of going blank.
 */
describe("resolveProvidedSignedUrl", () => {
  it("returns null (nothing to sign) when the item has no path, regardless of batch state", () => {
    expect(resolveProvidedSignedUrl(null, {}, /* batchSettled */ false)).toBeNull();
    expect(resolveProvidedSignedUrl(undefined, { "a/x.jpg": "https://signed" }, true)).toBeNull();
  });

  it("returns undefined (wait, don't self-sign) while the batch call hasn't settled yet", () => {
    expect(resolveProvidedSignedUrl("a/thumb.jpg", undefined, /* batchSettled */ false)).toBeUndefined();
    expect(resolveProvidedSignedUrl("a/thumb.jpg", {}, /* batchSettled */ false)).toBeUndefined();
  });

  it("returns the signed URL once the batch has settled and has this path", () => {
    expect(
      resolveProvidedSignedUrl("a/thumb.jpg", { "a/thumb.jpg": "https://signed.example/thumb" }, true),
    ).toBe("https://signed.example/thumb");
  });

  it("returns null (fall back to self-signing) once settled with nothing for this path — the incident case", () => {
    // The whole batch call failed (map never populated) — every item's path
    // is missing from it, so every card must fall back, not go blank.
    expect(resolveProvidedSignedUrl("a/thumb.jpg", undefined, /* batchSettled */ true)).toBeNull();
    // The batch call succeeded overall but had no entry for THIS path
    // specifically (e.g. a per-item error, or a since-deleted object).
    expect(resolveProvidedSignedUrl("a/thumb.jpg", { "a/other.jpg": "https://signed" }, true)).toBeNull();
  });
});
