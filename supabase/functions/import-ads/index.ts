import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PROFILE_URL_PATTERNS = [
  /\/profile/i, /\/avatar/i, /\/logo/i, /page_picture/i,
  /p\d{2,3}x\d{2,3}/i, /s\d{2,3}x\d{2,3}/i,
  /\/rsrc\.php/i, /emoji/i, /icon/i, /badge/i,
  /\/static\//i, /favicon/i, /sprite/i,
];

function isProfileOrLogoUrl(url: string): boolean {
  return PROFILE_URL_PATTERNS.some(p => p.test(url));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m3u8|avi)(\?|$)/i.test(url) ||
    url.includes("/video/") ||
    /video.*\.xx\.fbcdn\.net/i.test(url);
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
  type: "image" | "video" | "carousel_frame" | "video_thumbnail";
  mime_type: string;
  file_size_bytes: number;
  position: number;
  download_failed?: boolean;
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

// Default tag colors
const TAG_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];

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

    // Support both flat format (legacy) and structured format (with organization)
    const organization = body.organization || null;
    const ads: any[] = body.ads || [];
    const legacyBoardNames: string[] = body.boards || [];
    const legacyTagNames: string[] = body.tags || [];

    if (!Array.isArray(ads) || ads.length === 0) return json({ success: false, error: "No ads provided" }, 400);

    // ---- Phase 1: Create folders ----
    let foldersCreated = 0;
    const folderMap: Record<string, string> = {}; // source_id/name -> our folder ID

    if (organization?.folders) {
      const { data: existingFolders } = await supabase.from("ad_library_folders").select("id, name");
      const existingFolderMap: Record<string, string> = {};
      for (const f of existingFolders || []) existingFolderMap[f.name.toLowerCase()] = f.id;

      for (const folder of organization.folders) {
        const key = folder.name.toLowerCase();
        if (existingFolderMap[key]) {
          folderMap[folder.source_id || key] = existingFolderMap[key];
          folderMap[key] = existingFolderMap[key];
        } else {
          const { data: newFolder } = await supabase
            .from("ad_library_folders")
            .insert({ name: folder.name, user_id: user.id } as any)
            .select("id")
            .single();
          if (newFolder) {
            folderMap[folder.source_id || key] = newFolder.id;
            folderMap[key] = newFolder.id;
            foldersCreated++;
          }
        }
      }
    }

    // ---- Phase 2: Create boards ----
    let boardsCreated = 0;
    const boardMap: Record<string, string> = {}; // source_id/name -> our board ID

    const { data: existingBoards } = await supabase.from("ad_library_boards").select("id, name, folder_id");
    for (const b of existingBoards || []) {
      boardMap[b.name.toLowerCase()] = b.id;
    }

    // Boards inside folders (sub-boards)
    if (organization?.folders) {
      for (const folder of organization.folders) {
        const folderId = folderMap[folder.source_id || folder.name.toLowerCase()];
        const boards = folder.boards || [];
        for (const board of boards) {
          const key = board.name.toLowerCase();
          if (!boardMap[key]) {
            const { data: newBoard } = await supabase
              .from("ad_library_boards")
              .insert({ name: board.name, user_id: user.id, folder_id: folderId || null } as any)
              .select("id")
              .single();
            if (newBoard) {
              boardMap[key] = newBoard.id;
              if (board.source_id) boardMap[board.source_id] = newBoard.id;
              boardsCreated++;
            }
          } else if (board.source_id) {
            boardMap[board.source_id] = boardMap[key];
          }
        }
      }
    }

    // Standalone boards
    if (organization?.standalone_boards) {
      for (const board of organization.standalone_boards) {
        const key = board.name.toLowerCase();
        if (!boardMap[key]) {
          const { data: newBoard } = await supabase
            .from("ad_library_boards")
            .insert({ name: board.name, user_id: user.id } as any)
            .select("id")
            .single();
          if (newBoard) {
            boardMap[key] = newBoard.id;
            if (board.source_id) boardMap[board.source_id] = newBoard.id;
            boardsCreated++;
          }
        } else if (board.source_id) {
          boardMap[board.source_id] = boardMap[key];
        }
      }
    }

    // Legacy flat board names (from older payload format or CSV)
    const allBoardNames = new Set<string>([...legacyBoardNames, ...ads.flatMap((a: any) => a.boards || [])]);
    for (const name of allBoardNames) {
      if (!name) continue;
      const key = typeof name === "string" ? name.toLowerCase() : String(name);
      // Try to resolve by source_id first, then by name
      if (!boardMap[key]) {
        const { data: newBoard } = await supabase
          .from("ad_library_boards")
          .insert({ name: typeof name === "string" ? name : String(name), user_id: user.id } as any)
          .select("id")
          .single();
        if (newBoard) {
          boardMap[key] = newBoard.id;
          boardsCreated++;
        }
      }
    }

    // ---- Phase 3: Create tags ----
    let tagsCreated = 0;
    const tagMap: Record<string, string> = {}; // name (lowercase) -> our tag ID

    const { data: existingTags } = await supabase.from("ad_library_tags").select("id, name");
    for (const t of existingTags || []) tagMap[t.name.toLowerCase()] = t.id;

    // Organization tags
    if (organization?.tags) {
      let colorIdx = 0;
      for (const tag of organization.tags) {
        const key = tag.name.toLowerCase();
        if (!tagMap[key]) {
          const color = tag.color || TAG_COLORS[colorIdx % TAG_COLORS.length];
          colorIdx++;
          const { data: newTag } = await supabase
            .from("ad_library_tags")
            .insert({ name: tag.name, user_id: user.id, color } as any)
            .select("id")
            .single();
          if (newTag) {
            tagMap[key] = newTag.id;
            tagsCreated++;
          }
        }
      }
    }

    // Legacy flat tag names + tags from ads
    const allTagNames = new Set<string>([
      ...legacyTagNames,
      ...ads.flatMap((a: any) => {
        if (typeof a.tags === "string") return a.tags.split(",").map((s: string) => s.trim());
        return a.tags || [];
      }),
    ]);
    let colorIdx2 = tagsCreated;
    for (const name of allTagNames) {
      if (!name) continue;
      const key = name.toLowerCase();
      if (!tagMap[key]) {
        const color = TAG_COLORS[colorIdx2 % TAG_COLORS.length];
        colorIdx2++;
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

    // ---- Phase 4: Import ads with assignments ----
    const { data: existingAds } = await supabase.from("ad_library_saved_ads").select("source_url");
    const existingUrls = new Set((existingAds || []).map((a: any) => a.source_url));

    let adsImported = 0, adsSkippedDuplicate = 0, adsFailed = 0;
    let boardAssignments = 0, tagAssignments = 0;
    const errors: string[] = [];
    const importedAds: Array<{ id: string; source_url: string; ad_format?: string }> = [];
    const BATCH = 10;

    for (let i = 0; i < ads.length; i += BATCH) {
      const batch = ads.slice(i, i + BATCH);

      for (const ad of batch) {
        try {
          const sourceUrl = ad.source_url || ad.url || ad.link || "";
          if (!sourceUrl) { adsFailed++; errors.push(`Ad missing source_url at index ${i}`); continue; }
          if (existingUrls.has(sourceUrl)) { adsSkippedDuplicate++; continue; }

          const rawMediaUrls = uniqueStrings([
            ...(Array.isArray(ad.media_urls) ? ad.media_urls : []),
            ...(Array.isArray(ad.mediaUrls) ? ad.mediaUrls : []),
            ...(Array.isArray(ad.assets) ? ad.assets : []),
            ad.media_url, ad.video_url, ad.videoUrl, ad.image_url, ad.imageUrl, ad.thumbnail_url, ad.thumbnailUrl,
            ad.creative_url, ad.asset_url,
          ]);

          const mediaUrls = rawMediaUrls.filter(u => !isProfileOrLogoUrl(u));
          const videoUrls = mediaUrls.filter(u => isVideoUrl(u));
          const imageUrls = mediaUrls.filter(u => !isVideoUrl(u));

          const tempAdId = crypto.randomUUID().slice(0, 8);
          const isCarousel = imageUrls.length > 1;
          const storedMedia: StoredMediaItem[] = [];
          let pos = 0;

          for (const vUrl of videoUrls) {
            const stored = await downloadAndStore(supabaseAdmin, vUrl, user.id, tempAdId, pos, "video");
            if (stored) storedMedia.push(stored);
            pos++;
          }
          for (const iUrl of imageUrls) {
            const mType = isCarousel ? "carousel_frame" : "image";
            const stored = await downloadAndStore(supabaseAdmin, iUrl, user.id, tempAdId, pos, mType as any);
            if (stored) storedMedia.push(stored);
            pos++;
          }

          const firstStoredImage = storedMedia.find(m => !m.download_failed && (m.type === "image" || m.type === "carousel_frame"));
          const thumbUrl = [ad.thumbnail_url, ad.image_url, ad.thumbnail, ad.thumbnailUrl]
            .find(u => u && !isProfileOrLogoUrl(u)) || null;
          const finalThumbnail = firstStoredImage?.stored_url || thumbUrl;

          let inferredFormat = ad.ad_format || ad.format || ad.type || null;
          if (videoUrls.length > 0 && inferredFormat !== "carousel") inferredFormat = "video";
          else if (isCarousel) inferredFormat = "carousel";
          else if (!inferredFormat && imageUrls.length > 0) inferredFormat = "image";

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
              ad_format: inferredFormat,
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

          if (insertErr || !saved) { adsFailed++; errors.push(`Insert failed: ${insertErr?.message || "unknown"}`); continue; }
          existingUrls.add(sourceUrl);

          // Board associations — resolve by source_id first, then by name
          const adBoards: string[] = ad.boards || (ad.board_name ? [ad.board_name] : []);
          for (const bRef of adBoards) {
            const boardId = boardMap[bRef] || boardMap[bRef.toLowerCase?.()] || boardMap[String(bRef).toLowerCase()];
            if (boardId) {
              const { error: baErr } = await supabase
                .from("ad_library_board_ads")
                .insert({ board_id: boardId, ad_id: saved.id } as any)
                .select()
                .maybeSingle();
              if (!baErr) boardAssignments++;
            }
          }

          // Tag associations
          let adTags: string[] = [];
          if (typeof ad.tags === "string") adTags = ad.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
          else if (Array.isArray(ad.tags)) adTags = ad.tags;
          for (const tName of adTags) {
            const tagId = tagMap[tName.toLowerCase()];
            if (tagId) {
              const { error: taErr } = await supabase
                .from("ad_library_ad_tags")
                .insert({ ad_id: saved.id, tag_id: tagId } as any)
                .select()
                .maybeSingle();
              if (!taErr) tagAssignments++;
            }
          }

          importedAds.push({ id: saved.id, source_url: sourceUrl, ad_format: inferredFormat || undefined });
          adsImported++;
        } catch (e) { adsFailed++; errors.push((e as Error).message); }
      }
    }

    return json({
      success: true,
      imported: adsImported,
      skipped_duplicates: adsSkippedDuplicate,
      failed: adsFailed,
      total: ads.length,
      results: {
        folders_created: foldersCreated,
        boards_created: boardsCreated,
        tags_created: tagsCreated,
        ads_imported: adsImported,
        ads_skipped_duplicate: adsSkippedDuplicate,
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
