import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  discoverImageUrl,
  discoverVideoUrl,
  fetchWithTimeout,
  NO_THUMB_SENTINEL,
  NO_VIDEO_SENTINEL,
} from "../_shared/media-discovery.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;

async function downloadAndCache(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  accountId: string,
  adId: string,
  url: string,
  type: "image" | "video"
): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, 60_000);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    if (type === "image" && buffer.byteLength < 5000) return null;
    if (type === "video" && buffer.byteLength > MAX_VIDEO_SIZE) return null;
    const contentType =
      resp.headers.get("content-type") ??
      (type === "video" ? "video/mp4" : "image/jpeg");
    const ext =
      type === "video"
        ? contentType.includes("webm") ? "webm" : "mp4"
        : contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
        ? "webp"
        : "jpg";
    const path = `${accountId}/${adId}.${ext}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, new Uint8Array(buffer), { contentType, upsert: true });
    if (error) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  } catch {
    return null;
  }
}

const isStorageUrl = (url: string | null): boolean =>
  !!url?.includes("/storage/v1/object/public/");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!req.headers.get("authorization")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let ad_id: string, account_id: string;
  try {
    const body = await req.json();
    ad_id = body.ad_id;
    account_id = body.account_id;
    if (!ad_id || !account_id) throw new Error("Missing ad_id or account_id");
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: creative, error: fetchErr } = await supabase
    .from("creatives")
    .select("ad_id, account_id, thumbnail_url, full_res_url, video_url")
    .eq("ad_id", ad_id)
    .single();

  if (fetchErr || !creative) {
    return new Response(JSON.stringify({ error: "Creative not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const updates: Record<string, string> = {};

  // ── Image ────────────────────────────────────────────────────────────────
  // Skip if already in storage, or we've confirmed no image exists for this ad.
  // Re-run discovery for null (never tried) or stale CDN URLs.
  const skipImage =
    creative.thumbnail_url === NO_THUMB_SENTINEL ||
    isStorageUrl(creative.thumbnail_url);

  if (!skipImage) {
    console.log(`[${ad_id}] Discovering image...`);
    const result = await discoverImageUrl(ad_id, account_id, META_ACCESS_TOKEN);
    if (result?.thumbnailUrl) {
      const storageUrl = await downloadAndCache(
        supabase, THUMB_BUCKET, account_id, ad_id, result.thumbnailUrl, "image"
      );
      if (storageUrl) {
        updates.thumbnail_url = storageUrl;
        updates.full_res_url = storageUrl;
      } else {
        // Download failed — store CDN URL as fallback so modal has something
        if (!creative.thumbnail_url) updates.thumbnail_url = result.thumbnailUrl;
        if (result.fullResUrl) updates.full_res_url = result.fullResUrl;
      }
    } else {
      // Discovery found nothing — mark sentinel so we don't retry on every open
      updates.thumbnail_url = NO_THUMB_SENTINEL;
    }
  }

  // ── Video ────────────────────────────────────────────────────────────────
  // Skip if already in storage, or confirmed no video.
  // Re-run for null (never tried) or stale CDN URLs.
  const skipVideo =
    creative.video_url === NO_VIDEO_SENTINEL ||
    isStorageUrl(creative.video_url);

  if (!skipVideo) {
    console.log(`[${ad_id}] Discovering video...`);
    const videoUrl = await discoverVideoUrl(ad_id, META_ACCESS_TOKEN);
    if (videoUrl && videoUrl !== NO_VIDEO_SENTINEL) {
      const storageUrl = await downloadAndCache(
        supabase, VIDEO_BUCKET, account_id, ad_id, videoUrl, "video"
      );
      // Use storage URL if download succeeded, otherwise fall back to CDN URL
      updates.video_url = storageUrl ?? videoUrl;
    } else {
      updates.video_url = NO_VIDEO_SENTINEL;
    }
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await supabase
      .from("creatives")
      .update(updates)
      .eq("ad_id", ad_id);
    if (updateErr) console.error(`[${ad_id}] Update failed:`, updateErr.message);
  }

  return new Response(
    JSON.stringify({
      ad_id,
      thumbnail_url: updates.thumbnail_url ?? creative.thumbnail_url,
      full_res_url: updates.full_res_url ?? creative.full_res_url,
      video_url: updates.video_url ?? creative.video_url,
      cached: Object.keys(updates).length > 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
