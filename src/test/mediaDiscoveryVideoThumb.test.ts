// Regression coverage for the P2.5 sub-480px video-thumbnail fallback in
// supabase/functions/_shared/media-discovery.ts → discoverImageUrl (Strategy 2).
//
// Root bug: when a video creative's best thumbnail was below 480px AND the 1080
// /picture endpoint also failed, discoverImageUrl dropped the thumbnail entirely and
// fell through to the ~130px Strategy-6 placeholder (or null) — leaving the card
// broken. The fix holds the best sub-480 thumb as a last-resort fallback and returns
// it when the higher-res strategies fail. These tests pin that:
//   1. best thumb >= 480px → returned immediately (preferred, unchanged)
//   2. best thumb < 480px + 1080 picture succeeds → picture wins (fallback NOT used)
//   3. best thumb < 480px + 1080 picture fails → the sub-480 thumb is returned (the fix)
import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverImageUrl } from "../../supabase/functions/_shared/media-discovery.ts";

const SMALL_THUMB = "https://scontent.xx.fbcdn.net/v/small_320_n.jpg";
const PICTURE_1080 = "https://scontent.xx.fbcdn.net/v/picture_1080_n.jpg";

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

// Builds a fetch stub for a video creative whose best thumbnail is `thumbWidth` wide.
// `pictureOk` controls whether the 1080 /picture endpoint succeeds.
function stubFetch(opts: { thumbWidth: number; pictureOk: boolean }) {
  return vi.fn((url: string): Promise<FakeResponse> => {
    // 1. Creative fetch — a video creative with no image_hash, so Strategies 1/1b skip.
    if (url.includes("?fields=creative")) {
      return Promise.resolve(
        resp(true, {
          creative: {
            object_story_spec: { video_data: { video_id: "vid1" } },
          },
        })
      );
    }
    // 2. Video thumbnails endpoint.
    if (url.includes("vid1") && url.includes("thumbnails")) {
      return Promise.resolve(
        resp(true, { thumbnails: { data: [{ uri: SMALL_THUMB, width: opts.thumbWidth, height: opts.thumbWidth }] } })
      );
    }
    // 3. 1080 /picture endpoint.
    if (url.includes("vid1") && url.includes("/picture")) {
      return opts.pictureOk
        ? Promise.resolve(resp(true, { data: { url: PICTURE_1080 } }))
        : Promise.resolve(resp(false, "error"));
    }
    // Any later strategy fetch fails so discovery can't accidentally resolve elsewhere.
    return Promise.resolve(resp(false, "not found"));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverImageUrl video-thumbnail fallback (P2.5)", () => {
  it("returns a >=480px thumbnail directly (preferred path, unchanged)", async () => {
    const big = "https://scontent.xx.fbcdn.net/v/big_720_n.jpg";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string): Promise<FakeResponse> => {
        if (url.includes("?fields=creative")) {
          return Promise.resolve(resp(true, { creative: { object_story_spec: { video_data: { video_id: "vid1" } } } }));
        }
        if (url.includes("vid1") && url.includes("thumbnails")) {
          return Promise.resolve(resp(true, { thumbnails: { data: [{ uri: big, width: 720, height: 720 }] } }));
        }
        return Promise.resolve(resp(false, "x"));
      })
    );
    const result = await discoverImageUrl("ad1", "act_1", "token", 1000);
    // US-002: a video thumbnail returned with fullResUrl:null is a low-res
    // placeholder for coverage purposes (imageQuality tracks fullResUrl).
    expect(result).toEqual({ thumbnailUrl: big, fullResUrl: null, imageQuality: "low_res" });
  });

  it("prefers the 1080 /picture endpoint over a sub-480 thumb when it succeeds", async () => {
    vi.stubGlobal("fetch", stubFetch({ thumbWidth: 320, pictureOk: true }));
    const result = await discoverImageUrl("ad1", "act_1", "token", 1000);
    // US-002: the 1080 /picture render is a real full-res source.
    expect(result).toEqual({ thumbnailUrl: PICTURE_1080, fullResUrl: PICTURE_1080, imageQuality: "full_res" });
  });

  it("falls back to the sub-480 thumb when the 1080 /picture endpoint fails (the fix)", async () => {
    vi.stubGlobal("fetch", stubFetch({ thumbWidth: 320, pictureOk: false }));
    const result = await discoverImageUrl("ad1", "act_1", "token", 1000);
    // US-002: the sub-480 fallback is a low-res placeholder (fullResUrl:null).
    expect(result).toEqual({ thumbnailUrl: SMALL_THUMB, fullResUrl: null, imageQuality: "low_res" });
  });
});
