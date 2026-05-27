// deno-lint-ignore no-explicit-any
export type ApifyItem = Record<string, any>;

export type TrendingItem = {
  sourceUrl: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  creatorHandle: string | null;
  viewCount: number | null;
  likeCount: number | null;
  shareCount: number | null;
};

export type TrendingConfig = {
  actorId: string;
  /** Optional actor override used only for search queries (different from trending actor). */
  searchActorId?: string;
  buildInput: (maxItems: number) => Record<string, unknown>;
  buildSearchInput: (query: string, maxItems: number) => Record<string, unknown>;
  normalize: (item: ApifyItem) => TrendingItem | null;
};

// Hashtags used for the trending pass — TikTok Shop product-selling focus.
//
// clockworks~tiktok-scraper DOES NOT use a "type" discriminator — the actor
// routes by which input array is populated (hashtags[], searchQueries[],
// profiles[], postURLs[]). The "type" field is ignored and "trending" causes
// an immediate actor crash (FAILED in ~2s). Never add it back.
//
// KEY: the item-count field is `resultsPerPage` (per hashtag), NOT `maxItems`.
// Passing `maxItems` is silently ignored — the actor defaults to resultsPerPage=1,
// yielding exactly 1 item × N hashtags. Discovered 2026-05-26.
//
// Residential proxies are built into clockworks by default — no proxyConfiguration
// needed. Add `proxyCountryCode: "US"` to pin to US-based IPs so TikTok Shop
// content (which is US-specific) is returned correctly.
//
// 4 hashtags × resultsPerPage items = total yield. Keep the list small and
// high-signal so the budget concentrates on purchase-intent content.
// These four represent the largest TikTok Shop communities (combined ~15B+ views).
const TIKTOK_TRENDING_HASHTAGS = [
  "tiktokmademebuyit", // "TikTok made me buy it" — highest purchase intent
  "tiktokshopfinds",   // Product discovery hauls — viral shop items
  "tiktokshop",        // Broad TikTok Shop ecosystem
  "shopwithtiktok",    // TikTok shopping discovery content
];

export const TRENDING_CONFIGS: Record<string, TrendingConfig> = {
  tiktok: {
    actorId: "clockworks~tiktok-scraper",
    buildInput: (maxItems) => ({
      hashtags: TIKTOK_TRENDING_HASHTAGS,
      // Distribute the total budget evenly across hashtags.
      resultsPerPage: Math.ceil(maxItems / TIKTOK_TRENDING_HASHTAGS.length),
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
      // Pin to US IPs — TikTok Shop content is US-specific.
      proxyCountryCode: "US",
    }),
    buildSearchInput: (query, maxItems) => ({
      // searchQueries[] routes the actor to keyword search mode.
      // resultsPerPage applies per query term.
      searchQueries: [query],
      resultsPerPage: maxItems,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
      proxyCountryCode: "US",
    }),
    normalize: (item) => {
      // Field paths vary across clockworks (trending/hashtag/search) and
      // apidojo actor modes. Try every known variant so items survive
      // regardless of which actor or mode produced them.
      const handle =
        item.authorMeta?.name ??
        item.authorMeta?.uniqueId ??
        item.author?.uniqueId ??
        item.author?.name ??
        item.username ??         // apidojo flat schema
        item.authorName ??
        null;
      const videoId = item.id ?? item.videoId ?? null;
      const url =
        item.webVideoUrl ??
        item.videoUrl ??
        item.url ??              // apidojo flat schema
        item.postUrl ??
        (handle && videoId
          ? `https://www.tiktok.com/@${handle}/video/${videoId}`
          : null);
      if (!url) return null;
      return {
        sourceUrl: url,
        title: item.text ?? item.desc ?? item.description ?? item.title ?? null,
        description: null,
        thumbnailUrl:
          item.videoMeta?.originalCoverUrl ??
          item.videoMeta?.coverUrl ??
          item.covers?.[0] ??
          item.imageUrls?.[0] ??
          item.coverUrl ??
          item.thumbnailUrl ??   // apidojo flat schema
          item.thumbnail ??
          null,
        creatorHandle:
          item.authorMeta?.nickName ??
          item.authorMeta?.name ??
          item.author?.nickname ??
          item.author?.uniqueId ??
          item.nickname ??       // apidojo flat schema
          item.username ??
          null,
        viewCount:
          item.videoMeta?.playCount ??
          item.playCount ??
          item.statsV2?.playCount ??
          item.viewCount ??      // apidojo flat schema
          item.views ??
          null,
        likeCount:
          item.videoMeta?.diggCount ??
          item.diggCount ??
          item.statsV2?.diggCount ??
          item.likeCount ??      // apidojo flat schema
          item.likes ??
          null,
        shareCount:
          item.videoMeta?.shareCount ??
          item.shareCount ??
          item.statsV2?.shareCount ??
          item.shares ??         // apidojo flat schema
          null,
      };
    },
  },
};

export const SUPPORTED_PLATFORMS = Object.keys(TRENDING_CONFIGS);
