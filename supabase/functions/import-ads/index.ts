import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m3u8|avi)(\?|$)/i.test(url) || url.includes("/video/");
}

function getExtensionFromUrl(url: string, contentType?: string): string {
  if (contentType?.includes("video/mp4")) return "mp4";
  if (contentType?.includes("video/webm")) return "webm";
  if (contentType?.includes("image/png")) return "png";
  if (contentType?.includes("image/webp")) return "webp";
  if (contentType?.includes("image/gif")) return "gif";
  if (contentType?.includes("image/jpeg")) return "jpg";
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

interface StoredMediaItem {
  original_url: string;
  stored_url: string;
  type: "image" | "video" | "carousel_frame";
  mime_type: string;
  file_size_bytes: number;
  position: number;
  download_failed?: boolean;
}

async function downloadAndStore(
  supabaseAdmin: any, url: string, userId: string, adId: string, position: number, mediaType: "image" | "video" | "carousel_frame"
): Promise<StoredMediaItem | null> {
  try {
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": CHROME_UA } });
    clearTimeout(timeout);

    if (!resp.ok) return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: 0, position, download_failed: true };

    const contentType = resp.headers.get("content-type") || "";
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
      console.error("Storage upload error:", error.message);
      return { original_url: url, stored_url: "", type: mediaType, mime_type: mimeType, file_size_bytes: blob.size, position, download_failed: true };
    }

    const { data: urlData } = supabaseAdmin.storage.from("ad-media").getPublicUrl(filePath);
    return { original_url: url, stored_url: urlData?.publicUrl || "", type: mediaType, mime_type: mimeType, file_size_bytes: blob.size, position };
  } catch (e) {
    console.error("downloadAndStore failed:", (e as Error).message);
    return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: 0, position, download_failed: true };
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

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

    const body = await req.json();
    const { ads = [], boards: boardNames = [], tags: tagNames = [] } = body;

    if (!Array.isArray(ads) || ads.length === 0) return json({ success: false, error: "No ads provided" }, 400);

    // 1. Resolve boards
    const { data: existingBoards } = await supabase.from("ad_library_boards").select("id, name");
    const boardMap: Record<string, string> = {};
    for (const b of existingBoards || []) boardMap[b.name.toLowerCase()] = b.id;

    const allBoardNames = new Set<string>([...boardNames, ...ads.flatMap((a: any) => a.boards || [])]);
    for (const name of allBoardNames) {
      if (!name) continue;
      const key = name.toLowerCase();
      if (!boardMap[key]) {
        const { data: newBoard } = await supabase.from("ad_library_boards").insert({ name, user_id: user.id }).select("id").single();
        if (newBoard) boardMap[key] = newBoard.id;
      }
    }

    // 2. Resolve tags
    const { data: existingTags } = await supabase.from("ad_library_tags").select("id, name");
    const tagMap: Record<string, string> = {};
    for (const t of existingTags || []) tagMap[t.name.toLowerCase()] = t.id;

    const allTagNames = new Set<string>([
      ...tagNames,
      ...ads.flatMap((a: any) => {
        if (typeof a.tags === "string") return a.tags.split(",").map((s: string) => s.trim());
        return a.tags || [];
      }),
    ]);
    for (const name of allTagNames) {
      if (!name) continue;
      const key = name.toLowerCase();
      if (!tagMap[key]) {
        const { data: newTag } = await supabase.from("ad_library_tags").insert({ name, user_id: user.id }).select("id").single();
        if (newTag) tagMap[key] = newTag.id;
      }
    }

    // 3. Dedup
    const { data: existingAds } = await supabase.from("ad_library_saved_ads").select("source_url");
    const existingUrls = new Set((existingAds || []).map((a: any) => a.source_url));

    // 4. Process ads
    let imported = 0, skippedDuplicates = 0, failed = 0;
    const errors: string[] = [];
    const BATCH = 10;

    for (let i = 0; i < ads.length; i += BATCH) {
      const batch = ads.slice(i, i + BATCH);

      for (const ad of batch) {
        try {
          const sourceUrl = ad.source_url || ad.url || ad.link || "";
          if (!sourceUrl) { failed++; errors.push(`Ad missing source_url at index ${i}`); continue; }
          if (existingUrls.has(sourceUrl)) { skippedDuplicates++; continue; }

          const mediaUrls = uniqueStrings([
            ...(Array.isArray(ad.media_urls) ? ad.media_urls : []),
            ...(Array.isArray(ad.mediaUrls) ? ad.mediaUrls : []),
            ...(Array.isArray(ad.assets) ? ad.assets : []),
            ad.media_url, ad.video_url, ad.videoUrl, ad.image_url, ad.imageUrl, ad.thumbnail_url, ad.thumbnailUrl,
          ]);

          const tempAdId = crypto.randomUUID().slice(0, 8);
          const isCarousel = mediaUrls.filter(u => !isVideoUrl(u)).length > 1;
          const storedMedia: StoredMediaItem[] = [];

          // Download and store all media
          for (let mi = 0; mi < mediaUrls.length; mi++) {
            const mUrl = mediaUrls[mi];
            let mType: "image" | "video" | "carousel_frame" = "image";
            if (isVideoUrl(mUrl)) mType = "video";
            else if (isCarousel) mType = "carousel_frame";

            const stored = await downloadAndStore(supabaseAdmin, mUrl, user.id, tempAdId, mi, mType);
            if (stored) storedMedia.push(stored);
          }

          const firstStoredImage = storedMedia.find(m => !m.download_failed && (m.type === "image" || m.type === "carousel_frame"));
          const inferredThumb = mediaUrls.find(url => !isVideoUrl(url)) || null;
          const thumbUrl = ad.thumbnail_url || ad.image_url || ad.thumbnail || ad.thumbnailUrl || inferredThumb;
          const finalThumbnail = firstStoredImage?.stored_url || thumbUrl;

          const inferredFormat = mediaUrls.some(isVideoUrl) ? "video" : isCarousel ? "carousel" : thumbUrl ? "image" : null;

          const { data: saved, error: insertErr } = await supabase
            .from("ad_library_saved_ads")
            .insert({
              user_id: user.id,
              source_url: sourceUrl,
              advertiser_name: ad.advertiser_name || ad.brand_name || ad.advertiser || null,
              advertiser_page_id: ad.advertiser_page_id || ad.page_id || null,
              ad_id: ad.ad_id || ad.facebook_ad_id || null,
              platform: ad.platform || "facebook",
              ad_status: ad.ad_status || ad.status || null,
              ad_format: ad.ad_format || ad.format || ad.type || inferredFormat,
              headline: ad.headline || ad.title || null,
              body_text: ad.body_text || ad.body || ad.text || ad.copy || null,
              cta_text: ad.cta_text || ad.cta || null,
              landing_page_url: ad.landing_page_url || ad.landing_page || ad.destination_url || null,
              media_urls: mediaUrls,
              thumbnail_url: finalThumbnail,
              started_running: ad.started_running || ad.start_date || null,
              country_targeting: ad.country_targeting || [],
              notes: ad.notes || null,
              raw_data: ad.raw_data || ad || null,
              stored_media: storedMedia,
            } as any)
            .select("id")
            .single();

          if (insertErr || !saved) { failed++; errors.push(`Insert failed: ${insertErr?.message || "unknown"}`); continue; }
          existingUrls.add(sourceUrl);

          // Board associations
          const adBoards: string[] = ad.boards || (ad.board_name ? [ad.board_name] : []);
          for (const bName of adBoards) {
            const boardId = boardMap[bName.toLowerCase()];
            if (boardId) await supabase.from("ad_library_board_ads").insert({ board_id: boardId, ad_id: saved.id } as any).select().maybeSingle();
          }

          // Tag associations
          let adTags: string[] = [];
          if (typeof ad.tags === "string") adTags = ad.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
          else if (Array.isArray(ad.tags)) adTags = ad.tags;
          for (const tName of adTags) {
            const tagId = tagMap[tName.toLowerCase()];
            if (tagId) await supabase.from("ad_library_ad_tags").insert({ ad_id: saved.id, tag_id: tagId } as any).select().maybeSingle();
          }

          imported++;
        } catch (e) { failed++; errors.push((e as Error).message); }
      }
    }

    return json({
      success: true, imported, skipped_duplicates: skippedDuplicates, failed, total: ads.length,
      boards_created: Object.keys(boardMap).length, tags_created: Object.keys(tagMap).length,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    console.error("import-ads error:", e);
    return json({ success: false, error: "Internal error" }, 500);
  }
});
