// deno-lint-ignore no-explicit-any
export type ApifyItem = Record<string, any>;

export type ActorConfig = {
  actorId: string;
  buildInput: (url: string) => Record<string, unknown>;
  extractVideoUrl: (item: ApifyItem) => string | null;
  extractThumbnailUrl: (item: ApifyItem) => string | null;
  extractCreatorHandle: (item: ApifyItem) => string | null;
  /** Optional — available for metadata-only platforms (YouTube, Twitter). */
  extractTitle?: (item: ApifyItem) => string | null;
  /**
   * Optional extra query params passed to the Apify /acts/{id}/runs endpoint
   * (e.g. timeout, memory). Appended after token + webhooks in vault-extract.
   */
  apiRunOptions?: Record<string, string | number>;
};

export type ExtractResult = {
  videoUrl: string;
  thumbnailUrl: string | null;
  creatorHandle: string | null;
};

// Actor IDs use ~ not / in the API path.
// TikTok: shouldDownloadVideos=true populates videoMeta.downloadAddr (no-watermark CDN URL).
//   Without it those fields are null — signed tokens only exist after the download step.
// Instagram: apify/instagram-scraper returns videoUrl on video posts.
// YouTube:  streamers/youtube-scraper returns metadata only (no downloadable video URL).
// Twitter/X: apidojo/tweet-scraper — replaced deprecated quacker/twitter-scraper.
//   Returns text, author.userName, media[]. Video extraction is best-effort;
//   tweets without video fall through to the metadata-only path.
export const ACTOR_CONFIGS: Record<string, ActorConfig> = {
  tiktok: {
    actorId: "clockworks~tiktok-scraper",
    // shouldDownloadVideos=true: actor downloads the video to Apify KV store and
    // returns a signed download URL. Takes 60–120s for longer clips — safe here
    // because we use async run + webhook instead of run-sync.
    buildInput: (url) => ({ postURLs: [url], shouldDownloadVideos: true }),
    extractVideoUrl: (item) =>
      item?.videoMeta?.downloadAddr ??
      item?.videoUrl ??
      item?.videoMeta?.playAddr ??
      (Array.isArray(item?.mediaUrls) ? item.mediaUrls[0] : null) ??
      null,
    extractThumbnailUrl: (item) =>
      item?.videoMeta?.originalCoverUrl ??
      item?.videoMeta?.coverUrl ??
      item?.videoMeta?.dynamicCover ??
      null,
    extractCreatorHandle: (item) =>
      item?.authorMeta?.nickName ?? item?.authorMeta?.name ?? null,
  },
  instagram: {
    actorId: "apify~instagram-scraper",
    buildInput: (url) => ({ directUrls: [url], resultsType: "posts", resultsLimit: 1 }),
    extractVideoUrl: (item) => item?.videoUrl ?? item?.video_url ?? null,
    extractThumbnailUrl: (item) => item?.displayUrl ?? item?.thumbnailUrl ?? null,
    extractCreatorHandle: (item) => item?.ownerUsername ?? null,
  },
  youtube: {
    // marielise.dev~youtube-video-downloader: actively maintained (updated 2 days ago),
    // stores the video in Apify KV store and returns a downloadUrl pointing to
    // api.apify.com — the same pattern as TikTok. vault-extract-webhook's
    // isApifyStorage check automatically appends the token before downloading.
    // YouTube is kept in METADATA_ONLY_PLATFORMS as a graceful fallback: if
    // downloadUrl is null (private/age-restricted video) we save the title and
    // mark the item ready without transcription.
    // apiRunOptions.timeout: actor checks run timeout and emits CONFIG_TIMEOUT_TOO_LOW
    // if the value is ≤ 300. Must be strictly > 300 (600s tested + confirmed working).
    // The default for this actor is 300s, which triggers the error — always override.
    actorId: "marielise.dev~youtube-video-downloader",
    buildInput: (url) => ({ urls: [{ url }] }),
    apiRunOptions: { timeout: 600 },
    extractVideoUrl: (item) => item?.downloadUrl ?? null,
    extractThumbnailUrl: (item) => item?.thumbnail ?? item?.thumbnailUrl ?? null,
    extractCreatorHandle: (item) => item?.uploader ?? item?.channelName ?? null,
    extractTitle: (item) => item?.title ?? null,
  },
  facebook_ad: {
    // apify~facebook-ads-scraper: official Apify actor for Meta Ad Library.
    // Input: startUrls requires { url } objects (not bare strings) — actor validates .url property.
    // Output: 57 fields per ad; video/image URLs are flat indexed columns (videoUrl1, imageUrl1-5).
    // CDN URLs (*.fbcdn.net) are time-limited — vault-extract-webhook must download within ~5 min
    // of actor completion. actor does NOT store to Apify KV, so isApifyStorage will be false.
    // apiRunOptions.memory: Facebook ad pages are heavier than TikTok — 2048 MB recommended.
    // Field names validated against E2E smoke test in US-004.
    actorId: "apify~facebook-ads-scraper",
    buildInput: (url) => ({ startUrls: [{ url }] }),
    apiRunOptions: { memory: 2048 },
    extractVideoUrl: (item) => {
      // v2 output: video data lives under snapshot.videos[]
      const snapVideos = item?.snapshot?.videos;
      if (Array.isArray(snapVideos) && snapVideos.length > 0) {
        return snapVideos[0]?.video_hd_url ?? snapVideos[0]?.video_sd_url ?? null;
      }
      // v1 flat output fallback
      return item?.videoUrl1 ?? item?.videoUrl ?? item?.video_hd_url ?? item?.video_sd_url ?? null;
    },
    extractThumbnailUrl: (item) => {
      // v2: snapshot.images[] or snapshot.videos[].video_preview_image_url
      const snapImages = item?.snapshot?.images;
      if (Array.isArray(snapImages) && snapImages.length > 0) {
        return snapImages[0]?.original_image_url ?? snapImages[0]?.resized_image_url ?? null;
      }
      const snapVideos = item?.snapshot?.videos;
      if (Array.isArray(snapVideos) && snapVideos.length > 0) {
        return snapVideos[0]?.video_preview_image_url ?? null;
      }
      // v1 flat fallback
      return item?.imageUrl1 ?? item?.thumbnailUrl ?? item?.thumbnail_url ?? item?.snapshot_url ?? null;
    },
    extractCreatorHandle: (item) =>
      item?.pageName ?? item?.page_name ?? item?.advertiserName ?? null,
    extractTitle: (item) => {
      // v2: snapshot.body.text or snapshot.cards[0].body or snapshot.caption
      const snapText =
        item?.snapshot?.body?.text ??
        item?.snapshot?.cards?.[0]?.body ??
        item?.snapshot?.caption ??
        item?.adBodyText ??
        item?.bodyText ??
        item?.body ??
        item?.title ??
        item?.headline ??
        "";
      return typeof snapText === "string" && snapText.length > 0 ? snapText.slice(0, 120) : null;
    },
  },
  twitter: {
    // apidojo~tweet-scraper: actively maintained, no special permission approval needed.
    // Input: startUrls as plain strings (not { url } objects like quacker used).
    // Output uses camelCase: text, author.userName, extendedEntities.media[].
    // snake_case fallbacks retained so any cached runs from quacker still parse correctly.
    actorId: "apidojo~tweet-scraper",
    buildInput: (url) => ({ startUrls: [url], maxItems: 1 }),
    extractVideoUrl: (item) => {
      // Try camelCase (apidojo) then snake_case (quacker fallback)
      const mediaArr =
        item?.extendedEntities?.media ??
        item?.extended_entities?.media ??
        item?.media ??
        [];
      for (const m of mediaArr) {
        const variants =
          (m?.videoInfo?.variants as Array<{ contentType?: string; content_type?: string; url: string; bitrate?: number }> | undefined) ??
          (m?.video_info?.variants as Array<{ content_type?: string; url: string; bitrate?: number }> | undefined);
        if (!variants?.length) continue;
        const mp4s = variants.filter(
          (v) => (v.contentType ?? v.content_type) === "video/mp4"
        );
        if (!mp4s.length) continue;
        mp4s.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
        return mp4s[0]?.url ?? null;
      }
      return null;
    },
    extractThumbnailUrl: (item) =>
      item?.extendedEntities?.media?.[0]?.mediaUrlHttps ??
      item?.extended_entities?.media?.[0]?.media_url_https ??
      item?.author?.profilePicture ??
      null,
    extractCreatorHandle: (item) =>
      item?.author?.userName ?? item?.user?.screen_name ?? null,
    extractTitle: (item) =>
      ((item?.text ?? item?.full_text ?? "") as string).slice(0, 120) || null,
  },
};
