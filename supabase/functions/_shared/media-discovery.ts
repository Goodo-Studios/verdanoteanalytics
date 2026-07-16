/**
 * Shared media discovery module for Meta Graph API.
 * Unified v22.0 API — used by refresh-thumbnails, enrich-thumbnails, fetch-thumbnail.
 */

const META_API_VERSION = "v22.0";

export const NO_THUMB_SENTINEL = "no-thumbnail";
export const NO_VIDEO_SENTINEL = "no-video";

/**
 * Resolve the Meta Graph API access token from the two configured sources, in
 * the same precedence sync / backfill-play-curves use: the `META_ACCESS_TOKEN`
 * env secret first, then the `settings.meta_access_token` DB row. Empty/blank
 * strings are treated as ABSENT (the real-world trap is a secret set to "") so a
 * present-but-empty env var correctly falls through to the DB token. Returns the
 * chosen token, or null when neither source has a usable value.
 *
 * Why this exists: cache-creative-image originally read ONLY the env secret —
 * which is not set on this project — and passed `undefined` to the Graph API, so
 * every discovery call returned 400 and the row was poisoned with a no-thumbnail
 * / no-video sentinel. Callers must use this helper AND refuse to write sentinels
 * when it returns null, so a missing token can never be mistaken for "Meta has no
 * media for this ad."
 */
export function resolveMetaToken(
  envToken: string | null | undefined,
  dbToken: string | null | undefined,
): string | null {
  const env = (envToken ?? "").trim();
  if (env) return env;
  const db = (dbToken ?? "").trim();
  if (db) return db;
  return null;
}

/**
 * Detect whether a byte buffer is actually an HTML/text page rather than real
 * media. Meta CDN and ad-page URLs frequently 200 with a `text/html` (or even a
 * generic `application/octet-stream`/`text/plain`) login/error page — which then
 * gets stored as `<adId>.jpg`/`.mp4` and renders as a blank thumbnail / unplayable
 * video. content-type alone can't catch this (the octet-stream allowance in
 * isMediaContentType is a hole), so we sniff the leading bytes for an HTML marker.
 * Real JPEG/PNG/WEBP/MP4 never begin with these. Pure + dependency-free.
 */
export function looksLikeHtml(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.byteLength === 0) return false;
  // Inspect the first ~512 bytes as Latin-1 (decode is cheap, no allocation blowup).
  const head = bytes.subarray(0, 512);
  let s = "";
  for (let i = 0; i < head.byteLength; i++) s += String.fromCharCode(head[i]);
  // Strip a leading UTF-8 BOM (U+FEFF) and any whitespace before matching.
  const trimmed = s.replace(/^[\uFEFF\s]+/, "").toLowerCase();
  return (
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<!--")
  );
}

/**
 * Pick the best creative IMAGE src from Ad Preview API HTML.
 * Only *.fbcdn.net image assets qualify — never a facebook.com page URL (those
 * return text/html and were getting cached as <adId>.jpg garbage), never a video
 * stream (.mp4). fbcdn.net is the only host Meta serves creative images from.
 * Returns the last match (usually the main creative, not the profile pic) or null.
 * Pure + dependency-free so it can be unit-tested without network.
 */
export function extractPreviewImageSrc(previewBody: string): string | null {
  if (!previewBody) return null;
  const matches = [...previewBody.matchAll(/src="([^"]+)"/g)]
    .map((m) => m[1].replace(/&amp;/g, "&"))
    .filter((url) => url.includes("fbcdn.net") && !url.includes(".mp4"));
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

// A still-image URL is never a video source, whatever its path shape. Matches an
// image extension at the end of the path (before any ?query or #fragment).
const PREVIEW_IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)(\?|#|$)/i;
// Meta serves playable video from its dedicated video CDN host only —
// video.<region>.fbcdn.net or video-<...>.fbcdn.net. scontent/external hosts
// are image hosts. Used as the positive video signal alongside a .mp4 asset.
const PREVIEW_VIDEO_HOST = /:\/\/video[.-][^/]*\.fbcdn\.net/i;

/**
 * Pick a VIDEO src from Ad Preview API HTML.
 * Require *.fbcdn.net (Meta's only media host) so a facebook.com page URL can never
 * be returned as a video src; exclude any still-image URL; then require a POSITIVE
 * video signal — an actual .mp4 asset OR Meta's dedicated video CDN host. Returns
 * first match or null. Pure + dependency-free so it can be unit-tested without network.
 *
 * Regression (image ads saving as videos): the old filter accepted any fbcdn URL
 * containing "/v/", excluding only "_n.jpg"/"_n.png" stills. But "/v/" is a path
 * segment in fbcdn IMAGE URLs too (e.g. scontent.xx.fbcdn.net/v/t45.../still.jpg),
 * and high-res creative images don't all carry the "_n" suffix (_o.jpg, stp=dst-jpg,
 * extension-less transforms). Those slipped through as a "video", poisoning an
 * image-only ad's video_url via cache-creative-image → the ad was then treated as a
 * video everywhere downstream. The bare "/v/" is no longer a video signal.
 */
export function extractPreviewVideoSrc(previewBody: string): string | null {
  if (!previewBody) return null;
  const matches = [...previewBody.matchAll(/src="([^"]+)"/g)]
    .map((m) => m[1].replace(/&amp;/g, "&"))
    .filter(
      (url) =>
        url.includes("fbcdn.net") &&
        !PREVIEW_IMAGE_EXT.test(url) &&
        (url.includes(".mp4") || PREVIEW_VIDEO_HOST.test(url))
    );
  return matches.length > 0 ? matches[0] : null;
}

/**
 * US-009: Compute the SHA-256 content hash (hex) of downloaded media bytes.
 *
 * This is the within-account dedupe key (media_assets.asset_key): identical
 * creatives reused across many ads hash to the same value, so the second ad
 * reuses the already-stored copy instead of downloading and storing the bytes
 * again. Format-agnostic (works for image and video) and stable across Meta CDN
 * URL re-issues for the same underlying asset. Pure + dependency-free (Web Crypto
 * only) so it can be unit-tested without network or storage.
 */
export async function computeContentHash(
  bytes: Uint8Array | ArrayBuffer,
): Promise<string> {
  // Normalize to a fresh ArrayBuffer-backed view so the digest input is a plain
  // BufferSource (a SharedArrayBuffer-backed Uint8Array would fail the type).
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buf = new Uint8Array(src.byteLength);
  buf.set(src);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * US-009: Build the per-account, asset-keyed storage object path for a deduped
 * media asset: `<accountId>/assets/<assetKey>.<ext>`.
 *
 * Embedding accountId FIRST preserves the tenant boundary — the same creative
 * (same assetKey) appearing in two accounts resolves to two DISTINCT paths, so
 * there is never a cross-account shared file. Keying by assetKey (not adId) is
 * what makes the copy shared WITHIN the account: every ad reusing the creative
 * maps to the identical path. Pure + dependency-free.
 */
export function assetStoragePath(
  accountId: string,
  assetKey: string,
  ext: string,
): string {
  const cleanExt = ext.replace(/^\.+/, "");
  return `${accountId}/assets/${assetKey}.${cleanExt}`;
}

/**
 * US-011: canonical "is this already a permanent Supabase Storage URL?" check.
 *
 * A media column holding a storage URL means the asset is ALREADY cached — the
 * media pipeline must short-circuit on it BEFORE any re-discovery or re-download.
 * This is the guard behind the workstream's core guarantee: "cached media is never
 * re-touched." Both the queue drain worker (drain-media-queue) and the manual
 * repair/force paths (enrich-thumbnails) route their skip-gate through this single
 * predicate so the check can never drift between the two. Pure + dependency-free so
 * the short-circuit contract is unit-testable without a live storage object.
 */
export function isStorageUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes("/storage/v1/object/public/");
}

/**
 * US-001 (meta-media-completeness): the single, documented ELIGIBILITY predicate
 * for media-coverage measurement — the TS mirror of the WHERE clause in the
 * public.media_coverage SQL view. An ad is eligible when it is in the universe we
 * actually sync today: it is NOT archived and has at least one impression. Keeping
 * one predicate on both sides means the coverage numerator/denominator always
 * measure against the intended universe and no silently-excluded ad is ever counted
 * as "covered".
 *
 * US-006 will widen this (per-account include_archived / include_zero_impression
 * flags); when it lands, update BOTH this helper AND the view's eligibility CTE
 * together so they never drift. Pure + dependency-free so it is unit-testable.
 */
export function isEligibleForCoverage(creative: {
  ad_status?: string | null;
  impressions?: number | null;
}): boolean {
  const status = (creative.ad_status ?? "UNKNOWN").toUpperCase();
  if (status === "ARCHIVED") return false;
  return (creative.impressions ?? 0) > 0;
}

/**
 * US-001: classify whether a creative has a cached, full-resolution static IMAGE
 * (image_ok). The ~130px creative.thumbnail_url last-resort fallback (discoverImageUrl
 * Strategy 6) returns fullResUrl:null, and drain-media-queue only populates
 * full_res_url when a REAL asset is cached — so an image whose only source is that
 * tiny-thumbnail fallback has a NULL full_res_url and is explicitly NOT image_ok.
 * A non-null full_res_url that is not the no-thumbnail sentinel means a real cached
 * full-res image. Pure mirror of the view's image_ok expression.
 */
export function isImageOk(creative: {
  full_res_url?: string | null;
}): boolean {
  const full = creative.full_res_url;
  return typeof full === "string" && full.length > 0 && full !== NO_THUMB_SENTINEL;
}

/**
 * US-001: is this ad a VIDEO ad at all? video_url is NULL for image-only ads; a
 * populated value (a real url OR the no-video sentinel) means Meta reports it as a
 * video ad. Used to make video_ok trivially true for non-video ads.
 */
export function isVideoAd(creative: { video_url?: string | null }): boolean {
  return creative.video_url != null && creative.video_url !== "";
}

/**
 * US-001: classify video_ok. A non-video ad is trivially ok. A video ad is ok only
 * when its video_url is a cached Supabase Storage url (playable); the no-video
 * sentinel (unresolved) and any bare live CDN url (never cached) are NOT ok. Pure
 * mirror of the view's video_ok expression.
 */
export function isVideoOk(creative: { video_url?: string | null }): boolean {
  const v = creative.video_url;
  if (v == null || v === "") return true; // not a video ad → trivially ok
  if (v === NO_VIDEO_SENTINEL) return false; // unresolved video
  return isStorageUrl(v); // cached storage url = playable
}

/**
 * US-001: fully classify a creative's media coverage. frames_ok defaults to the
 * passed value (TRUE until US-004's creative_frames junction lands and can declare
 * an expected frame set). covered = image_ok AND video_ok AND frames_ok. This is the
 * TS mirror of one public.media_coverage row so callers outside SQL (e.g. the media
 * worker deciding whether an ad still needs work) share the exact same definition.
 */
export function classifyCoverage(
  creative: {
    ad_status?: string | null;
    impressions?: number | null;
    full_res_url?: string | null;
    video_url?: string | null;
  },
  framesOk = true,
): {
  eligible: boolean;
  image_ok: boolean;
  video_ok: boolean;
  frames_ok: boolean;
  covered: boolean;
} {
  const image_ok = isImageOk(creative);
  const video_ok = isVideoOk(creative);
  const frames_ok = framesOk;
  return {
    eligible: isEligibleForCoverage(creative),
    image_ok,
    video_ok,
    frames_ok,
    covered: image_ok && video_ok && frames_ok,
  };
}

/** Fetch with a timeout — aborts if the request takes longer than timeoutMs */
export async function fetchWithTimeout(url: string, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * US-002: quality classification of a discovered image source.
 *   'full_res' — a real, full-resolution creative asset (adimages high-res,
 *                asset_feed_spec image, effective_object_story_id full_picture,
 *                a >=480px video thumbnail, or the Preview API render).
 *   'low_res'  — a placeholder only: the ~130px creative.thumbnail_url last-resort
 *                fallback (Strategy 6) or a sub-480px video thumbnail. These are
 *                the rows the US-002 re-discovery job re-attempts.
 * Mirrors the migration's creatives.image_quality domain.
 */
export type ImageQuality = "full_res" | "low_res";

/**
 * Discover a high-res image URL from Meta Graph API.
 * Returns { thumbnailUrl, fullResUrl, imageQuality } where fullResUrl is the
 * highest-resolution source available (stored separately so the modal can use it
 * without rescaling) and imageQuality flags whether the result is a real full-res
 * asset ('full_res') or only a low-res placeholder ('low_res' — the ~130px
 * thumbnail_url fallback or a sub-480px video thumbnail). The full-res sources are
 * PREFERRED and only the ~130px thumbnail_url is recorded as a last resort, flagged
 * low_res (US-002 AC#1). imageQuality tracks with fullResUrl: a 'full_res' result
 * always carries a non-null fullResUrl; a 'low_res' result carries fullResUrl:null.
 */
export async function discoverImageUrl(
  adId: string,
  accountId: string,
  accessToken: string,
  timeoutMs = 30_000
): Promise<{ thumbnailUrl: string; fullResUrl: string | null; imageQuality: ImageQuality } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=creative{thumbnail_url,image_url,image_hash,object_story_spec,asset_feed_spec}&access_token=${accessToken}`,
      timeoutMs
    );
    if (!res.ok) {
      console.log(`Meta API failed for ${adId}: ${res.status}`);
      await res.text();
      return null;
    }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) return null;

    // Strategy 1: Resolve image_hash → full-res URL
    const imageHash =
      creative.image_hash ||
      creative.object_story_spec?.link_data?.image_hash ||
      creative.object_story_spec?.photo_data?.image_hash;

    if (imageHash) {
      const imgRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${accountId}/adimages?hashes=["${imageHash}"]&fields=url,url_128,width,height,original_width,original_height,permalink_url&access_token=${accessToken}`,
        timeoutMs
      );
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const images = imgData?.data;
        if (images && images.length > 0) {
          const img = images[0];
          const fullUrl = img.url;
          const w = img.original_width || img.width || 0;
          console.log(`image_hash for ${adId}: ${w}px wide, url length: ${fullUrl?.length}`);
          if (fullUrl && fullUrl.length > 100) {
            return { thumbnailUrl: fullUrl, fullResUrl: fullUrl, imageQuality: "full_res" };
          }
        }
      } else {
        await imgRes.text();
      }
    }

    // Strategy 1b: Advantage+ / Dynamic Creative — asset_feed_spec images
    const feedImages: any[] = creative.asset_feed_spec?.images || [];
    for (const feedImg of feedImages) {
      const feedHash = feedImg?.hash || feedImg?.image_hash;
      if (feedHash) {
        const imgRes = await fetchWithTimeout(
          `https://graph.facebook.com/${META_API_VERSION}/${accountId}/adimages?hashes=["${feedHash}"]&fields=url,original_width,original_height&access_token=${accessToken}`,
          timeoutMs
        );
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          const images = imgData?.data;
          if (images && images.length > 0) {
            const fullUrl = images[0].url;
            if (fullUrl && fullUrl.length > 100) {
              console.log(`asset_feed_spec image_hash for ${adId}: ${images[0].original_width}px`);
              return { thumbnailUrl: fullUrl, fullResUrl: fullUrl, imageQuality: "full_res" };
            }
          }
        } else {
          await imgRes.text();
        }
      }
      // Some feed images have a direct url field
      if (feedImg?.url) {
        console.log(`asset_feed_spec direct URL for ${adId}`);
        return { thumbnailUrl: feedImg.url, fullResUrl: feedImg.url, imageQuality: "full_res" };
      }
    }

    // Strategy 2: Video thumbnail
    const spec = creative.object_story_spec;
    const videoId = spec?.video_data?.video_id || spec?.template_data?.video_data?.video_id;

    if (videoId) {
      // Hold the best available video thumb as a last-resort fallback. We PREFER a >=480px
      // thumb or the 1080 picture endpoint, but a smaller thumb still beats returning nothing
      // (which would leave the card permanently broken) or the ~130px Strategy-6 placeholder.
      let smallVideoThumb: string | null = null;

      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${videoId}?fields=thumbnails{uri,width,height}&access_token=${accessToken}`,
        timeoutMs
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        const thumbs = vidData?.thumbnails?.data;
        if (thumbs && thumbs.length > 0) {
          const sorted = thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
          const best = sorted[0];
          if (best?.uri && (best.width || 0) >= 480) {
            console.log(`Video thumbnail for ${adId}: ${best.width}x${best.height}`);
            return { thumbnailUrl: best.uri, fullResUrl: null, imageQuality: "low_res" };
          } else if (best?.uri) {
            console.log(`Video thumbnail below 480px for ${adId}: ${best?.width}x${best?.height} — keeping as fallback`);
            smallVideoThumb = best.uri;
          }
        }
      } else {
        await vidRes.text();
      }

      const picRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${videoId}/picture?redirect=false&width=1080&height=1080&access_token=${accessToken}`,
        timeoutMs
      );
      if (picRes.ok) {
        const picData = await picRes.json();
        if (picData?.data?.url) {
          console.log(`Video picture fallback (1080px) for ${adId}`);
          return { thumbnailUrl: picData.data.url, fullResUrl: picData.data.url, imageQuality: "full_res" };
        }
      } else {
        await picRes.text();
      }

      // 1080 picture endpoint failed — use the smaller thumb rather than dropping it.
      if (smallVideoThumb) {
        console.log(`Using sub-480px video thumbnail fallback for ${adId}`);
        return { thumbnailUrl: smallVideoThumb, fullResUrl: null, imageQuality: "low_res" };
      }
    }

    // Strategy 2b: Advantage+ feed spec videos — get poster from first video
    const feedVideos: any[] = creative.asset_feed_spec?.videos || [];
    for (const v of feedVideos) {
      if (v?.video_id) {
        const picRes = await fetchWithTimeout(
          `https://graph.facebook.com/${META_API_VERSION}/${v.video_id}/picture?redirect=false&width=1080&height=1080&access_token=${accessToken}`,
          timeoutMs
        );
        if (picRes.ok) {
          const picData = await picRes.json();
          if (picData?.data?.url) {
            console.log(`asset_feed_spec video poster for ${adId} (video ${v.video_id})`);
            return { thumbnailUrl: picData.data.url, fullResUrl: picData.data.url, imageQuality: "full_res" };
          }
        } else {
          await picRes.text();
        }
        break; // only try first video
      }
    }

    // Strategy 3: effective_object_story_id → full_picture (high-res)
    if (creative.id) {
      const creativeRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${creative.id}?fields=effective_object_story_id,image_url&access_token=${accessToken}`,
        timeoutMs
      );
      if (creativeRes.ok) {
        const creativeData = await creativeRes.json();

        // Try image_url from creative endpoint first — this is often full resolution
        if (creativeData.image_url) {
          console.log(`Creative image_url for ${adId}`);
          return { thumbnailUrl: creativeData.image_url, fullResUrl: creativeData.image_url, imageQuality: "full_res" };
        }

        if (creativeData.effective_object_story_id) {
          const postRes = await fetchWithTimeout(
            `https://graph.facebook.com/${META_API_VERSION}/${creativeData.effective_object_story_id}?fields=full_picture&access_token=${accessToken}`,
            timeoutMs
          );
          if (postRes.ok) {
            const postData = await postRes.json();
            if (postData.full_picture) {
              console.log(`Post full_picture for ${adId}`);
              return { thumbnailUrl: postData.full_picture, fullResUrl: postData.full_picture, imageQuality: "full_res" };
            }
          } else {
            await postRes.text();
          }
        }
      } else {
        await creativeRes.text();
      }
    }

    // Strategy 4: Direct fallback fields — image_url is usually full-res
    if (creative.image_url) {
      console.log(`Using image_url for ${adId}`);
      return { thumbnailUrl: creative.image_url, fullResUrl: creative.image_url, imageQuality: "full_res" };
    }

    if (spec) {
      const imageUrl = spec.link_data?.image_url || spec.photo_data?.url || spec.photo_data?.image_url;
      if (imageUrl) return { thumbnailUrl: imageUrl, fullResUrl: imageUrl, imageQuality: "full_res" };
    }

    // Strategy 5: Ad Preview API — extract rendered image from preview HTML
    // Works for whitelisted ads where we can't access the source page
    try {
      const previewRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${adId}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${accessToken}`,
        timeoutMs
      );
      if (previewRes.ok) {
        const previewData = await previewRes.json();
        const previewBody = previewData?.data?.[0]?.body;
        if (previewBody) {
          const bestImg = extractPreviewImageSrc(previewBody);
          if (bestImg) {
            console.log(`Ad Preview API image for ${adId}`);
            return { thumbnailUrl: bestImg, fullResUrl: bestImg, imageQuality: "full_res" };
          }
        }
      } else {
        await previewRes.text();
      }
    } catch (e) {
      console.log(`Preview API fallback error for ${adId}:`, e);
    }

    // Strategy 6: creative.thumbnail_url is last resort (~130px placeholder from Meta)
    if (creative.thumbnail_url) {
      console.log(`LOW-RES FALLBACK for ${adId}: using thumbnail_url (~130px) — all higher-res strategies failed`);
      return { thumbnailUrl: creative.thumbnail_url, fullResUrl: null, imageQuality: "low_res" };
    }

    return null;
  } catch (e) {
    console.log(`Meta API error for ${adId}:`, e);
    return null;
  }
}

/**
 * Fetch ad preview URL from Meta Graph API.
 */
export async function discoverPreviewUrl(
  adId: string,
  accessToken: string,
  timeoutMs = 30_000
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${accessToken}`,
      timeoutMs
    );
    if (res.ok) {
      const data = await res.json();
      const preview = data?.data?.[0];
      if (preview?.body) {
        const match = preview.body.match(/src="([^"]+)"/);
        if (match?.[1]) {
          return match[1].replace(/&amp;/g, "&");
        }
      }
    }
    const adRes = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=creative{effective_object_story_id}&access_token=${accessToken}`,
      timeoutMs
    );
    if (adRes.ok) {
      const adData = await adRes.json();
      const storyId = adData?.creative?.effective_object_story_id;
      if (storyId) {
        const parts = storyId.split("_");
        if (parts.length === 2) {
          return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
        }
      }
    }
    return null;
  } catch (e) {
    console.log(`Preview URL error for ${adId}:`, e);
    return null;
  }
}

/**
 * Build a map of video_id → source_url from the ad account's video library.
 *
 * Why this exists: Direct GET /{video_id}?fields=source fails with (#10) for
 * page-owned videos because the `source` field requires pages_read_engagement,
 * which a system-user token with only ads_management does not have.
 * However, GET /{accountId}/advideos?fields=id,source succeeds for the same
 * videos because the account-edge context satisfies the permission check.
 *
 * Build this map once per account before processing its creatives, then pass
 * it into discoverVideoUrl so it skips the failing direct-node call.
 */
export async function fetchAccountVideoMap(
  accountId: string,
  accessToken: string,
  maxPages = 50
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let afterCursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const cursorParam = afterCursor ? `&after=${encodeURIComponent(afterCursor)}` : "";
    const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/advideos?fields=id,source&limit=100${cursorParam}&access_token=${accessToken}`;
    try {
      const res = await fetchWithTimeout(url, 30_000);
      if (!res.ok) { await res.text(); break; }
      const data = await res.json();
      const videos: any[] = data?.data || [];
      for (const v of videos) {
        if (v?.id && v?.source) map.set(v.id, v.source);
      }
      afterCursor = data?.paging?.cursors?.after ?? null;
      if (!afterCursor || !data?.paging?.next) break;
    } catch {
      break;
    }
  }

  console.log(`Account video map: ${map.size} videos for ${accountId}`);
  return map;
}

/**
 * Discover a video source URL from Meta Graph API.
 * Covers all known creative formats (standard, carousel, DPA, Advantage+, whitelisted).
 *
 * Pass an accountVideoMap (from fetchAccountVideoMap) to enable reliable lookup
 * for page-owned videos where direct /{video_id}?fields=source is permission-blocked.
 */
export async function discoverVideoUrl(
  adId: string,
  accessToken: string,
  timeoutMs = 30_000,
  accountVideoMap?: Map<string, string>
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=creative{id,video_id,object_story_spec,effective_object_story_id,asset_feed_spec}&access_token=${accessToken}`,
      timeoutMs
    );
    if (!res.ok) {
      console.log(`Meta video API failed for ${adId}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) {
      const errCode = data?.error?.code;
      const errMsg = data?.error?.message;
      if (errCode || errMsg) {
        console.log(`Meta video: no creative for ${adId} — error ${errCode}: ${errMsg}`);
      }
      return null;
    }

    const spec = creative.object_story_spec;
    const videoIds: string[] = [];

    // Path 1: top-level video_id
    if (creative.video_id) videoIds.push(creative.video_id);

    // Path 2: standard video_data
    if (spec?.video_data?.video_id) videoIds.push(spec.video_data.video_id);
    if (spec?.video_data?.video_url) return spec.video_data.video_url;

    // Path 3: template / DPA video
    if (spec?.template_data?.video_data?.video_id) {
      videoIds.push(spec.template_data.video_data.video_id);
    }

    // Path 4: carousel child attachments
    const children: any[] = spec?.link_data?.child_attachments || [];
    for (const child of children) {
      if (child?.video_id) videoIds.push(child.video_id);
    }

    // Path 5: asset_feed_spec (Advantage+/dynamic creative)
    const feedVideos: any[] = creative.asset_feed_spec?.videos || [];
    for (const v of feedVideos) {
      if (v?.video_id) videoIds.push(v.video_id);
    }

    // Try fetching source from all collected video_ids.
    // Map lookup first (avoids #10 permission errors on page-owned videos);
    // direct API call as fallback (works for ad-account-owned videos).
    for (const vid of [...new Set(videoIds)]) {
      if (accountVideoMap) {
        const mapped = accountVideoMap.get(vid);
        if (mapped) {
          console.log(`Got video source from account library map for ${adId} (video ${vid})`);
          return mapped;
        }
      }
      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${vid}?fields=source&access_token=${accessToken}`,
        timeoutMs
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        if (vidData?.source) {
          console.log(`Got video source from video_id ${vid} for ${adId}`);
          return vidData.source;
        }
      }
    }

    // Path 6: effective_object_story_id → post video
    const storyId = creative.effective_object_story_id;
    if (storyId) {
      // 6a: Try post-level source field first (video posts often expose this directly)
      const postSourceRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${storyId}?fields=source,attachments{media,media_type,subattachments{media,media_type}}&access_token=${accessToken}`,
        timeoutMs
      );
      if (postSourceRes.ok) {
        const postData = await postSourceRes.json();

        // Direct source on the post object (common for native video posts)
        if (postData?.source && postData.source.includes("video")) {
          console.log(`Got video source directly from post for ${adId}`);
          return postData.source;
        }

        const attachments: any[] = postData?.attachments?.data || [];
        for (const att of attachments) {
          // Some video posts expose the playable URL directly on media.source
          if (att?.media?.source) {
            console.log(`Got video from attachment media.source for ${adId}`);
            return att.media.source;
          }
          // Standard path: media.video.id → fetch source
          const videoId = att?.media?.video?.id;
          if (videoId) {
            const vidRes = await fetchWithTimeout(
              `https://graph.facebook.com/${META_API_VERSION}/${videoId}?fields=source&access_token=${accessToken}`,
              timeoutMs
            );
            if (vidRes.ok) {
              const vidData = await vidRes.json();
              if (vidData?.source) {
                console.log(`Got video via effective_object_story_id for ${adId}`);
                return vidData.source;
              }
            }
          }
          // Check subattachments (carousel / album posts)
          const subattachments: any[] = att?.subattachments?.data || [];
          for (const sub of subattachments) {
            if (sub?.media?.source) {
              console.log(`Got video from subattachment media.source for ${adId}`);
              return sub.media.source;
            }
            const subVideoId = sub?.media?.video?.id;
            if (subVideoId) {
              const vidRes = await fetchWithTimeout(
                `https://graph.facebook.com/${META_API_VERSION}/${subVideoId}?fields=source&access_token=${accessToken}`,
                timeoutMs
              );
              if (vidRes.ok) {
                const vidData = await vidRes.json();
                if (vidData?.source) {
                  console.log(`Got video via subattachment video_id for ${adId}`);
                  return vidData.source;
                }
              }
            }
          }
        }
      } else {
        await postSourceRes.text();
      }
    }

    // Path 7: adcreatives endpoint fallback
    if (creative.id) {
      const creativeRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${creative.id}?fields=video_id,asset_feed_spec&access_token=${accessToken}`,
        timeoutMs
      );
      if (creativeRes.ok) {
        const creativeData = await creativeRes.json();
        const fallbackIds: string[] = [];
        if (creativeData?.video_id) fallbackIds.push(creativeData.video_id);
        const feedVids: any[] = creativeData?.asset_feed_spec?.videos || [];
        for (const v of feedVids) {
          if (v?.video_id) fallbackIds.push(v.video_id);
        }
        for (const vid of [...new Set(fallbackIds)]) {
          if (videoIds.includes(vid)) continue;
          if (accountVideoMap) {
            const mapped = accountVideoMap.get(vid);
            if (mapped) {
              console.log(`Got video via adcreatives fallback (map) for ${adId}`);
              return mapped;
            }
          }
          const vidRes = await fetchWithTimeout(
            `https://graph.facebook.com/${META_API_VERSION}/${vid}?fields=source&access_token=${accessToken}`,
            timeoutMs
          );
          if (vidRes.ok) {
            const vidData = await vidRes.json();
            if (vidData?.source) {
              console.log(`Got video via adcreatives fallback for ${adId}`);
              return vidData.source;
            }
          }
        }
      }
    }

    // Path 8: Ad Preview API — extract video source URL from rendered preview HTML
    // Works for whitelisted ads where direct video_id source access is restricted
    try {
      const previewRes = await fetchWithTimeout(
        `https://graph.facebook.com/${META_API_VERSION}/${adId}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${accessToken}`,
        timeoutMs
      );
      if (previewRes.ok) {
        const previewData = await previewRes.json();
        const previewBody = previewData?.data?.[0]?.body;
        if (previewBody) {
          const videoSrc = extractPreviewVideoSrc(previewBody);
          if (videoSrc) {
            console.log(`Got video via Ad Preview API for ${adId}`);
            return videoSrc;
          }
        }
      } else {
        await previewRes.text();
      }
    } catch (e) {
      console.log(`Video preview API fallback error for ${adId}:`, e);
    }

    return null;
  } catch (e) {
    console.log(`Meta video API error for ${adId}:`, e);
    return null;
  }
}
