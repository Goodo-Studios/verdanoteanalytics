// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/apify-capture-logic.test.ts
//
// Fixtures are shaped from the US-000 real actor output (see
// companies/verdanote/projects/apify-creative-capture/US-000-spike.md section 8):
// videos under snapshot.videos[].videoHdUrl|videoSdUrl, statics under
// snapshot.images[].originalImageUrl, carousel under snapshot.cards[]; adArchiveID
// present, adId null; an empty/private lookup returns ONE billed item shaped
// {"error":"no_items", ...}.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alreadyCovered,
  apifyBackoffMs,
  APIFY_COST_PER_ITEM_USD,
  APIFY_MAX_ATTEMPTS,
  archiveIdSkipReason,
  buildAdArchiveUrl,
  budgetDecision,
  computeSpendUsd,
  finalCaptureStatus,
  isStorageOwnedUrl,
  parseApifyCaptureResult,
  planCreativeMediaUpdate,
  retryDecision,
} from "./apify-capture-logic.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A real single-video ad (720x1280 H.264 mp4, ~14MB in the spike). adId is null.
const VIDEO_AD_ITEMS = [{
  adArchiveID: "1498351558582364",
  adId: null,
  pageName: "Cattasaurus",
  snapshot: {
    videos: [{
      videoHdUrl: "https://video.fbcdn.net/v/hd.mp4?_nc=1",
      videoSdUrl: "https://video.fbcdn.net/v/sd.mp4?_nc=1",
      videoPreviewImageUrl: "https://scontent.fbcdn.net/v/preview.jpg",
    }],
    images: [],
    cards: [],
    body: { text: "Give your cat the softest bed." },
  },
}];

// A real single-static ad (full-res JPEG ~902KB in the spike).
const STATIC_AD_ITEMS = [{
  adArchiveID: "999000111222333",
  adId: null,
  snapshot: {
    videos: [],
    images: [{
      originalImageUrl: "https://scontent.fbcdn.net/v/original.jpg?_nc=1",
      resizedImageUrl: "https://scontent.fbcdn.net/v/resized.jpg?_nc=1",
    }],
    cards: [],
  },
}];

// Empty / private ad — the actor still returns (and bills) ONE error item.
const EMPTY_ITEMS = [{
  error: "no_items",
  errorDescription: "Empty or private data for provided input",
}];

// A carousel ad — media lives under snapshot.cards[]; no top-level videos/images.
const CAROUSEL_ITEMS = [{
  adArchiveID: "555444333222111",
  adId: null,
  snapshot: {
    videos: [],
    images: [],
    cards: [
      { originalImageUrl: "https://scontent.fbcdn.net/v/card0.jpg", body: "Card 0" },
      { originalImageUrl: "https://scontent.fbcdn.net/v/card1.jpg", body: "Card 1" },
      { videoHdUrl: "https://video.fbcdn.net/v/card2.mp4", body: "Card 2" },
    ],
  },
}];

// ── URL builder ──────────────────────────────────────────────────────────────
Deno.test("buildAdArchiveUrl: produces THE locked ?id= URL with ALL enrichment", () => {
  const u = new URL(buildAdArchiveUrl("1498351558582364"));
  assertEquals(u.hostname, "www.facebook.com");
  assertEquals(u.pathname, "/ads/library/");
  assertEquals(u.searchParams.get("id"), "1498351558582364");
  assertEquals(u.searchParams.get("active_status"), "all");
  assertEquals(u.searchParams.get("ad_type"), "all");
  assertEquals(u.searchParams.get("country"), "ALL");
});

Deno.test("buildAdArchiveUrl: exact string is the only URL ever sent", () => {
  assertEquals(
    buildAdArchiveUrl("123"),
    "https://www.facebook.com/ads/library/?id=123&active_status=all&ad_type=all&country=ALL",
  );
});

// ── Parser: real video ad ────────────────────────────────────────────────────
Deno.test("parse: video ad — prefers videoHdUrl, thumbnail from preview image", () => {
  const p = parseApifyCaptureResult(VIDEO_AD_ITEMS);
  assertEquals(p.found, true);
  assertEquals(p.empty, false);
  assertEquals(p.adArchiveId, "1498351558582364");
  assertEquals(p.video, "https://video.fbcdn.net/v/hd.mp4?_nc=1"); // HD preferred over SD
  assertEquals(p.image, "https://scontent.fbcdn.net/v/preview.jpg"); // video preview image
  assertEquals(p.isCarousel, false);
  assertEquals(p.cards.length, 0);
});

Deno.test("parse: video ad falls back to SD when HD absent", () => {
  const items = [{ adArchiveID: "x", snapshot: { videos: [{ videoSdUrl: "https://v/sd.mp4" }] } }];
  assertEquals(parseApifyCaptureResult(items).video, "https://v/sd.mp4");
});

// ── Parser: real static ad ───────────────────────────────────────────────────
Deno.test("parse: static ad — originalImageUrl, no video", () => {
  const p = parseApifyCaptureResult(STATIC_AD_ITEMS);
  assertEquals(p.found, true);
  assertEquals(p.empty, false);
  assertEquals(p.video, null);
  assertEquals(p.image, "https://scontent.fbcdn.net/v/original.jpg?_nc=1");
  assertEquals(p.isCarousel, false);
});

// ── Parser: empty / no_items ─────────────────────────────────────────────────
Deno.test("parse: empty/private ad (error item) -> empty, no media", () => {
  const p = parseApifyCaptureResult(EMPTY_ITEMS);
  assertEquals(p.found, false);
  assertEquals(p.empty, true);
  assertEquals(p.video, null);
  assertEquals(p.image, null);
  assertEquals(p.cards.length, 0);
});

Deno.test("parse: zero-length dataset -> empty (defensive)", () => {
  const p = parseApifyCaptureResult([]);
  assertEquals(p.empty, true);
  assertEquals(p.found, false);
});

Deno.test("parse: non-array input -> empty (defensive)", () => {
  assertEquals(parseApifyCaptureResult(null).empty, true);
  assertEquals(parseApifyCaptureResult({}).empty, true);
});

// ── Parser: carousel ─────────────────────────────────────────────────────────
Deno.test("parse: carousel — cards in order, primary media from first card", () => {
  const p = parseApifyCaptureResult(CAROUSEL_ITEMS);
  assertEquals(p.found, true);
  assertEquals(p.isCarousel, true);
  assertEquals(p.cards.length, 3);
  assertEquals(p.cards[0].image, "https://scontent.fbcdn.net/v/card0.jpg");
  assertEquals(p.cards[1].image, "https://scontent.fbcdn.net/v/card1.jpg");
  assertEquals(p.cards[2].video, "https://video.fbcdn.net/v/card2.mp4");
  // Primary image falls back to first card image; primary video to first card video.
  assertEquals(p.image, "https://scontent.fbcdn.net/v/card0.jpg");
  assertEquals(p.video, "https://video.fbcdn.net/v/card2.mp4");
});

// ── Budget decision (AC#2) ───────────────────────────────────────────────────
Deno.test("budget: NULL cap is UNCAPPED -> always allowed", () => {
  assertEquals(budgetDecision({ capUsd: null, spentUsd: 9999 }).allowed, true);
  assertEquals(budgetDecision({ capUsd: undefined, spentUsd: 9999 }).allowed, true);
});
Deno.test("budget: spent >= cap -> budget_exceeded", () => {
  assertEquals(budgetDecision({ capUsd: 2, spentUsd: 2 }), { allowed: false, reason: "budget_exceeded" });
  assertEquals(budgetDecision({ capUsd: 2, spentUsd: 2.5 }), { allowed: false, reason: "budget_exceeded" });
});
Deno.test("budget: spent < cap -> allowed", () => {
  assertEquals(budgetDecision({ capUsd: 2, spentUsd: 1.995 }).allowed, true);
  assertEquals(budgetDecision({ capUsd: 2, spentUsd: 0 }).allowed, true);
});

// ── Spend charge ─────────────────────────────────────────────────────────────
Deno.test("computeSpendUsd: even an empty lookup bills one item ($0.005)", () => {
  assertEquals(computeSpendUsd(0), APIFY_COST_PER_ITEM_USD);
  assertEquals(computeSpendUsd(1), APIFY_COST_PER_ITEM_USD);
  assertEquals(computeSpendUsd(3), 3 * APIFY_COST_PER_ITEM_USD);
});

// ── Retry / backoff (AC#5) ───────────────────────────────────────────────────
Deno.test("retry: never attempted -> run immediately", () => {
  assertEquals(retryDecision({ attempts: 0, lastAttemptAt: null, now: Date.now() }).action, "run");
});
Deno.test("retry: attempts >= max -> terminal", () => {
  assertEquals(retryDecision({ attempts: APIFY_MAX_ATTEMPTS, lastAttemptAt: null, now: Date.now() }).action, "terminal");
});
Deno.test("retry: inside backoff window -> backoff; past it -> run", () => {
  const now = 1_000_000_000_000;
  const last = new Date(now - 10 * 60 * 1000).toISOString(); // 10 min ago
  // After 1 attempt the wait is 30 min, so 10 min later is still backing off.
  assertEquals(retryDecision({ attempts: 1, lastAttemptAt: last, now }).action, "backoff");
  const older = new Date(now - 31 * 60 * 1000).toISOString(); // 31 min ago > 30 min
  assertEquals(retryDecision({ attempts: 1, lastAttemptAt: older, now }).action, "run");
});
Deno.test("retry: exponential — 2nd attempt waits 60 min", () => {
  assertEquals(apifyBackoffMs(0), 0);
  assertEquals(apifyBackoffMs(1), 30 * 60 * 1000);
  assertEquals(apifyBackoffMs(2), 60 * 60 * 1000);
  assertEquals(apifyBackoffMs(3), 120 * 60 * 1000);
});
Deno.test("retry: force bypasses attempt cap AND backoff", () => {
  const now = Date.now();
  assertEquals(retryDecision({ attempts: 99, lastAttemptAt: new Date(now).toISOString(), now, force: true }).action, "run");
});

// ── Final status (AC#5) ──────────────────────────────────────────────────────
Deno.test("finalStatus: landed media -> captured (terminal)", () => {
  assertEquals(finalCaptureStatus({ landedAny: true, attempts: 1 }), { status: "captured", terminal: true });
});
Deno.test("finalStatus: no media, attempts<max -> pending (retry)", () => {
  assertEquals(finalCaptureStatus({ landedAny: false, attempts: 1 }), { status: "pending", terminal: false });
});
Deno.test("finalStatus: no media, attempts>=max -> failed (terminal)", () => {
  assertEquals(finalCaptureStatus({ landedAny: false, attempts: APIFY_MAX_ATTEMPTS }), { status: "failed", terminal: true });
});

// ── Creative update planner (AC#4) ───────────────────────────────────────────
Deno.test("plan: writes captured media into empty columns", () => {
  const u = planCreativeMediaUpdate(
    { video_url: null, full_res_url: null },
    { video: { publicUrl: "https://x/storage/v1/object/public/ad-videos/a/assets/h.mp4", assetId: "v1" },
      image: { publicUrl: "https://x/storage/v1/object/public/ad-thumbnails/a/assets/h.jpg", assetId: "t1" } },
  );
  assertEquals(u.video_url, "https://x/storage/v1/object/public/ad-videos/a/assets/h.mp4");
  assertEquals(u.video_asset_id, "v1");
  assertEquals(u.full_res_url, "https://x/storage/v1/object/public/ad-thumbnails/a/assets/h.jpg");
  assertEquals(u.thumbnail_url, u.full_res_url);
  assertEquals(u.image_quality, "full_res");
  assertEquals(u.thumb_asset_id, "t1");
});

Deno.test("plan: NEVER overwrites an existing storage-owned url", () => {
  const existingVideo = "https://x/storage/v1/object/public/ad-videos/a/assets/old.mp4";
  const existingFull = "https://x/storage/v1/object/public/ad-thumbnails/a/assets/old.jpg";
  const u = planCreativeMediaUpdate(
    { video_url: existingVideo, full_res_url: existingFull },
    { video: { publicUrl: "https://x/storage/v1/object/public/ad-videos/a/assets/new.mp4" },
      image: { publicUrl: "https://x/storage/v1/object/public/ad-thumbnails/a/assets/new.jpg" } },
  );
  assertEquals(Object.keys(u).length, 0); // nothing overwritten
});

Deno.test("plan: fills only the missing half (video owned, image missing)", () => {
  const existingVideo = "https://x/storage/v1/object/public/ad-videos/a/assets/old.mp4";
  const u = planCreativeMediaUpdate(
    { video_url: existingVideo, full_res_url: null },
    { image: { publicUrl: "https://x/storage/v1/object/public/ad-thumbnails/a/assets/new.jpg", assetId: "t9" } },
  );
  assertEquals("video_url" in u, false);
  assertEquals(u.full_res_url, "https://x/storage/v1/object/public/ad-thumbnails/a/assets/new.jpg");
  assertEquals(u.thumb_asset_id, "t9");
});

// ── Storage-owned predicate + gates (AC#1) ───────────────────────────────────
Deno.test("isStorageOwnedUrl: matches the SQL %/storage/v1/object/public/% marker", () => {
  assertEquals(isStorageOwnedUrl("https://p/storage/v1/object/public/ad-videos/x.mp4"), true);
  assertEquals(isStorageOwnedUrl("https://video.fbcdn.net/v/hd.mp4"), false);
  assertEquals(isStorageOwnedUrl(null), false);
  assertEquals(isStorageOwnedUrl("no-video"), false); // sentinel is not owned
});

Deno.test("archiveIdSkipReason: only 'resolved' + present id proceeds", () => {
  assertEquals(archiveIdSkipReason("resolved", "123"), null);
  assertEquals(archiveIdSkipReason(null, null), "no_archive_id");
  assertEquals(archiveIdSkipReason("unresolvable", "123"), "no_archive_id");
  assertEquals(archiveIdSkipReason("resolved", null), "no_archive_id"); // status w/o id
});

Deno.test("alreadyCovered: true when video OR full_res is storage-owned", () => {
  assertEquals(alreadyCovered({ video_url: "https://p/storage/v1/object/public/x.mp4", full_res_url: null }), true);
  assertEquals(alreadyCovered({ video_url: null, full_res_url: "https://p/storage/v1/object/public/x.jpg" }), true);
  assertEquals(alreadyCovered({ video_url: "no-video", full_res_url: null }), false); // sentinel not owned
  assertEquals(alreadyCovered({ video_url: "https://video.fbcdn.net/hd.mp4", full_res_url: null }), false);
});
