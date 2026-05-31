import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  discoverImageUrl,
  fetchWithTimeout,
  NO_THUMB_SENTINEL,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";


const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

/**
 * Download an image from a URL and upload it to Supabase Storage.
 * Returns the public URL of the stored image.
 */
async function cacheToStorage(
  supabase: any,
  imageUrl: string,
  accountId: string,
  adId: string
): Promise<{ storagePath: string; publicUrl: string } | null> {
  try {
    const res = await fetchWithTimeout(imageUrl, 15_000);
    if (!res.ok) { await res.text(); return null; }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    // Guard: never store a non-image payload (e.g. a text/html ad page) as <adId>.jpg.
    if (!isMediaContentType(contentType, "image")) {
      console.log(`Refusing to cache image for ${adId}: non-image content (${contentType})`);
      return null;
    }
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const storagePath = `${accountId}/${adId}.${ext}`;

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // Quality guard: reject tiny images (likely low-res placeholders)
    if (arrayBuffer.byteLength < 5000) {
      console.log(`Skipping low-quality image for ${adId}: ${arrayBuffer.byteLength} bytes`);
      return null;
    }

    const uint8 = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("ad-thumbnails")
      .upload(storagePath, uint8, { contentType, upsert: true });

    if (uploadError) {
      console.error(`Storage upload error for ${adId}:`, uploadError.message);
      return null;
    }

    const { data: publicData } = supabase.storage.from("ad-thumbnails").getPublicUrl(storagePath);
    const publicUrl = publicData?.publicUrl ||
      `${SUPABASE_URL}/storage/v1/object/public/ad-thumbnails/${storagePath}`;

    return { storagePath, publicUrl };
  } catch (e) {
    console.error(`Cache to storage error for ${adId}:`, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { ad_id, account_id, thumbnail_url } = body;

    if (!ad_id || !account_id) {
      return new Response(
        JSON.stringify({ error: "ad_id and account_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Discover image URL if not provided
    let imageUrl = thumbnail_url || null;
    if (!imageUrl) {
      const result = await discoverImageUrl(ad_id, account_id, META_ACCESS_TOKEN, 10_000);
      imageUrl = result?.thumbnailUrl || null;
    }

    if (!imageUrl) {
      await supabase
        .from("creatives")
        .update({ thumbnail_url: NO_THUMB_SENTINEL })
        .eq("ad_id", ad_id);

      return new Response(
        JSON.stringify({ ad_id, status: "no_image_found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Cache the image to Supabase Storage
    const cached = await cacheToStorage(supabase, imageUrl, account_id, ad_id);

    if (cached) {
      // FIX: storage path now includes file extension (was missing before)
      await supabase
        .from("creatives")
        .update({
          thumbnail_url: cached.publicUrl,
          full_res_url: cached.publicUrl,
          thumbnail_storage_path: cached.storagePath,
        })
        .eq("ad_id", ad_id);

      return new Response(
        JSON.stringify({ ad_id, status: "cached", public_url: cached.publicUrl, cdn_url: imageUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      await supabase
        .from("creatives")
        .update({ thumbnail_url: imageUrl })
        .eq("ad_id", ad_id);

      return new Response(
        JSON.stringify({ ad_id, status: "cdn_only", cdn_url: imageUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (e) {
    console.error("fetch-thumbnail error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
