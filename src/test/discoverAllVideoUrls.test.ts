// US-004 (carousel frame capture) — acceptance test #2.
//
// e2e criterion: "Given an Advantage+ ad with multiple asset_feed_spec videos, when
// media caching completes, then all videos are cached (not just the first)."
//
// The bug the story fixed: the single-result discoverVideoUrl returns after the FIRST
// resolved source. discoverAllVideoUrls is the multi-variant sibling that walks the
// same spec-embedded sources and returns an ORDERED, deduped array of ALL resolved
// video sources — proving the early-return no longer stops after the first video.
// fetch is stubbed exactly like mediaDiscovery*.test.ts (no network, no DB, no timers).
import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverAllVideoUrls } from "../../supabase/functions/_shared/media-discovery.ts";

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function resp(ok: boolean, body: unknown, status = ok ? 200 : 404): FakeResponse {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const SRC1 = "https://video.xx.fbcdn.net/v/t42/one.mp4?e=1";
const SRC2 = "https://video.xx.fbcdn.net/v/t42/two.mp4?e=2";
const SRC3 = "https://video.xx.fbcdn.net/v/t42/three.mp4?e=3";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("US-004 discoverAllVideoUrls (Advantage+ / asset_feed_spec multi-video)", () => {
  it("resolves ALL asset_feed_spec videos in order — not just the first (the early-return fix)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string): Promise<FakeResponse> => {
        // Creative fetch: an Advantage+ ad with THREE asset_feed_spec videos.
        if (url.includes("?fields=creative")) {
          return Promise.resolve(
            resp(true, {
              creative: {
                asset_feed_spec: {
                  videos: [{ video_id: "v1" }, { video_id: "v2" }, { video_id: "v3" }],
                },
              },
            }),
          );
        }
        // Per-video source resolution (direct GET /{video_id}?fields=source).
        if (url.includes("/v1?") || url.includes("/v1&")) return Promise.resolve(resp(true, { source: SRC1 }));
        if (url.includes("/v2?") || url.includes("/v2&")) return Promise.resolve(resp(true, { source: SRC2 }));
        if (url.includes("/v3?") || url.includes("/v3&")) return Promise.resolve(resp(true, { source: SRC3 }));
        return Promise.resolve(resp(false, "not found"));
      }),
    );

    const result = await discoverAllVideoUrls("ad1", "token", 1000);
    // The core assertion: MORE than one source (proves no early return) AND in order.
    expect(result.length).toBeGreaterThan(1);
    expect(result).toEqual([SRC1, SRC2, SRC3]);
  });

  it("prefers the account video map over a direct fetch and preserves card order", async () => {
    const map = new Map<string, string>([
      ["v1", SRC1],
      ["v2", SRC2],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string): Promise<FakeResponse> => {
        if (url.includes("?fields=creative")) {
          return Promise.resolve(
            resp(true, {
              creative: {
                object_story_spec: {
                  link_data: { child_attachments: [{ video_id: "v1" }, { video_id: "v2" }] },
                },
              },
            }),
          );
        }
        // If any direct /{video_id}?fields=source is hit, fail — the map should win.
        return Promise.resolve(resp(false, "should not fetch"));
      }),
    );

    const result = await discoverAllVideoUrls("ad1", "token", 1000, map);
    expect(result).toEqual([SRC1, SRC2]);
  });

  it("dedupes a video_id repeated across spec paths, keeping first-seen order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string): Promise<FakeResponse> => {
        if (url.includes("?fields=creative")) {
          return Promise.resolve(
            resp(true, {
              creative: {
                // top-level video_id AND the same id echoed in asset_feed_spec + a
                // distinct second variant.
                video_id: "v1",
                asset_feed_spec: { videos: [{ video_id: "v1" }, { video_id: "v2" }] },
              },
            }),
          );
        }
        if (url.includes("/v1?") || url.includes("/v1&")) return Promise.resolve(resp(true, { source: SRC1 }));
        if (url.includes("/v2?") || url.includes("/v2&")) return Promise.resolve(resp(true, { source: SRC2 }));
        return Promise.resolve(resp(false, "not found"));
      }),
    );

    const result = await discoverAllVideoUrls("ad1", "token", 1000);
    // v1 resolved once (deduped), v2 second — no duplicate SRC1.
    expect(result).toEqual([SRC1, SRC2]);
  });

  it("captures an inline video_data.video_url without a video_id lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string): Promise<FakeResponse> => {
        if (url.includes("?fields=creative")) {
          return Promise.resolve(
            resp(true, {
              creative: { object_story_spec: { video_data: { video_url: SRC1 } } },
            }),
          );
        }
        return Promise.resolve(resp(false, "not found"));
      }),
    );
    const result = await discoverAllVideoUrls("ad1", "token", 1000);
    expect(result).toEqual([SRC1]);
  });
});
