// Deno tests for the US-001B ad_archive_id match-back core.
// Fixtures mirror the two real upstream shapes:
//   • Meta Ad Library Graph `ads_archive` objects (free path)
//   • Apify `apify~facebook-ads-scraper` v2 items (fallback path; adId is null,
//     media under snapshot.videos/images/cards) — shape confirmed by US-000.
//
// Run: deno test -A --no-check supabase/functions/_shared/ad-archive-match.test.ts

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildCreativeIndex,
  buildStoryId,
  type CreativeForMatch,
  jaccard,
  matchAd,
  normalizeApifyItem,
  normalizeGraphAd,
  tokenizeCopy,
} from "./ad-archive-match.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CREATIVES: CreativeForMatch[] = [
  {
    ad_id: "act_ad_1001",
    account_id: "act_100",
    ad_name: "VN | Sarah | UGC | Glow Serum | Hook-Morning-Routine",
    campaign_name: "Glow Serum Prospecting",
    effective_object_story_id: "778899_112233",
    meta_video_ids: ["vid_aaa111"],
    meta_image_hashes: [],
    destination_key: "https://verdanote.com/products/glow-serum",
    ad_post_url: null,
  },
  {
    ad_id: "act_ad_1002",
    account_id: "act_100",
    ad_name: "VN | Static | Night Cream | Discount-20",
    campaign_name: "Night Cream Retargeting",
    effective_object_story_id: "778899_445566",
    meta_video_ids: [],
    meta_image_hashes: ["img_hash_bbb222"],
    destination_key: "https://verdanote.com/products/night-cream",
    ad_post_url: null,
  },
  {
    ad_id: "act_ad_1003",
    account_id: "act_100",
    // Shares the SAME story as another ad (boosted post used twice) — exact anchor
    // must return BOTH.
    ad_name: "VN | Sarah | UGC | Glow Serum | Hook-Before-After",
    campaign_name: "Glow Serum Prospecting",
    effective_object_story_id: "778899_112233",
    meta_video_ids: ["vid_aaa111"],
    meta_image_hashes: [],
    destination_key: "https://verdanote.com/products/glow-serum",
    ad_post_url: null,
  },
  {
    ad_id: "act_ad_2001",
    account_id: "act_100",
    ad_name: "VN | Bundle | Skincare Starter Kit | Fathers-Day",
    campaign_name: "Bundle Push",
    effective_object_story_id: null,
    meta_video_ids: [],
    meta_image_hashes: [],
    destination_key: "https://verdanote.com/collections/starter-kit",
    ad_post_url: null,
  },
];

// ── tokenize / jaccard ───────────────────────────────────────────────────────

Deno.test("tokenizeCopy drops stopwords, short tokens, urls, punctuation", () => {
  const toks = tokenizeCopy("Shop the BEST Glow Serum now! https://x.co/y 💧");
  assertEquals(toks.has("glow"), true);
  assertEquals(toks.has("serum"), true);
  assertEquals(toks.has("shop"), false); // stopword
  assertEquals(toks.has("the"), false); // stopword
  assertEquals(toks.has("now"), false); // stopword
  assertEquals([...toks].some((t) => t.includes("http")), false);
});

Deno.test("jaccard is 0 for disjoint / empty and 1 for identical", () => {
  assertEquals(jaccard(new Set(["a", "b"]), new Set()), 0);
  assertEquals(jaccard(new Set(["a", "b"]), new Set(["c", "d"])), 0);
  assertEquals(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
});

Deno.test("buildStoryId folds page+post and passes through full ids", () => {
  assertEquals(buildStoryId("778899", "112233"), "778899_112233");
  assertEquals(buildStoryId("778899", "778899_112233"), "778899_112233");
  assertEquals(buildStoryId(null, "112233"), null);
  assertEquals(buildStoryId("778899", null), null);
});

// ── Graph normalizer ─────────────────────────────────────────────────────────

Deno.test("normalizeGraphAd extracts id, page, copy tokens, caption-as-link", () => {
  const ad = normalizeGraphAd({
    id: "9988776655",
    page_id: "778899",
    ad_creative_bodies: ["Wake up to a Glow Serum morning routine"],
    ad_creative_link_titles: ["Glow Serum"],
    ad_creative_link_captions: ["verdanote.com"],
    ad_creative_link_descriptions: ["Dermatologist tested"],
  });
  assertExists(ad);
  assertEquals(ad!.adArchiveId, "9988776655");
  assertEquals(ad!.pageId, "778899");
  assertEquals(ad!.storyId, null); // free API never exposes it
  assertEquals(ad!.videoIds.length, 0);
  assertEquals(ad!.linkUrls.includes("https://verdanote.com/"), true);
  assertEquals(ad!.textTokens.includes("glow"), true);
});

Deno.test("normalizeGraphAd returns null without an id", () => {
  assertEquals(normalizeGraphAd({ page_id: "1" }), null);
  assertEquals(normalizeGraphAd({}), null);
});

// ── Apify normalizer ─────────────────────────────────────────────────────────

Deno.test("normalizeApifyItem keys on adArchiveID (adId is null) and reads snapshot", () => {
  const item = {
    adId: null, // US-000: always null on this actor
    adArchiveID: "9988776655",
    pageId: "778899",
    snapshot: {
      pageId: "778899",
      body: { text: "Wake up to a Glow Serum morning routine" },
      title: "Glow Serum",
      linkUrl: "https://verdanote.com/products/glow-serum?utm_source=fb",
      videos: [{ videoId: "vid_aaa111", videoHdUrl: "https://cdn/x.mp4" }],
      images: [],
      cards: [],
    },
  };
  const ad = normalizeApifyItem(item);
  assertExists(ad);
  assertEquals(ad!.adArchiveId, "9988776655");
  assertEquals(ad!.pageId, "778899");
  assertEquals(ad!.videoIds.includes("vid_aaa111"), true);
  // utm stripped by normalizeDestinationUrl
  assertEquals(
    ad!.linkUrls.includes("https://verdanote.com/products/glow-serum"),
    true,
  );
});

Deno.test("normalizeApifyItem folds carousel cards", () => {
  const ad = normalizeApifyItem({
    adArchiveID: "111",
    snapshot: {
      pageId: "778899",
      cards: [
        { title: "Night Cream", body: "Discount 20 percent", linkUrl: "https://verdanote.com/products/night-cream", videoId: "vid_card_1" },
      ],
    },
  });
  assertExists(ad);
  assertEquals(ad!.videoIds.includes("vid_card_1"), true);
  assertEquals(ad!.linkUrls.includes("https://verdanote.com/products/night-cream"), true);
  assertEquals(ad!.textTokens.includes("night"), true);
});

// ── matcher: tier priority ───────────────────────────────────────────────────

Deno.test("matchAd tier 1: story_id returns ALL creatives sharing the post", () => {
  const index = buildCreativeIndex(CREATIVES);
  const ad = normalizeApifyItem({
    adArchiveID: "9988776655",
    snapshot: { pageId: "778899", postId: "112233" },
  });
  const res = matchAd(ad!, index);
  assertExists(res);
  assertEquals(res!.tier, "story_id");
  assertEquals(res!.adIds.sort(), ["act_ad_1001", "act_ad_1003"]);
});

Deno.test("matchAd tier 2: video_id when no story match", () => {
  const index = buildCreativeIndex(CREATIVES);
  const ad = normalizeApifyItem({
    adArchiveID: "555",
    snapshot: { pageId: "000", videos: [{ videoId: "vid_aaa111" }] },
  });
  const res = matchAd(ad!, index);
  assertExists(res);
  assertEquals(res!.tier, "video_id");
  assertEquals(res!.adIds.sort(), ["act_ad_1001", "act_ad_1003"]);
});

Deno.test("matchAd tier 3: image_hash", () => {
  const index = buildCreativeIndex(CREATIVES);
  const ad = normalizeApifyItem({
    adArchiveID: "556",
    snapshot: { pageId: "000", images: [{ hash: "img_hash_bbb222" }] },
  });
  const res = matchAd(ad!, index);
  assertExists(res);
  assertEquals(res!.tier, "image_hash");
  assertEquals(res!.adIds, ["act_ad_1002"]);
});

Deno.test("matchAd tier 4: unique link match accepted", () => {
  const index = buildCreativeIndex(CREATIVES);
  const ad = normalizeGraphAd({
    id: "777",
    page_id: "778899",
    ad_creative_link_captions: ["verdanote.com/collections/starter-kit"],
    ad_creative_bodies: ["totally unrelated wording here"],
  });
  const res = matchAd(ad!, index);
  assertExists(res);
  assertEquals(res!.tier, "link_url");
  assertEquals(res!.adIds, ["act_ad_2001"]);
});

Deno.test("matchAd tier 4: ambiguous link (shared destination) is rejected", () => {
  // Two creatives share the glow-serum destination → link tier must NOT fire.
  const index = buildCreativeIndex(CREATIVES);
  const ad = normalizeGraphAd({
    id: "778",
    page_id: "778899",
    ad_creative_link_captions: ["verdanote.com/products/glow-serum"],
    ad_creative_bodies: ["zzz qqq wholly nonmatching filler copy"],
  });
  const res = matchAd(ad!, index);
  // Shared link is ambiguous and copy doesn't clear threshold → no match.
  assertEquals(res, null);
});

Deno.test("matchAd tier 5: ad_copy fuzzy unique best above threshold", () => {
  const index = buildCreativeIndex(CREATIVES);
  // Strong overlap with the starter-kit bundle name, no exact anchors.
  const ad = normalizeGraphAd({
    id: "779",
    page_id: "999",
    ad_creative_bodies: ["Skincare Starter Kit bundle — perfect Fathers Day gift"],
    ad_creative_link_titles: ["Skincare Starter Kit"],
  });
  const res = matchAd(ad!, index);
  assertExists(res);
  assertEquals(res!.tier, "ad_copy");
  assertEquals(res!.adIds, ["act_ad_2001"]);
});

Deno.test("matchAd returns null when nothing clears any tier", () => {
  const index = buildCreativeIndex(CREATIVES);
  const ad = normalizeGraphAd({
    id: "780",
    page_id: "123",
    ad_creative_bodies: ["completely different product xyzzy plugh frobnicate"],
  });
  assertEquals(matchAd(ad!, index), null);
});

Deno.test("matchAd honors priority: story beats an available video match", () => {
  const index = buildCreativeIndex(CREATIVES);
  // Story points at the 112233 post (ads 1001+1003); a different video id is also
  // present but story must win and set the tier.
  const ad = normalizeApifyItem({
    adArchiveID: "781",
    snapshot: {
      pageId: "778899",
      postId: "112233",
      videos: [{ videoId: "vid_aaa111" }],
    },
  });
  const res = matchAd(ad!, index);
  assertExists(res);
  assertEquals(res!.tier, "story_id");
});

Deno.test("empty creative set never matches", () => {
  const index = buildCreativeIndex([]);
  const ad = normalizeGraphAd({ id: "1", ad_creative_bodies: ["glow serum"] });
  assertEquals(matchAd(ad!, index), null);
});
