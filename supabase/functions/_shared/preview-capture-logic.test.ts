// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/preview-capture-logic.test.ts
//
// Fixtures are shaped from the PROVEN preview-extraction evidence (scratchpad
// preview-spike / preview-batch / static-check): plugin/iframe media arrive
// JSON-escaped ("https:\/\/…"); Tier-A video plugin carries "hd_src"/"sd_src";
// Tier-B iframe carries fbcdn .mp4 (video) and scontent…fbcdn.net images with
// stp=…sNNNxNNN size tokens; a "Video Unavailable" plugin stub is NOT terminal.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alreadyCovered,
  buildPreviewsUrl,
  buildVideoPluginUrl,
  captureBackoffMs,
  CAPTURE_MAX_ATTEMPTS,
  extractIframeUrl,
  finalCaptureStatus,
  hasVideoIntent,
  IFRAME_HEADERS,
  imageSizeHint,
  isFbcdnHost,
  isImageAd,
  isStorageOwnedUrl,
  mediaIntentSkipReason,
  parseGraphUsage,
  parseIframeMedia,
  parsePluginVideo,
  parseUsageHeader,
  planCreativeMediaUpdate,
  PREVIEW_FORMATS,
  quotaDecision,
  rankImageCandidates,
  rankVideoCandidates,
  retryDecision,
} from "./preview-capture-logic.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PLUGIN_HD_SD = `{"videoData":[{"hd_src":"https:\\/\\/video-sea5-1.xx.fbcdn.net\\/o1\\/v\\/t2\\/f2\\/m266\\/AQMLNxPB.mp4?_nc_cat=1&oe=abc","sd_src":"https:\\/\\/video-sea5-1.xx.fbcdn.net\\/o1\\/v\\/t2\\/f2\\/m69\\/AQsd.mp4?_nc=2"}]}`;
const PLUGIN_UNAVAILABLE = `<div>Video Unavailable</div><script>{"isPlayable":false}</script>`;

// Tier-B iframe with a single video (HD + SD), JSON-escaped.
const IFRAME_VIDEO = `<html>{"videoHdUrl":"x","hd_src":"https:\\/\\/video-sea5-1.xx.fbcdn.net\\/o1\\/v\\/t2\\/f2\\/m69\\/AQP82Q.mp4?strext=1","sd_src":"https:\\/\\/video-sea5-1.xx.fbcdn.net\\/o1\\/v\\/sd.mp4"}</html>`;

// Tier-B iframe for a single static image: a small logo (200) + the headline (960),
// plus rsrc.php chrome that must be excluded.
const IFRAME_STATIC = `<html>
<meta property="og:image" content="https://scontent-a.xx.fbcdn.net/v/t45/111111_222222222_333_n.jpg?stp=dst-jpg_s960x960&_nc=1"/>
<img src="https://scontent-b.xx.fbcdn.net/v/t39/999999_888_n.jpg?stp=c0.0.200.200a_s200x200"/>
<img src="https://static.xx.fbcdn.net/rsrc.php/v3/chrome.png"/>
</html>`;

// Tier-B iframe carousel: three distinct card images (each a different media id) at
// 480x480, plus a 200px page logo.
const IFRAME_CAROUSEL = `<html>
<img src="https://scontent-a.xx.fbcdn.net/v/t45/100000_200000001_1_n.jpg?stp=dst-jpg_s480x480"/>
<img src="https://scontent-a.xx.fbcdn.net/v/t45/100000_200000002_1_n.jpg?stp=dst-jpg_s480x480"/>
<img src="https://scontent-a.xx.fbcdn.net/v/t45/100000_200000003_1_n.jpg?stp=dst-jpg_s480x480"/>
<img src="https://scontent-b.xx.fbcdn.net/v/t39/700000_1_n.jpg?stp=s200x200"/>
</html>`;

const GRAPH_JSON_WITH_IFRAME =
  `{"data":[{"body":"<iframe src=\\"https://www.facebook.com/plugins/ad/preview_iframe.php?d=Abc&t=Xyz&amp;container_id=1\\" width=\\"320\\"></iframe>"}]}`;

// ── URL builders (Tier A / Tier B) ────────────────────────────────────────────
Deno.test("buildVideoPluginUrl: url-encoded video.php href, show_text=false", () => {
  const u = new URL(buildVideoPluginUrl("1552086496318501"));
  assertEquals(u.hostname, "www.facebook.com");
  assertEquals(u.pathname, "/plugins/video.php");
  assertEquals(u.searchParams.get("href"), "https://www.facebook.com/video.php?v=1552086496318501");
  assertEquals(u.searchParams.get("show_text"), "false");
});

Deno.test("buildPreviewsUrl: Graph /previews with format + token (never printed here)", () => {
  const u = new URL(buildPreviewsUrl("120250119454040412", "MOBILE_FEED_STANDARD", "TESTTOKEN"));
  assertEquals(u.hostname, "graph.facebook.com");
  assertEquals(u.pathname, "/v22.0/120250119454040412/previews");
  assertEquals(u.searchParams.get("ad_format"), "MOBILE_FEED_STANDARD");
  assertEquals(u.searchParams.get("access_token"), "TESTTOKEN");
});

Deno.test("PREVIEW_FORMATS: the app's order, MOBILE first", () => {
  assertEquals(PREVIEW_FORMATS[0], "MOBILE_FEED_STANDARD");
  assertEquals(PREVIEW_FORMATS.length, 4);
});

Deno.test("IFRAME_HEADERS: Referer + the load-bearing Sec-Fetch-* triad", () => {
  assertEquals(IFRAME_HEADERS["Referer"], "https://business.facebook.com/");
  assertEquals(IFRAME_HEADERS["Sec-Fetch-Dest"], "iframe");
  assertEquals(IFRAME_HEADERS["Sec-Fetch-Mode"], "navigate");
  assertEquals(IFRAME_HEADERS["Sec-Fetch-Site"], "same-origin");
});

// ── Tier A: plugin video parse ────────────────────────────────────────────────
Deno.test("parsePluginVideo: prefers hd_src, unescapes, fbcdn-only", () => {
  const p = parsePluginVideo(PLUGIN_HD_SD);
  assertEquals(p.url, "https://video-sea5-1.xx.fbcdn.net/o1/v/t2/f2/m266/AQMLNxPB.mp4?_nc_cat=1&oe=abc");
  assertEquals(p.candidates.length, 2); // hd + sd
  assertEquals(p.unavailable, false);
});

Deno.test("parsePluginVideo: 'Video Unavailable' stub is NOT terminal (no url, unavailable flag)", () => {
  const p = parsePluginVideo(PLUGIN_UNAVAILABLE);
  assertEquals(p.url, null);
  assertEquals(p.unavailable, true);
});

Deno.test("rankVideoCandidates: hd before sd before generic, fbcdn-host-only", () => {
  const html =
    `"sd_src":"https:\\/\\/video.xx.fbcdn.net\\/sd.mp4" "hd_src":"https:\\/\\/video.xx.fbcdn.net\\/hd.mp4" https:\\/\\/evil.example.com\\/x.mp4`;
  const ranked = rankVideoCandidates(html);
  assertEquals(ranked[0], "https://video.xx.fbcdn.net/hd.mp4");
  assertEquals(ranked[1], "https://video.xx.fbcdn.net/sd.mp4");
  assertEquals(ranked.some((u) => u.includes("evil.example.com")), false);
});

// ── Tier B: iframe url extraction ─────────────────────────────────────────────
Deno.test("extractIframeUrl: pulls preview_iframe.php from Graph body, decodes &amp;", () => {
  const url = extractIframeUrl(GRAPH_JSON_WITH_IFRAME);
  assertEquals(url?.includes("preview_iframe.php"), true);
  assertEquals(url?.includes("&amp;"), false); // decoded
  assertEquals(url?.includes("container_id=1"), true);
});

Deno.test("extractIframeUrl: null when no iframe present", () => {
  assertEquals(extractIframeUrl(`{"data":[{"body":"<div>no preview</div>"}]}`), null);
});

// ── Tier B: iframe media parse (video / image / carousel) ─────────────────────
Deno.test("parseIframeMedia: video ad — hd fbcdn mp4 first", () => {
  const m = parseIframeMedia(IFRAME_VIDEO);
  assertEquals(m.video, "https://video-sea5-1.xx.fbcdn.net/o1/v/t2/f2/m69/AQP82Q.mp4?strext=1");
  assertEquals(m.images.length, 0);
  assertEquals(m.loginWall, false);
});

Deno.test("parseIframeMedia: single static — headline (960) ranks above the 200px logo, chrome excluded", () => {
  const m = parseIframeMedia(IFRAME_STATIC);
  assertEquals(m.video, null);
  // Highest-res first: the s960x960 headline, not the s200x200 logo.
  assertEquals(m.images[0].includes("s960x960"), true);
  assertEquals(m.images.some((u) => u.includes("rsrc.php")), false); // chrome excluded
});

Deno.test("parseIframeMedia: carousel — one url per distinct card id (3 cards + logo)", () => {
  const m = parseIframeMedia(IFRAME_CAROUSEL);
  // Three distinct 480 card ids + one 200 logo = 4 distinct media ids.
  assertEquals(m.images.length, 4);
  const cards = m.images.filter((u) => u.includes("s480x480"));
  assertEquals(cards.length, 3);
});

Deno.test("rankImageCandidates: dedups by media id, keeps highest size hint per id", () => {
  // Two variants of the SAME media id (222222222) at different sizes.
  const html =
    `<img src="https://scontent.xx.fbcdn.net/v/t45/111111_222222222_333_n.jpg?stp=s320x320"/>` +
    `<img src="https://scontent.xx.fbcdn.net/v/t45/111111_222222222_444_n.jpg?stp=s960x960"/>`;
  const out = rankImageCandidates(html);
  assertEquals(out.length, 1); // same media id (…_222222222_…) → one entry
  assertEquals(out[0].includes("s960x960"), true); // higher hint wins
});

Deno.test("imageSizeHint + isFbcdnHost", () => {
  assertEquals(imageSizeHint("https://x.fbcdn.net/a.jpg?stp=dst-jpg_s960x960"), 960);
  assertEquals(imageSizeHint("https://x.fbcdn.net/a.jpg"), 0);
  assertEquals(isFbcdnHost("https://scontent-a.xx.fbcdn.net/x.jpg"), true);
  assertEquals(isFbcdnHost("https://facebook.com/x"), false);
});

// ── Quota circuit breaker ─────────────────────────────────────────────────────
Deno.test("parseUsageHeader: max across x-app-usage dimensions", () => {
  assertEquals(parseUsageHeader(`{"call_count":80,"total_cputime":12,"total_time":40}`), 80);
  assertEquals(parseUsageHeader(null), 0);
  assertEquals(parseUsageHeader("not json"), 0);
});

Deno.test("parseGraphUsage: peak across x-app-usage AND x-business-use-case-usage", () => {
  const peak = parseGraphUsage({
    appUsage: `{"call_count":10,"total_time":5}`,
    businessUseCase: `{"570190447554146":[{"type":"ads_management","call_count":92,"total_time":1}]}`,
  });
  assertEquals(peak, 92);
});

Deno.test("quotaDecision: >90 stop, >75 pause, else ok", () => {
  assertEquals(quotaDecision(50), "ok");
  assertEquals(quotaDecision(75), "ok"); // strictly greater
  assertEquals(quotaDecision(76), "pause");
  assertEquals(quotaDecision(90), "pause");
  assertEquals(quotaDecision(91), "stop");
});

// ── Retry / backoff ───────────────────────────────────────────────────────────
Deno.test("retry: never attempted → run; >= max → terminal", () => {
  assertEquals(retryDecision({ attempts: 0, lastAttemptAt: null, now: Date.now() }).action, "run");
  assertEquals(
    retryDecision({ attempts: CAPTURE_MAX_ATTEMPTS, lastAttemptAt: null, now: Date.now() }).action,
    "terminal",
  );
});

Deno.test("retry: inside backoff → backoff; past it → run; force bypasses both", () => {
  const now = 1_000_000_000_000;
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
  assertEquals(retryDecision({ attempts: 1, lastAttemptAt: tenMinAgo, now }).action, "backoff");
  const thirtyOneMinAgo = new Date(now - 31 * 60 * 1000).toISOString();
  assertEquals(retryDecision({ attempts: 1, lastAttemptAt: thirtyOneMinAgo, now }).action, "run");
  assertEquals(
    retryDecision({ attempts: 99, lastAttemptAt: new Date(now).toISOString(), now, force: true }).action,
    "run",
  );
});

Deno.test("captureBackoffMs: exponential 0 → 30m → 60m → 120m", () => {
  assertEquals(captureBackoffMs(0), 0);
  assertEquals(captureBackoffMs(1), 30 * 60 * 1000);
  assertEquals(captureBackoffMs(2), 60 * 60 * 1000);
  assertEquals(captureBackoffMs(3), 120 * 60 * 1000);
});

// ── Final status ──────────────────────────────────────────────────────────────
Deno.test("finalStatus: landed → captured; no media & <max → pending; >=max → failed", () => {
  assertEquals(finalCaptureStatus({ landedAny: true, attempts: 1 }), { status: "captured", terminal: true });
  assertEquals(finalCaptureStatus({ landedAny: false, attempts: 1 }), { status: "pending", terminal: false });
  assertEquals(
    finalCaptureStatus({ landedAny: false, attempts: CAPTURE_MAX_ATTEMPTS }),
    { status: "failed", terminal: true },
  );
});

// ── Gates ─────────────────────────────────────────────────────────────────────
Deno.test("isStorageOwnedUrl / alreadyCovered", () => {
  assertEquals(isStorageOwnedUrl("https://p/storage/v1/object/public/ad-videos/x.mp4"), true);
  assertEquals(isStorageOwnedUrl("https://video.fbcdn.net/hd.mp4"), false);
  assertEquals(alreadyCovered({ video_url: "https://p/storage/v1/object/public/x.mp4", full_res_url: null }), true);
  assertEquals(alreadyCovered({ video_url: "no-video", full_res_url: null }), false);
});

Deno.test("media intent: video ids OR image hashes; else no_media_intent (no archive-id gate)", () => {
  assertEquals(hasVideoIntent({ meta_video_ids: ["1"] }), true);
  assertEquals(isImageAd({ meta_image_hashes: ["h"] }), true);
  assertEquals(mediaIntentSkipReason({ meta_video_ids: ["1"], meta_image_hashes: [] }), null);
  assertEquals(mediaIntentSkipReason({ meta_video_ids: [], meta_image_hashes: ["h"] }), null);
  assertEquals(mediaIntentSkipReason({ meta_video_ids: [], meta_image_hashes: [] }), "no_media_intent");
});

// ── Media update planner (sentinel-safe) ──────────────────────────────────────
Deno.test("plan: writes captured media into empty columns", () => {
  const u = planCreativeMediaUpdate(
    { video_url: null, full_res_url: null },
    {
      video: { publicUrl: "https://x/storage/v1/object/public/ad-videos/a/assets/h.mp4", assetId: "v1" },
      image: { publicUrl: "https://x/storage/v1/object/public/ad-thumbnails/a/assets/h.jpg", assetId: "t1" },
    },
  );
  assertEquals(u.video_url, "https://x/storage/v1/object/public/ad-videos/a/assets/h.mp4");
  assertEquals(u.full_res_url, "https://x/storage/v1/object/public/ad-thumbnails/a/assets/h.jpg");
  assertEquals(u.thumbnail_url, u.full_res_url);
  assertEquals(u.image_quality, "full_res");
});

Deno.test("plan: NEVER overwrites an existing storage-owned url", () => {
  const existing = "https://x/storage/v1/object/public/ad-videos/a/assets/old.mp4";
  const u = planCreativeMediaUpdate(
    { video_url: existing, full_res_url: existing },
    {
      video: { publicUrl: "https://x/storage/v1/object/public/ad-videos/a/assets/new.mp4" },
      image: { publicUrl: "https://x/storage/v1/object/public/ad-thumbnails/a/assets/new.jpg" },
    },
  );
  assertEquals(Object.keys(u).length, 0);
});
