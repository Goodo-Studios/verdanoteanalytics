import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover an image URL for a given ad using multiple Meta API strategies.
 */
async function discoverImageUrl(adId: string, accountId: string): Promise<string | null> {
  try {
    // Strategy 1: Get creative fields
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v22.0/${adId}?fields=creative{thumbnail_url,image_url,image_hash,object_story_spec}&access_token=${META_ACCESS_TOKEN}`
    );
    if (!res.ok) { await res.text(); return null; }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) return null;

    // Strategy 1a: Resolve image_hash
    const imageHash =
      creative.image_hash ||
      creative.object_story_spec?.link_data?.image_hash ||
      creative.object_story_spec?.photo_data?.image_hash;

    if (imageHash) {
      const imgRes = await fetchWithTimeout(
        `https://graph.facebook.com/v22.0/${accountId}/adimages?hashes=["${imageHash}"]&fields=url,original_width,original_height&access_token=${META_ACCESS_TOKEN}`
      );
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const img = imgData?.data?.[0];
        if (img?.url && img.url.length > 100) return img.url;
      } else { await imgRes.text(); }
    }

    // Strategy 1b: Video thumbnail
    const spec = creative.object_story_spec;
    const videoId = spec?.video_data?.video_id || spec?.template_data?.video_data?.video_id;
    if (videoId) {
      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/v22.0/${videoId}?fields=thumbnails{uri,width,height}&access_token=${META_ACCESS_TOKEN}`
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        const thumbs = vidData?.thumbnails?.data;
        if (thumbs?.length) {
          const best = thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
          if (best?.uri && (best.width || 0) >= 200) return best.uri;
        }
      } else { await vidRes.text(); }

      const picRes = await fetchWithTimeout(
        `https://graph.facebook.com/v22.0/${videoId}/picture?redirect=false&width=1080&height=1080&access_token=${META_ACCESS_TOKEN}`
      );
      if (picRes.ok) {
        const picData = await picRes.json();
        if (picData?.data?.url) return picData.data.url;
      } else { await picRes.text(); }
    }

    // Strategy 1c: effective_object_story_id → full_picture
    if (creative.id) {
      const creativeRes = await fetchWithTimeout(
        `https://graph.facebook.com/v22.0/${creative.id}?fields=effective_object_story_id,image_url&access_token=${META_ACCESS_TOKEN}`
      );
      if (creativeRes.ok) {
        const creativeData = await creativeRes.json();
        if (creativeData.effective_object_story_id) {
          const postRes = await fetchWithTimeout(
            `https://graph.facebook.com/v22.0/${creativeData.effective_object_story_id}?fields=full_picture&access_token=${META_ACCESS_TOKEN}`
          );
          if (postRes.ok) {
            const postData = await postRes.json();
            if (postData.full_picture) return postData.full_picture;
          } else { await postRes.text(); }
        }
      } else { await creativeRes.text(); }
    }

    // Strategy 1d: Direct fallback fields
    if (creative.image_url) return creative.image_url;
    if (spec) {
      const imageUrl = spec.link_data?.image_url || spec.photo_data?.url || spec.photo_data?.image_url;
      if (imageUrl) return imageUrl;
    }
    if (creative.thumbnail_url) return creative.thumbnail_url;

    return null;
  } catch (e) {
    console.log(`Error discovering image for ${adId}:`, e);
    return null;
  }
}

/**
 * Download an image from a URL and upload it to Supabase Storage.
 * Returns the public URL of the stored image.
 */
async function cacheToStorage(
  supabase: any,
  imageUrl: string,
  accountId: string,
  adId: string
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(imageUrl, 15_000);
    if (!res.ok) { await res.text(); return null; }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const storagePath = `${accountId}/${adId}.${ext}`;

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("ad-thumbnails")
      .upload(storagePath, uint8, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`Storage upload error for ${adId}:`, uploadError.message);
      return null;
    }

    const { data: publicData } = supabase.storage
      .from("ad-thumbnails")
      .getPublicUrl(storagePath);

    return publicData?.publicUrl || null;
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
      imageUrl = await discoverImageUrl(ad_id, account_id);
    }

    if (!imageUrl) {
      // Mark as no-thumbnail sentinel
      await supabase
        .from("creatives")
        .update({ thumbnail_url: "no-thumbnail" })
        .eq("ad_id", ad_id);

      return new Response(
        JSON.stringify({ ad_id, status: "no_image_found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Cache the image to Supabase Storage
    const publicUrl = await cacheToStorage(supabase, imageUrl, account_id, ad_id);

    if (publicUrl) {
      // Update creative: thumbnail_url gets the permanent storage URL, full_res_url also set
      const storagePath = `${account_id}/${ad_id}`;
      await supabase
        .from("creatives")
        .update({
          thumbnail_url: publicUrl,
          full_res_url: publicUrl,
          thumbnail_storage_path: storagePath,
        })
        .eq("ad_id", ad_id);

      return new Response(
        JSON.stringify({ ad_id, status: "cached", public_url: publicUrl, cdn_url: imageUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Couldn't cache but have the CDN URL — save that at least
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
