import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const { url } = await req.json();
    if (!url || !url.includes("facebook.com/ads/library")) {
      return json({
        success: false,
        error: "Invalid URL — must be a Facebook Ads Library link",
      }, 400);
    }

    // Parse IDs from URL
    const parsedUrl = new URL(url);
    const pageId =
      parsedUrl.searchParams.get("view_all_page_id") ||
      parsedUrl.searchParams.get("id") ||
      extractPageIdFromPath(url);
    const adId = parsedUrl.searchParams.get("ad_id") || null;
    const country = parsedUrl.searchParams.get("country") || "US";

    console.log("Scraping ad:", { pageId, adId, country });

    // Try primary method: Meta internal search endpoint
    let result = null;
    if (pageId) {
      result = await tryMetaSearchEndpoint(pageId, adId, country);
    }

    // Fallback: direct page fetch + HTML parsing
    if (!result) {
      result = await tryDirectPageFetch(url);
    }

    if (!result) {
      return json({
        success: false,
        error:
          "Could not fetch ad data. Please use the Manual Entry tab instead.",
      });
    }

    // Try to download and cache thumbnail
    let thumbnailUrl = result.thumbnail_url;
    if (thumbnailUrl && supabaseUrl) {
      try {
        const cached = await cacheThumbnail(
          supabase,
          thumbnailUrl,
          claimsData.claims.sub as string
        );
        if (cached) thumbnailUrl = cached;
      } catch (e) {
        console.error("Thumbnail cache failed:", e);
      }
    }

    return json({
      success: true,
      data: {
        ...result,
        thumbnail_url: thumbnailUrl,
      },
    });
  } catch (e) {
    console.error("scrape-ad error:", e);
    return json({
      success: false,
      error:
        "Facebook blocked this request. You can screenshot the ad and enter it manually — takes just a few seconds.",
    });
  }
});

// ---- Helpers ----

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractPageIdFromPath(url: string): string | null {
  const match = url.match(/view_all_page_id[=](\d+)/);
  return match ? match[1] : null;
}

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

async function tryMetaSearchEndpoint(
  pageId: string,
  adId: string | null,
  country: string
): Promise<ScrapeResult | null> {
  try {
    const collationToken = crypto.randomUUID();
    const params = new URLSearchParams({
      forward_cursor: "",
      collation_token: collationToken,
      search_type: "page",
      media_type: "all",
      country,
      q: "",
      page_id: pageId,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(
      "https://www.facebook.com/ads/library/async/search_ads/",
      {
        method: "POST",
        headers: {
          "User-Agent": CHROME_UA,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "X-FB-Friendly-Name": "SearchAdsLibraryAsyncNonAuthQuery",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!resp.ok) {
      console.log("Meta search endpoint returned:", resp.status);
      return null;
    }

    let text = await resp.text();
    // Strip for(;;); prefix
    if (text.startsWith("for (;;);")) {
      text = text.slice(9);
    }

    const data = JSON.parse(text);
    const results = data?.payload?.results || [];

    if (results.length === 0) {
      console.log("No results from Meta search");
      return null;
    }

    // Find matching ad or use first
    let ad = results[0];
    if (adId) {
      const match = results.find(
        (r: any) =>
          r.adArchiveID === adId ||
          r.ad_archive_id === adId ||
          String(r.adid) === adId
      );
      if (match) ad = match;
    }

    return normalizeMetaResult(ad, pageId, country);
  } catch (e) {
    console.error("Meta search endpoint error:", e);
    return null;
  }
}

function normalizeMetaResult(
  ad: any,
  pageId: string,
  country: string
): ScrapeResult {
  const snapshot = ad.snapshot || ad;
  const cards = snapshot.cards || snapshot.creative_cards || [];
  const firstCard = cards[0] || {};

  // Extract media
  const mediaUrls: string[] = [];
  let thumbnailUrl: string | null = null;
  let adFormat = "image";

  if (snapshot.images || snapshot.resized_images) {
    const imgs = snapshot.images || snapshot.resized_images || [];
    imgs.forEach((img: any) => {
      const url = img.original_image_url || img.resized_image_url || img.url;
      if (url) mediaUrls.push(url);
    });
    thumbnailUrl = mediaUrls[0] || null;
  }

  if (snapshot.videos && snapshot.videos.length > 0) {
    adFormat = "video";
    snapshot.videos.forEach((v: any) => {
      const url = v.video_hd_url || v.video_sd_url || v.video_url;
      if (url) mediaUrls.push(url);
    });
    thumbnailUrl =
      snapshot.videos[0]?.video_preview_image_url || thumbnailUrl;
  }

  if (cards.length > 1) adFormat = "carousel";

  // Date
  let startedRunning: string | null = null;
  const startDate =
    ad.startDate || ad.start_date || snapshot.creation_time;
  if (startDate) {
    try {
      const d = typeof startDate === "number"
        ? new Date(startDate * 1000)
        : new Date(startDate);
      startedRunning = d.toISOString().split("T")[0];
    } catch {}
  }

  return {
    advertiser_name:
      ad.pageName ||
      ad.page_name ||
      snapshot.page_name ||
      null,
    advertiser_page_id: pageId,
    ad_id:
      ad.adArchiveID ||
      ad.ad_archive_id ||
      String(ad.adid || ""),
    platform: "facebook",
    ad_status:
      ad.isActive || ad.is_active ? "active" : "inactive",
    ad_format: adFormat,
    headline:
      firstCard.title || snapshot.title || null,
    body_text:
      snapshot.body?.markup?.__html ||
      snapshot.body?.text ||
      snapshot.body ||
      firstCard.body ||
      null,
    cta_text:
      firstCard.cta_text ||
      snapshot.cta_text ||
      snapshot.link_title ||
      null,
    landing_page_url:
      firstCard.link_url ||
      snapshot.link_url ||
      snapshot.page_welcome_message ||
      null,
    media_urls: mediaUrls,
    thumbnail_url: thumbnailUrl,
    started_running: startedRunning,
    country_targeting: [country],
    raw_data: ad,
  };
}

async function tryDirectPageFetch(
  url: string
): Promise<ScrapeResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      headers: {
        "User-Agent": CHROME_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const html = await resp.text();

    // Try to extract data from embedded JSON
    const adData = extractFromHtml(html);
    if (adData) return adData;

    // Try to extract advertiser name at minimum
    const titleMatch = html.match(
      /<title[^>]*>([^<]+)</
    );
    const advertiserName = titleMatch
      ? titleMatch[1]
          .replace("Ad Library", "")
          .replace("|", "")
          .replace("Facebook", "")
          .trim()
      : null;

    if (advertiserName) {
      return {
        advertiser_name: advertiserName,
        advertiser_page_id: null,
        ad_id: null,
        platform: "facebook",
        ad_status: null,
        ad_format: null,
        headline: null,
        body_text: null,
        cta_text: null,
        landing_page_url: null,
        media_urls: [],
        thumbnail_url: null,
        started_running: null,
        country_targeting: [],
        raw_data: {},
      };
    }

    return null;
  } catch (e) {
    console.error("Direct page fetch error:", e);
    return null;
  }
}

function extractFromHtml(html: string): ScrapeResult | null {
  // Look for JSON blobs with ad data
  const patterns = [
    /"adcard":\s*(\{[^}]+\})/i,
    /"snapshot":\s*(\{[\s\S]*?\})\s*[,}]/i,
    /adArchiveID['"]\s*:\s*['"]([\d]+)['"]/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        if (data.body || data.page_name || data.title) {
          return {
            advertiser_name: data.page_name || null,
            advertiser_page_id: data.page_id || null,
            ad_id: data.adArchiveID || data.ad_archive_id || null,
            platform: "facebook",
            ad_status: null,
            ad_format: data.ad_format || null,
            headline: data.title || null,
            body_text:
              typeof data.body === "string"
                ? data.body
                : data.body?.text || null,
            cta_text: data.cta_text || null,
            landing_page_url: data.link_url || null,
            media_urls: [],
            thumbnail_url: null,
            started_running: null,
            country_targeting: [],
            raw_data: data,
          };
        }
      } catch {}
    }
  }

  return null;
}

async function cacheThumbnail(
  supabase: any,
  imageUrl: string,
  userId: string
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(imageUrl, {
      headers: { "User-Agent": CHROME_UA },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const blob = await resp.arrayBuffer();
    const path = `${userId}/${Date.now()}-scraped.${ext}`;

    const { error } = await supabase.storage
      .from("ad-media")
      .upload(path, new Uint8Array(blob), {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error("Storage upload error:", error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("ad-media")
      .getPublicUrl(path);

    return urlData?.publicUrl || null;
  } catch (e) {
    console.error("cacheThumbnail error:", e);
    return null;
  }
}
