// Regression coverage for the P2.6 expired-CDN-url handling in src/hooks/useCachedMedia.ts.
//
// Root bug: when a media fetch failed, the hook fell back to the SAME url it just failed on
// (`setObjectUrl(mediaUrl || ...)`). For an expired Meta fbcdn CDN url that meant looping on a
// dead link forever. The fix branches on the url type:
//   - permanent Supabase Storage urls (/storage/v1/object/public/) → reuse (failure is a
//     transient network blip; the <img> tag can still load it cross-origin)
//   - anything else (expired fbcdn CDN) → show the placeholder AND call onExpired(url) so the
//     consumer can trigger an on-demand re-cache, instead of re-rendering the dead url.
//
// These tests drive the hook with a cache-miss (empty IndexedDB fake) and a fetch that rejects,
// forcing the catch branch, then assert the url-type-dependent behavior.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCachedMedia } from "../hooks/useCachedMedia";

// Minimal in-memory IndexedDB stand-in: open() succeeds, every get() is a cache miss, and
// put/delete resolve. Enough for MediaCache to report "not cached" so loadMedia hits the
// network fetch (which we then reject).
function installFakeIndexedDB() {
  const fireAsync = (req: { onsuccess?: () => void }) => setTimeout(() => req.onsuccess?.(), 0);
  const store = {
    get: () => {
      const r: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = { result: undefined };
      fireAsync(r);
      return r;
    },
    put: () => {
      const r: { onsuccess?: () => void; onerror?: () => void } = {};
      fireAsync(r);
      return r;
    },
    delete: () => {
      const r: { onsuccess?: () => void; onerror?: () => void } = {};
      fireAsync(r);
      return r;
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
  };
  const fakeIDB = {
    open: () => {
      const req: { result?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void } = {};
      setTimeout(() => {
        req.result = db;
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  vi.stubGlobal("indexedDB", fakeIDB);
}

beforeEach(() => {
  installFakeIndexedDB();
  // createObjectURL isn't reached on the failure path, but stub it so any stray call is safe.
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:stub", revokeObjectURL: () => {} }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCachedMedia expired-CDN handling (P2.6)", () => {
  it("on a failed CDN (fbcdn) url: shows the placeholder and calls onExpired (does NOT reuse the dead url)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network fail"))));
    const onExpired = vi.fn();
    const cdnUrl = "https://scontent.xx.fbcdn.net/v/expired_n.jpg?oh=abc";

    const { result } = renderHook(() =>
      useCachedMedia(cdnUrl, { placeholderUrl: "/placeholder-creative.png", onExpired })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.url).toBe("/placeholder-creative.png");
    expect(result.current.url).not.toBe(cdnUrl);
    expect(onExpired).toHaveBeenCalledWith(cdnUrl);
  });

  it("on a failed Storage url: reuses the url (transient blip) and does NOT call onExpired", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network fail"))));
    const onExpired = vi.fn();
    const storageUrl =
      "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1/ad1.jpg";

    const { result } = renderHook(() =>
      useCachedMedia(storageUrl, { placeholderUrl: "/placeholder-creative.png", onExpired })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.url).toBe(storageUrl);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("prefers an explicit fallbackUrl over the placeholder for an expired CDN url", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network fail"))));
    const cdnUrl = "https://scontent.xx.fbcdn.net/v/expired_n.jpg";

    const { result } = renderHook(() =>
      useCachedMedia(cdnUrl, { fallbackUrl: "/fallback.png", placeholderUrl: "/placeholder-creative.png" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.url).toBe("/fallback.png");
  });
});

describe("useCachedMedia HTML-poison guard", () => {
  // Fake Blob whose slice().arrayBuffer() returns the given bytes — jsdom's real
  // Blob.arrayBuffer() is unreliable, so we hand the hook a deterministic stand-in.
  const fakeBlob = (bytes: Uint8Array, type: string) => ({
    type,
    slice: () => ({ arrayBuffer: () => Promise.resolve(bytes.buffer) }),
  });

  it("a 200 response whose body is an HTML page (poison) is NOT shown; storage url falls back to the <img>-loadable url", async () => {
    // Poison shape: HTML error page served with HTTP 200 + image/jpeg content-type.
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>login</body></html>");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(fakeBlob(html, "image/jpeg")) })));
    const storageUrl = "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1/ad1.jpg";

    const { result } = renderHook(() => useCachedMedia(storageUrl));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Guard threw → storage-url catch branch reuses the raw url (so the <img> tag loads the
    // now-valid object directly); the poison blob must NOT have become a cached blob: url.
    expect(result.current.url).toBe(storageUrl);
  });

  it("a permanent Storage url is handed straight to the tag (no fetch, no blob cache)", async () => {
    // Storage urls are public + browser-cacheable; the hook must NOT fetch them (that
    // path tripped on transient 503/HTML pages). It returns the url directly.
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(fakeBlob(new Uint8Array([0xff, 0xd8]), "image/jpeg")) }));
    vi.stubGlobal("fetch", fetchSpy);
    const storageUrl = "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1/ad2.jpg";

    const { result } = renderHook(() => useCachedMedia(storageUrl));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.url).toBe(storageUrl);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a non-storage (CDN) image IS fetched + cached and surfaced as a blob: url", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(fakeBlob(jpeg, "image/jpeg")) })));
    const cdnUrl = "https://scontent.xx.fbcdn.net/v/t45/image123.jpg";

    const { result } = renderHook(() => useCachedMedia(cdnUrl));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.url).toBe("blob:stub");
  });
});
