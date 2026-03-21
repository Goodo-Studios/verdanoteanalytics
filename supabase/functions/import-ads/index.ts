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

function getExtFromUrl(url: string, ct?: string): string {
  if (ct?.includes("video/mp4")) return "mp4";
  if (ct?.includes("video/webm")) return "webm";
  if (ct?.includes("image/png")) return "png";
  if (ct?.includes("image/webp")) return "webp";
  if (ct?.includes("image/jpeg")) return "jpg";
  const m = url.match(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)(\?|$)/i);
  return m ? m[1].toLowerCase() : "jpg";
}

function getMime(ext: string): string {
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
  type: "image" | "video" | "carousel_frame" | "video_thumbnail";
  mime_type: string;
  file_size_bytes: number;
  position: number;
  download_failed?: boolean;
}

async function downloadAndStore(
  admin: any, url: string, userId: string, adId: string, position: number,
  mediaType: "image" | "video" | "carousel_frame" | "video_thumbnail"
): Promise<StoredMediaItem | null> {
  try {
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
    const timeoutMs = mediaType === "video" ? 60000 : 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": CHROME_UA } });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`Download failed (${resp.status}) for ${url}`);
      return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: 0, position, download_failed: true };
    }

    const ct = resp.headers.get("content-type") || "";
    const ext = getExtFromUrl(url, ct);
    const mime = getMime(ext);
    const blob = await resp.blob();

    if (blob.size > MAX_FILE_SIZE) {
      return { original_url: url, stored_url: "", type: mediaType, mime_type: mime, file_size_bytes: blob.size, position, download_failed: true };
    }

    const buf = await blob.arrayBuffer();
    const path = `${userId}/${adId}/${position}_${mediaType}.${ext}`;
    const { error } = await admin.storage.from("ad-media").upload(path, new Uint8Array(buf), { contentType: mime, upsert: true });

    if (error) {
      console.error("Upload error:", error.message);
      return { original_url: url, stored_url: "", type: mediaType, mime_type: mime, file_size_bytes: blob.size, position, download_failed: true };
    }

    const { data: urlData } = admin.storage.from("ad-media").getPublicUrl(path);
    return { original_url: url, stored_url: urlData?.publicUrl || "", type: mediaType, mime_type: mime, file_size_bytes: blob.size, position };
  } catch (e) {
    console.error("downloadAndStore failed:", (e as Error).message);
    return { original_url: url, stored_url: "", type: mediaType, mime_type: "", file_size_bytes: 0, position, download_failed: true };
  }
}

const TAG_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json();
    const ads: any[] = body.ads || [];
    if (!Array.isArray(ads) || ads.length === 0) return json({ success: false, error: "No ads provided" }, 400);

    // ── Phase 1: Create boards from board names ──
    let boardsCreated = 0;
    const boardMap: Record<string, string> = {}; // name (lowercase) → board ID

    const { data: existingBoards } = await supabase.from("ad_library_boards").select("id, name");
    for (const b of existingBoards || []) boardMap[b.name.toLowerCase()] = b.id;

    // Collect all board names from ads
    const allBoardNames = new Set<string>();
    for (const ad of ads) {
      const boards: string[] = ad.boards || (ad.board_name ? [ad.board_name] : []);
      for (const name of boards) {
        if (name && typeof name === "string") allBoardNames.add(name);
      }
    }

    for (const name of allBoardNames) {
      const key = name.toLowerCase();
      if (!boardMap[key]) {
        const { data: newBoard } = await supabase
          .from("ad_library_boards")
          .insert({ name, user_id: user.id } as any)
          .select("id")
          .single();
        if (newBoard) {
          boardMap[key] = newBoard.id;
          boardsCreated++;
        }
      }
    }

    // ── Phase 2: Create tags ──
    let tagsCreated = 0;
    const tagMap: Record<string, string> = {};

    const { data: existingTags } = await supabase.from("ad_library_tags").select("id, name");
    for (const t of existingTags || []) tagMap[t.name.toLowerCase()] = t.id;

    const allTagNames = new Set<string>();
    for (const ad of ads) {
      const tags: string[] = Array.isArray(ad.tags) ? ad.tags : (typeof ad.tags === "string" ? ad.tags.split(",").map((s: string) => s.trim()) : []);
      for (const t of tags) { if (t) allTagNames.add(t); }
    }

    let colorIdx = 0;
    for (const name of allTagNames) {
      const key = name.toLowerCase();
      if (!tagMap[key]) {
        const color = TAG_COLORS[colorIdx % TAG_COLORS.length];
        colorIdx++;
        const { data: newTag } = await supabase
          .from("ad_library_tags")
          .insert({ name, user_id: user.id, color } as any)
          .select("id")
          .single();
        if (newTag) {
          tagMap[key] = newTag.id;
          tagsCreated++;
        }
      }
    }

    // ── Phase 3: Import ads ──
    const { data: existingAds } = await supabase.from("ad_library_saved_ads").select("source_url");
    const existingUrls = new Set((existingAds || []).map((a: any) => a.source_url));

    let adsImported = 0, adsSkipped = 0, adsFailed = 0;
    let videosDownloaded = 0, imagesDownloaded = 0, videosFailed = 0;
    let boardAssignments = 0, tagAssignments = 0;
    const errors: string[] = [];
    const importedAds: Array<{ id: string; source_url: string; ad_format?: string }> = [];

    // Process in batches of 3 (videos are large)
    const BATCH = 3;
    for (let i = 0; i < ads.length; i += BATCH) {
      const batch = ads.slice(i, i + BATCH);

      for (const ad of batch) {
        try {
          const sourceUrl = ad.source_url || "";
          if (!sourceUrl) { adsFailed++; continue; }
          if (existingUrls.has(sourceUrl)) { adsSkipped++; continue; }

          const tempAdId = crypto.randomUUID().slice(0, 8);
          const storedMedia: StoredMediaItem[] = [];
          let pos = 0;

          // Download video if URL provided
          const videoUrl = ad.video_url || null;
          if (videoUrl && typeof videoUrl === "string" && videoUrl.startsWith("http")) {
            const stored = await downloadAndStore(admin, videoUrl, user.id, tempAdId, pos, "video");
            if (stored) {
              storedMedia.push(stored);
              if (!stored.download_failed) videosDownloaded++;
              else videosFailed++;
              pos++;
            }
          }

          // Download thumbnail/image from Atria CDN
          const thumbUrl = ad.thumbnail_url || null;
          if (thumbUrl && typeof thumbUrl === "string") {
            const mediaType = videoUrl ? "video_thumbnail" as const : "image" as const;
            const stored = await downloadAndStore(admin, thumbUrl, user.id, tempAdId, pos, mediaType);
            if (stored) {
              storedMedia.push(stored);
              if (!stored.download_failed) imagesDownloaded++;
              pos++;
            }
          }

          // Determine format
          const adFormat = videoUrl ? "video" : (ad.ad_format || "image");

          // Determine thumbnail for card display
          const firstSuccessful = storedMedia.find(m => !m.download_failed);
          const finalThumb = firstSuccessful?.stored_url || thumbUrl || null;

          // Build media_urls for reference
          const mediaUrls = [videoUrl, thumbUrl].filter(Boolean) as string[];

          // Construct Facebook Ad Library source URL from ad_id
          let finalSourceUrl = sourceUrl;
          if (sourceUrl.startsWith("atria-import-") && ad.ad_id) {
            const numericId = String(ad.ad_id).replace(/^m/, "");
            if (/^\d+$/.test(numericId)) {
              finalSourceUrl = `https://www.facebook.com/ads/library/?id=${numericId}`;
            }
          }

          const { data: saved, error: insertErr } = await supabase
            .from("ad_library_saved_ads")
            .insert({
              user_id: user.id,
              source_url: finalSourceUrl,
              advertiser_name: ad.advertiser_name || null,
              advertiser_page_id: ad.meta_page_id || ad.advertiser_page_id || null,
              ad_id: ad.ad_id || null,
              platform: ad.platform || "facebook",
              ad_format: adFormat,
              headline: ad.headline || null,
              body_text: ad.body_text || null,
              cta_text: ad.cta_text || null,
              landing_page_url: ad.landing_page_url || null,
              media_urls: mediaUrls,
              thumbnail_url: finalThumb,
              stored_media: storedMedia,
              notes: ad.notes || null,
            } as any)
            .select("id")
            .single();

          if (insertErr || !saved) {
            adsFailed++;
            errors.push(insertErr?.message || "Insert failed");
            continue;
          }

          existingUrls.add(finalSourceUrl);

          // Board assignments
          const adBoards: string[] = ad.boards || (ad.board_name ? [ad.board_name] : []);
          for (const bName of adBoards) {
            const boardId = boardMap[bName.toLowerCase()];
            if (boardId) {
              await supabase.from("ad_library_board_ads").insert({ board_id: boardId, ad_id: saved.id } as any);
              boardAssignments++;
            }
          }

          // Tag assignments
          const adTags: string[] = Array.isArray(ad.tags) ? ad.tags : [];
          for (const tName of adTags) {
            const tagId = tagMap[tName.toLowerCase()];
            if (tagId) {
              await supabase.from("ad_library_ad_tags").insert({ ad_id: saved.id, tag_id: tagId } as any);
              tagAssignments++;
            }
          }

          importedAds.push({ id: saved.id, source_url: finalSourceUrl, ad_format: adFormat });
          adsImported++;
        } catch (e) {
          adsFailed++;
          errors.push((e as Error).message);
        }
      }
    }

    return json({
      success: true,
      imported: adsImported,
      skipped_duplicates: adsSkipped,
      failed: adsFailed,
      total: ads.length,
      videos_downloaded: videosDownloaded,
      images_downloaded: imagesDownloaded,
      video_download_failed: videosFailed,
      results: {
        boards_created: boardsCreated,
        tags_created: tagsCreated,
        ads_imported: adsImported,
        ads_skipped_duplicate: adsSkipped,
        board_assignments_created: boardAssignments,
        tag_assignments_created: tagAssignments,
      },
      errors: errors.slice(0, 10),
      imported_ads: importedAds,
    });
  } catch (e) {
    console.error("import-ads error:", e);
    return json({ success: false, error: "Internal error" }, 500);
  }
});
