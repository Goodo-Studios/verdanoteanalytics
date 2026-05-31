import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";


const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const FETCH_TIMEOUT = 12000;

const PROFILE_URL_PATTERNS = [
  /\/profile/i, /\/avatar/i, /\/logo/i, /page_picture/i,
  /p\d{2,3}x\d{2,3}/i, /s\d{2,3}x\d{2,3}/i,
  /\/rsrc\.php/i, /emoji/i, /icon/i, /badge/i, /\/static\//i,
];

function isProfileOrLogoUrl(url: string): boolean {
  return PROFILE_URL_PATTERNS.some(p => p.test(url));
}

interface StoredMediaItem {
  original_url: string;
  stored_url: string;
  type: "image" | "video" | "carousel_frame" | "video_thumbnail";
  mime_type: string;
  file_size_bytes: number;
  width?: number;
  height?: number;
  position: number;
  download_failed?: boolean;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m3u8|avi)(\?|$)/i.test(url) ||
    url.includes("/video/") ||
    /video.*\.xx\.fbcdn\.net/i.test(url);
}

function getExtensionFromUrl(url: string, contentType?: string): string {
  if (contentType?.includes("video/mp4")) return "mp4";
  if (contentType?.includes("video/webm")) return "webm";
  if (contentType?.includes("video/quicktime")) return "mov";
  if (contentType?.includes("image/png")) return "png";
  if (contentType?.includes("image/webp")) return "webp";
  if (contentType?.includes("image/gif")) return "gif";
  if (contentType?.includes("image/jpeg") || contentType?.includes("image/jpg")) return "jpg";
  const match = url.match(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)(\?|$)/i);
  if (match) return match[1].toLowerCase();
  return isVideoUrl(url) ? "mp4" : "jpg";
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw e;
  }
}

async function downloadAndStore(
  supabaseAdmin: any, url: string, userId: string, adId: string, position: number, mediaType: "image" | "video" | "carousel_frame" | "video_thumbnail"
): Promise<StoredMediaItem | null> {
  try {
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
    const timeoutMs = mediaType === "video" ? 60000 : 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": CHROME_UA } });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: 0, position, download_failed: true };
    }

    const contentLength = parseInt(resp.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_FILE_SIZE) {
      return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: contentLength, position, download_failed: true };
    }

    const contentType = resp.headers.get("content-type") || "";
    // Guard: never store a non-media payload (e.g. a text/html ad page) as a media file.
    const mediaKind = mediaType === "video" ? "video" : "image";
    if (!isMediaContentType(contentType, mediaKind)) {
      console.log(`Refusing to store ${mediaType} for ${adId}: non-media content (${contentType})`);
      return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: 0, position, download_failed: true };
    }
    const ext = getExtensionFromUrl(url, contentType);
    const mimeType = getMimeType(ext);
    const blob = await resp.blob();

    if (blob.size > MAX_FILE_SIZE) {
      return { original_url: url, stored_url: "", type: mediaType, mime_type: mimeType, file_size_bytes: blob.size, position, download_failed: true };
    }

    const arrayBuf = await blob.arrayBuffer();
    const filePath = `${userId}/${adId}/${position}_${mediaType}.${ext}`;

    const { error } = await supabaseAdmin.storage.from("ad-media").upload(filePath, new Uint8Array(arrayBuf), { contentType: mimeType, upsert: true });
    if (error) {
      return { original_url: url, stored_url: "", type: mediaType, mime_type: mimeType, file_size_bytes: blob.size, position, download_failed: true };
    }

    const { data: urlData } = supabaseAdmin.storage.from("ad-media").getPublicUrl(filePath);
    return { original_url: url, stored_url: urlData?.publicUrl || "", type: mediaType, mime_type: mimeType, file_size_bytes: blob.size, position };
  } catch (e) {
    console.error("downloadAndStore failed:", (e as Error).message);
    return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: 0, position, download_failed: true };
  }
}

// ---- URL parsing helpers ----

function extractFacebookAdId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.match(/^(www\.|m\.)?facebook\.com$/)) return null;
    if (!parsed.pathname.includes("/ads/library")) return null;
    return parsed.searchParams.get("id") || null;
  } catch {
    return null;
  }
}

function extractPageIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("view_all_page_id") || null;
  } catch {
    return null;
  }
}

function detectPlatform(url: string): string {
  if (url.includes("facebook.com") || url.includes("fb.com")) return "facebook";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("tiktok.com")) return "tiktok";
  return "other";
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function decodeUnicodeEscapes(str: string): string {
  return str.replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

// ---- JSON response helper ----

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ---- Main handler ----

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const { url } = await req.json();
    if (!url) {
      return json({ success: false, partial: true, data: { source_url: "", platform: "facebook" }, message: "No URL provided." });
    }

    // Extract ad ID from URL
    const adId = extractFacebookAdId(url);
    const pageId = extractPageIdFromUrl(url);
    const platform = detectPlatform(url);

    if (!adId && !pageId && !url.includes("facebook.com/ads/library")) {
      return json({
        success: true,
        partial: true,
        data: { source_url: url, platform, ad_format: "image" },
        message: "Could not extract ad ID from URL. You can fill in the details manually below.",
      });
    }

    // Try fetching data
    let result: ScrapeResult | null = null;
    const country = (() => { try { return new URL(url).searchParams.get("country") || "US"; } catch { return "US"; } })();

    // Method 1: Meta search endpoint
    if (pageId || adId) {
      try {
        result = await tryMetaSearchEndpoint(pageId || "", adId, country);
      } catch (e) {
        console.error("Meta search endpoint failed:", e);
      }
    }

    // Method 2: Direct page fetch (HTML scraping)
    if (!result) {
      try {
        result = await tryDirectPageFetch(url);
      } catch (e) {
        console.error("Direct page fetch failed:", e);
      }
    }

    // Method 3: Extract minimal data from HTML
    if (!result && adId) {
      try {
        const html = await fetchAdPageHtml(adId);
        if (html) {
          result = extractAdDataFromHtml(html, adId);
        }
      } catch (e) {
        console.error("HTML extraction failed:", e);
      }
    }

    // If we got NOTHING, return partial data so the user can fill in manually
    if (!result) {
      return json({
        success: true,
        partial: true,
        data: {
          source_url: url,
          ad_id: adId || null,
          platform,
          ad_format: "image",
        },
        message: "Could not auto-fetch ad details from Facebook. The source URL has been saved — you can fill in the details manually.",
      });
    }

    // Download and store media
    const allMediaUrls = result.media_urls.filter(u => u && !isProfileOrLogoUrl(u));
    const videoUrls = allMediaUrls.filter(u => isVideoUrl(u));
    const imageUrls = allMediaUrls.filter(u => !isVideoUrl(u));

    const storedMedia: StoredMediaItem[] = [];
    const tempAdId = crypto.randomUUID().slice(0, 8);
    let pos = 0;

    // Download videos
    for (const videoUrl of videoUrls) {
      const stored = await downloadAndStore(supabaseAdmin, videoUrl, user.id, tempAdId, pos, "video");
      if (stored) storedMedia.push(stored);
      pos++;
    }

    // Download images / carousel frames
    const isCarousel = result.ad_format === "carousel" || imageUrls.length > 1;
    for (const imgUrl of imageUrls) {
      const mediaType = isCarousel ? "carousel_frame" : "image";
      const stored = await downloadAndStore(supabaseAdmin, imgUrl, user.id, tempAdId, pos, mediaType as any);
      if (stored) storedMedia.push(stored);
      pos++;
    }

    // Download thumbnail separately if needed
    if (result.thumbnail_url && !isProfileOrLogoUrl(result.thumbnail_url) && !allMediaUrls.includes(result.thumbnail_url)) {
      const thumbStored = await downloadAndStore(supabaseAdmin, result.thumbnail_url, user.id, tempAdId, pos, "video_thumbnail");
      if (thumbStored) storedMedia.push(thumbStored);
    }

    // Determine thumbnail
    const firstStoredImage = storedMedia.find(m => !m.download_failed && (m.type === "image" || m.type === "carousel_frame" || m.type === "video_thumbnail"));
    const finalThumbnail = firstStoredImage?.stored_url || (result.thumbnail_url && !isProfileOrLogoUrl(result.thumbnail_url) ? result.thumbnail_url : null);

    // Correct ad_format
    let adFormat = result.ad_format;
    if (videoUrls.length > 0 && adFormat !== "carousel") adFormat = "video";

    const isPartial = !result.advertiser_name;

    return json({
      success: true,
      partial: isPartial,
      data: {
        ...result,
        ad_format: adFormat,
        thumbnail_url: finalThumbnail,
        stored_media: storedMedia,
        media_urls: allMediaUrls,
      },
      message: isPartial
        ? "Some details could not be fetched automatically. Please fill in the rest below."
        : "Ad data extracted successfully.",
    });
  } catch (e) {
    // NEVER let this crash — always return a graceful response
    console.error("scrape-ad error:", e);
    return json({
      success: false,
      partial: true,
      data: { source_url: "", platform: "facebook" },
      message: "Something went wrong while fetching the ad. You can still save it by filling in the details below.",
    });
  }
});

// ---- Scrape helpers ----

interface ScrapeResult {
  advertiser_name: string | null;
  advertiser_page_id: string | null;
  ad_id: string | null;
  platform: string;
  ad_status: string | null;
  ad_format: string | null;
  headline: string | null;
  body_text: string | null;
  cta_text: string | null;
  landing_page_url: string | null;
  media_urls: string[];
  thumbnail_url: string | null;
  started_running: string | null;
  country_targeting: string[];
  raw_data: Record<string, unknown>;
}

async function fetchAdPageHtml(adId: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(`https://www.facebook.com/ads/library/?id=${adId}`, {
      headers: {
        "User-Agent": CHROME_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function extractAdDataFromHtml(html: string, adId: string): ScrapeResult | null {
  const result: Partial<ScrapeResult> = {
    ad_id: adId,
    platform: "facebook",
    ad_format: "image",
    media_urls: [],
    country_targeting: [],
    raw_data: {},
  };

  // og tags
  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/);
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
  const ogVideo = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/);

  if (ogTitle) result.headline = decodeHtmlEntities(ogTitle[1]);
  if (ogDesc) result.body_text = decodeHtmlEntities(ogDesc[1]);
  if (ogImage) result.thumbnail_url = ogImage[1];
  if (ogVideo) {
    result.media_urls = [ogVideo[1]];
    result.ad_format = "video";
  }

  // Title → advertiser name
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  if (titleMatch) {
    const parts = titleMatch[1].split(/\s*[-–|]\s*/);
    result.advertiser_name = parts.find(p =>
      p !== "Ad Library" && p !== "Facebook" && p !== "Meta" && p.length > 2
    ) || null;
  }

  // Video URLs from HTML
  const videoPatterns = [
    /video_hd_url["\s:]+["']([^"']+\.mp4[^"']*)/,
    /video_sd_url["\s:]+["']([^"']+\.mp4[^"']*)/,
    /video_url["\s:]+["']([^"']+\.mp4[^"']*)/,
    /(https?:\/\/video[^"'\s]+\.mp4[^"'\s]*)/,
    /(https?:\/\/scontent[^"'\s]+\.mp4[^"'\s]*)/,
  ];
  for (const pattern of videoPatterns) {
    const match = html.match(pattern);
    if (match) {
      const vUrl = decodeUnicodeEscapes(match[1]);
      result.media_urls = result.media_urls || [];
      if (!result.media_urls.includes(vUrl)) result.media_urls.push(vUrl);
      result.ad_format = "video";
      break;
    }
  }

  // Image URLs
  if (!result.thumbnail_url) {
    const imagePatterns = [
      /(https?:\/\/scontent[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*)/g,
      /(https?:\/\/external[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*)/g,
    ];
    for (const pattern of imagePatterns) {
      const matches = html.matchAll(pattern);
      for (const m of matches) {
        const u = decodeUnicodeEscapes(m[1]);
        if (!u.includes("emoji") && !u.includes("rsrc") && !u.includes("static") && !isProfileOrLogoUrl(u)) {
          result.thumbnail_url = u;
          break;
        }
      }
      if (result.thumbnail_url) break;
    }
  }

  // Started running date
  const dateMatch = html.match(/Started running on\s+(\w+ \d+,?\s*\d{4})/);
  if (dateMatch) result.started_running = dateMatch[1];

  // CTA
  const ctaPatterns = ["Shop Now", "Learn More", "Sign Up", "Download", "Book Now",
    "Contact Us", "Get Offer", "Get Quote", "Subscribe", "Watch More",
    "Apply Now", "Order Now", "See Menu", "Get Directions", "Send Message"];
  for (const cta of ctaPatterns) {
    if (html.includes(cta)) { result.cta_text = cta; break; }
  }

  // Also try structured data from existing extractFromHtml logic
  const structuredResult = extractStructuredFromHtml(html);
  if (structuredResult) {
    // Merge — prefer structured data
    return {
      ...result as ScrapeResult,
      ...structuredResult,
      media_urls: [...new Set([...(result.media_urls || []), ...(structuredResult.media_urls || [])])],
      advertiser_name: structuredResult.advertiser_name || result.advertiser_name || null,
    };
  }

  // Return what we have if anything useful
  if (result.advertiser_name || result.thumbnail_url || (result.media_urls && result.media_urls.length > 0)) {
    return result as ScrapeResult;
  }
  return null;
}

async function tryMetaSearchEndpoint(pageId: string, adId: string | null, country: string): Promise<ScrapeResult | null> {
  try {
    const collationToken = crypto.randomUUID();
    const params = new URLSearchParams({
      forward_cursor: "", collation_token: collationToken,
      search_type: "page", media_type: "all", country, q: "", page_id: pageId || "",
    });

    const resp = await fetchWithTimeout("https://www.facebook.com/ads/library/async/search_ads/", {
      method: "POST",
      headers: {
        "User-Agent": CHROME_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9",
        "X-FB-Friendly-Name": "SearchAdsLibraryAsyncNonAuthQuery",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!resp.ok) return null;
    let text = await resp.text();
    if (text.startsWith("for (;;);")) text = text.slice(9);

    const data = JSON.parse(text);
    const results = data?.payload?.results || [];
    if (results.length === 0) return null;

    let ad = results[0];
    if (adId) {
      const match = results.find((r: any) => r.adArchiveID === adId || r.ad_archive_id === adId || String(r.adid) === adId);
      if (match) ad = match;
    }
    return normalizeMetaResult(ad, pageId, country);
  } catch (e) {
    console.error("Meta search endpoint error:", e);
    return null;
  }
}

/** Deep-search an object for video URLs */
function extractVideoUrlsDeep(obj: any, depth = 0): string[] {
  if (depth > 8 || !obj) return [];
  const urls: string[] = [];

  if (typeof obj === "string") {
    if (isVideoUrl(obj) && obj.startsWith("http")) urls.push(obj);
    return urls;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) urls.push(...extractVideoUrlsDeep(item, depth + 1));
    return urls;
  }

  if (typeof obj === "object") {
    const videoFields = ["video_hd_url", "video_sd_url", "video_url", "video_source", "src", "source"];
    for (const field of videoFields) {
      if (typeof obj[field] === "string" && obj[field].startsWith("http")) {
        if (isVideoUrl(obj[field]) || field.startsWith("video")) urls.push(obj[field]);
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "page_profile_picture_url" || key === "page_profile_uri") continue;
      urls.push(...extractVideoUrlsDeep(obj[key], depth + 1));
    }
  }
  return urls;
}

function normalizeMetaResult(ad: any, pageId: string, country: string): ScrapeResult {
  const snapshot = ad.snapshot || ad;
  const cards = snapshot.cards || snapshot.creative_cards || [];
  const firstCard = cards[0] || {};

  const mediaUrls: string[] = [];
  let thumbnailUrl: string | null = null;
  let adFormat = "image";

  const deepVideoUrls = [...new Set(extractVideoUrlsDeep(ad))].filter(u => !isProfileOrLogoUrl(u));

  if (snapshot.videos && snapshot.videos.length > 0) {
    snapshot.videos.forEach((v: any) => {
      const url = v.video_hd_url || v.video_sd_url || v.video_url;
      if (url && !deepVideoUrls.includes(url)) deepVideoUrls.unshift(url);
      const poster = v.video_preview_image_url || v.poster || v.thumbnail_src;
      if (poster && !isProfileOrLogoUrl(poster) && !thumbnailUrl) thumbnailUrl = poster;
    });
  }

  if (deepVideoUrls.length > 0) {
    adFormat = "video";
    deepVideoUrls.forEach(u => { if (!mediaUrls.includes(u)) mediaUrls.push(u); });
  }

  if (snapshot.images || snapshot.resized_images) {
    const imgs = snapshot.images || snapshot.resized_images || [];
    imgs.forEach((img: any) => {
      const url = img.original_image_url || img.resized_image_url || img.url;
      if (url && !isProfileOrLogoUrl(url) && !mediaUrls.includes(url)) {
        mediaUrls.push(url);
        if (!thumbnailUrl) thumbnailUrl = url;
      }
    });
  }

  if (cards.length > 1) {
    adFormat = "carousel";
    cards.forEach((card: any) => {
      const cardImg = card.original_image_url || card.resized_image_url || card.image_url || card.url;
      if (cardImg && !isProfileOrLogoUrl(cardImg) && !mediaUrls.includes(cardImg)) mediaUrls.push(cardImg);
      const cardVid = card.video_hd_url || card.video_sd_url || card.video_url;
      if (cardVid && !mediaUrls.includes(cardVid)) mediaUrls.push(cardVid);
    });
  }

  if (adFormat === "video" && !thumbnailUrl) {
    const posterFields = ["video_preview_image_url", "video_poster", "thumbnail_src", "poster"];
    for (const field of posterFields) {
      const val = snapshot[field] || ad[field];
      if (val && typeof val === "string" && !isProfileOrLogoUrl(val)) { thumbnailUrl = val; break; }
    }
  }

  let startedRunning: string | null = null;
  const startDate = ad.startDate || ad.start_date || snapshot.creation_time;
  if (startDate) {
    try {
      const d = typeof startDate === "number" ? new Date(startDate * 1000) : new Date(startDate);
      startedRunning = d.toISOString().split("T")[0];
    } catch { /* ignore */ }
  }

  return {
    advertiser_name: ad.pageName || ad.page_name || snapshot.page_name || null,
    advertiser_page_id: pageId,
    ad_id: ad.adArchiveID || ad.ad_archive_id || String(ad.adid || ""),
    platform: "facebook",
    ad_status: ad.isActive || ad.is_active ? "active" : "inactive",
    ad_format: adFormat,
    headline: firstCard.title || snapshot.title || null,
    body_text: snapshot.body?.markup?.__html || snapshot.body?.text || snapshot.body || firstCard.body || null,
    cta_text: firstCard.cta_text || snapshot.cta_text || snapshot.link_title || null,
    landing_page_url: firstCard.link_url || snapshot.link_url || snapshot.page_welcome_message || null,
    media_urls: mediaUrls.filter(u => !isProfileOrLogoUrl(u)),
    thumbnail_url: thumbnailUrl && !isProfileOrLogoUrl(thumbnailUrl) ? thumbnailUrl : null,
    started_running: startedRunning,
    country_targeting: [country],
    raw_data: ad,
  };
}

async function tryDirectPageFetch(url: string): Promise<ScrapeResult | null> {
  try {
    const resp = await fetchWithTimeout(url, {
      headers: { "User-Agent": CHROME_UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!resp.ok) return null;

    const html = await resp.text();
    const adData = extractStructuredFromHtml(html);
    if (adData) return adData;

    const titleMatch = html.match(/<title[^>]*>([^<]+)</);
    const advertiserName = titleMatch ? titleMatch[1].replace("Ad Library", "").replace("|", "").replace("Facebook", "").trim() : null;

    if (advertiserName) {
      return {
        advertiser_name: advertiserName, advertiser_page_id: null, ad_id: null, platform: "facebook",
        ad_status: null, ad_format: null, headline: null, body_text: null, cta_text: null,
        landing_page_url: null, media_urls: [], thumbnail_url: null, started_running: null,
        country_targeting: [], raw_data: {},
      };
    }
    return null;
  } catch (e) {
    console.error("Direct page fetch error:", e);
    return null;
  }
}

function extractStructuredFromHtml(html: string): ScrapeResult | null {
  // Extract video URLs from HTML
  const videoMatches: string[] = [];
  const videoTagRegex = /<(?:video|source)[^>]*src=["']([^"']+\.(?:mp4|webm|mov)[^"']*)/gi;
  let vMatch;
  while ((vMatch = videoTagRegex.exec(html)) !== null) {
    if (!isProfileOrLogoUrl(vMatch[1])) videoMatches.push(vMatch[1]);
  }
  const fbVideoRegex = /https?:\/\/video[^"'\s]*\.xx\.fbcdn\.net\/[^"'\s]+/g;
  let fbMatch;
  while ((fbMatch = fbVideoRegex.exec(html)) !== null) {
    if (!videoMatches.includes(fbMatch[0])) videoMatches.push(fbMatch[0]);
  }
  const scontentMp4 = /https?:\/\/scontent[^"'\s]*\.xx\.fbcdn\.net\/[^"'\s]*\.mp4[^"'\s]*/g;
  let scMatch;
  while ((scMatch = scontentMp4.exec(html)) !== null) {
    if (!videoMatches.includes(scMatch[0])) videoMatches.push(scMatch[0]);
  }

  const patterns = [/"adcard":\s*(\{[^}]+\})/i, /"snapshot":\s*(\{[\s\S]*?\})\s*[,}]/i, /adArchiveID['"]\s*:\s*['"]([\d]+)['"]/i];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        if (data.body || data.page_name || data.title) {
          const hasVideo = videoMatches.length > 0 || data.video_hd_url || data.video_sd_url;
          return {
            advertiser_name: data.page_name || null, advertiser_page_id: data.page_id || null,
            ad_id: data.adArchiveID || data.ad_archive_id || null, platform: "facebook",
            ad_status: null, ad_format: hasVideo ? "video" : (data.ad_format || null),
            headline: data.title || null,
            body_text: typeof data.body === "string" ? data.body : data.body?.text || null,
            cta_text: data.cta_text || null, landing_page_url: data.link_url || null,
            media_urls: videoMatches, thumbnail_url: null, started_running: null,
            country_targeting: [], raw_data: data,
          };
        }
      } catch { /* ignore */ }
    }
  }

  if (videoMatches.length > 0) {
    return {
      advertiser_name: null, advertiser_page_id: null, ad_id: null, platform: "facebook",
      ad_status: null, ad_format: "video", headline: null, body_text: null, cta_text: null,
      landing_page_url: null, media_urls: videoMatches, thumbnail_url: null,
      started_running: null, country_targeting: [], raw_data: {},
    };
  }

  return null;
}
