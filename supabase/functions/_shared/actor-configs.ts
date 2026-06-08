// deno-lint-ignore no-explicit-any
export type ApifyItem = Record<string, any>;

export type ActorConfig = {
  actorId: string;
  buildInput: (url: string) => Record<string, unknown>;
  /**
   * Optional — if present, vault-extract calls this instead of buildInput,
   * passing all Deno.env vars so the config can inject auth secrets (e.g.
   * LinkedIn session cookies) without hardcoding them in the function.
   */
  buildInputWithEnv?: (url: string, env: Record<string, string>) => Record<string, unknown>;
  extractVideoUrl: (item: ApifyItem) => string | null;
  extractThumbnailUrl: (item: ApifyItem) => string | null;
  extractCreatorHandle: (item: ApifyItem) => string | null;
  /** Optional — available for metadata-only platforms (YouTube, Twitter). */
  extractTitle?: (item: ApifyItem) => string | null;
  /**
   * Optional — full ad copy text for text-based analysis (not truncated).
   * Used by vault-extract-webhook to create an inspiration_transcripts row
   * when no media is extractable, so vault-analyze can still run framework
   * extraction from the written copy alone.
   */
  extractAdCopy?: (item: ApifyItem) => string | null;
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
    //
    // URL enrichment: bare ?id= links (e.g. https://www.facebook.com/ads/library/?id=123) omit
    // the active_status / ad_type / country params that the actor needs to return results. The
    // actor interprets a bare ?id= URL as an empty search and returns nothing. Enrich the URL
    // with these required params before passing to the actor.
    actorId: "apify~facebook-ads-scraper",
    buildInput: (url) => {
      let enrichedUrl = url;
      try {
        const u = new URL(url);
        if (u.searchParams.get("id") && !u.searchParams.get("active_status")) {
          u.searchParams.set("active_status", "all");
          u.searchParams.set("ad_type", "all");
          u.searchParams.set("country", "US");
          enrichedUrl = u.toString();
        }
      } catch { /* keep original */ }
      return { startUrls: [{ url: enrichedUrl }] };
    },
    apiRunOptions: { memory: 2048 },
    extractVideoUrl: (item) => {
      // v2 output: video data lives under snapshot.videos[] with camelCase fields.
      // Field names vary across actor versions — check all known variants.
      const snapVideos = item?.snapshot?.videos;
      if (Array.isArray(snapVideos) && snapVideos.length > 0) {
        const v = snapVideos[0];
        const url = v?.videoHdUrl ?? v?.videoSdUrl ??
                    v?.video_hd_url ?? v?.video_sd_url ??
                    v?.videoUrl ?? v?.video_url ??
                    v?.url ?? v?.src ?? null;
        if (url) return url;
      }
      // Carousel ads: video may live under snapshot.cards[].videoHdUrl
      const snapCards = item?.snapshot?.cards;
      if (Array.isArray(snapCards) && snapCards.length > 0) {
        for (const card of snapCards) {
          const url = card?.videoHdUrl ?? card?.videoSdUrl ??
                      card?.video_hd_url ?? card?.video_sd_url ??
                      card?.videoUrl ?? card?.video_url ?? null;
          if (url) return url;
        }
      }
      // v1 flat output fallback
      return item?.videoUrl1 ?? item?.videoUrl ?? item?.video_hd_url ?? item?.video_sd_url ?? null;
    },
    extractThumbnailUrl: (item) => {
      // v2: snapshot.images[] or snapshot.videos[].videoPreviewImageUrl (camelCase)
      const snapImages = item?.snapshot?.images;
      if (Array.isArray(snapImages) && snapImages.length > 0) {
        return snapImages[0]?.originalImageUrl ?? snapImages[0]?.original_image_url ??
               snapImages[0]?.resizedImageUrl ?? snapImages[0]?.resized_image_url ??
               snapImages[0]?.url ?? snapImages[0]?.src ?? null;
      }
      const snapVideos = item?.snapshot?.videos;
      if (Array.isArray(snapVideos) && snapVideos.length > 0) {
        return snapVideos[0]?.videoPreviewImageUrl ?? snapVideos[0]?.video_preview_image_url ??
               snapVideos[0]?.thumbnailUrl ?? snapVideos[0]?.thumbnail_url ?? null;
      }
      // Carousel card thumbnail fallback
      const snapCards = item?.snapshot?.cards;
      if (Array.isArray(snapCards) && snapCards.length > 0) {
        for (const card of snapCards) {
          const url = card?.originalImageUrl ?? card?.resizedImageUrl ??
                      card?.imageUrl ?? card?.image_url ?? card?.url ?? null;
          if (url) return url;
        }
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
      if (typeof snapText !== "string" || !snapText.length) return null;
      // Meta dynamic ads store unresolved Handlebars vars (e.g. {{product.brand}}) in
      // ad copy when the ad was built with a product catalog template. Return null so
      // the item title stays blank rather than showing raw template syntax to the user.
      if (snapText.includes("{{")) return null;
      return snapText.slice(0, 120);
    },
    extractAdCopy: (item) => {
      // Collect all text sections from the ad into a single block for text-based analysis.
      // Used when Apify returns no media URLs so vault-analyze can still extract framework
      // from the written copy alone (same approach as vault-ads POST handler ad copy path).
      const parts: string[] = [];
      // Headline (link title or card title)
      const headline =
        item?.snapshot?.cards?.[0]?.title ??
        item?.snapshot?.link_title ??
        item?.snapshot?.title ??
        item?.headline ??
        "";
      if (typeof headline === "string" && headline.trim() && !headline.includes("{{")) {
        parts.push(headline.trim());
      }
      // Body text — prefer full snapshot body, fall back to v1 fields
      const body =
        item?.snapshot?.body?.text ??
        item?.snapshot?.caption ??
        item?.adBodyText ??
        item?.bodyText ??
        item?.body ??
        "";
      if (typeof body === "string" && body.trim() && !body.includes("{{")) {
        parts.push(body.trim());
      }
      // Carousel cards (up to 3)
      const cards = item?.snapshot?.cards;
      if (Array.isArray(cards)) {
        for (const card of cards.slice(0, 3)) {
          const cardBody = card?.body ?? "";
          if (typeof cardBody === "string" && cardBody.trim() && !cardBody.includes("{{")) {
            parts.push(cardBody.trim());
          }
        }
      }
      const copy = parts.join("\n\n").trim();
      return copy.length > 10 ? copy : null;
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
  linkedin: {
    // electrifying_haircut~linkedin-post-scraper: free, accepts direct ugcPost/activity URLs.
    // Requires LinkedIn session cookies stored as Supabase secrets:
    //   LINKEDIN_LI_AT      — the li_at cookie from browser DevTools
    //   LINKEDIN_JSESSIONID — the JSESSIONID cookie (strip surrounding quotes)
    // Input uses postUrl (singular string) — postUrls array caused ACTOR.RUN.FAILED.
    // Video field name is undocumented — extractVideoUrl tries all known variants and
    // [linkedin-debug] log lines in vault-extract-webhook expose the actual keys on first run.
    actorId: "electrifying_haircut~linkedin-post-scraper",
    buildInput: (url) => ({ postUrl: url.split("?")[0] }),
    buildInputWithEnv: (url, env) => ({
      postUrl: url.split("?")[0], // strip UTM/tracking params — actor fails to parse activity ID with query string
      ...(env.LINKEDIN_LI_AT ? { li_at: env.LINKEDIN_LI_AT } : {}),
      ...(env.LINKEDIN_JSESSIONID ? { jsessionid: env.LINKEDIN_JSESSIONID } : {}),
    }),
    extractVideoUrl: (item) =>
      // [linkedin-debug] logs in vault-extract-webhook show actual keys on first run.
      item?.video?.url ??
      item?.videoUrl ??
      item?.video?.downloadUrl ??
      item?.video?.streamUrl ??
      (Array.isArray(item?.attachments) && item.attachments.length > 0
        ? (item.attachments[0]?.url ?? item.attachments[0]?.videoUrl ?? null)
        : null) ??
      (Array.isArray(item?.media) && item.media.length > 0
        ? (item.media[0]?.url ?? (typeof item.media[0] === "string" ? item.media[0] : null))
        : null) ??
      null,
    extractThumbnailUrl: (item) =>
      item?.image ??
      (Array.isArray(item?.images) && item.images.length > 0 ? item.images[0] : null) ??
      item?.thumbnailUrl ??
      item?.thumbnail ??
      null,
    extractCreatorHandle: (item) =>
      item?.author?.name ??
      item?.author?.fullName ??
      item?.authorName ??
      null,
    extractTitle: (item) =>
      typeof item?.text === "string" ? item.text.slice(0, 120) :
      typeof item?.postText === "string" ? item.postText.slice(0, 120) : null,
    extractAdCopy: (item) => {
      const copy = item?.text ?? item?.postText ?? "";
      return typeof copy === "string" && copy.length > 10 ? copy : null;
    },
  },
};
