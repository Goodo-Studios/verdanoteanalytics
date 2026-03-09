import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const BATCH_SIZE = 20;
const TIME_BUDGET_MS = 115_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_ITEMS = 1000;
const NO_THUMB_SENTINEL = "no-thumbnail";

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
 * Try multiple Meta API strategies to discover an image URL for an ad.
 */
async function discoverImageUrl(adId: string, accountId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v22.0/${adId}?fields=creative{thumbnail_url,image_url,image_hash,object_story_spec}&access_token=${META_ACCESS_TOKEN}`
    );
    if (!res.ok) { await res.text(); return null; }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) return null;

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
 * Download an image and upload it to Supabase Storage (ad-thumbnails bucket).
 */
const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";

/**
 * Download an image and upload it to Supabase Storage (ad-thumbnails bucket).
 * Returns the permanent public URL (not just the storage path).
 */
async function cacheToStorage(
  supabase: any,
  imageUrl: string,
  accountId: string,
  adId: string
): Promise<{ storagePath: string; publicUrl: string } | null> {
  try {
    const res = await fetchWithTimeout(imageUrl, 12_000);
    if (!res.ok) { await res.text(); return null; }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const storagePath = `${accountId}/${adId}.${ext}`;

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("ad-thumbnails")
      .upload(storagePath, uint8, { contentType, upsert: true });

    if (uploadError) {
      console.error(`Storage upload error for ${adId}:`, uploadError.message);
      return null;
    }

    // Build the permanent public URL
    const { data: publicData } = supabase.storage.from("ad-thumbnails").getPublicUrl(storagePath);
    const publicUrl = publicData?.publicUrl ||
      `${SUPABASE_URL_ENV}/storage/v1/object/public/ad-thumbnails/${storagePath}`;

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
    const url = new URL(req.url);
    let accountFilter: string | null = url.searchParams.get("account_id");
    if (!accountFilter && req.method === "POST") {
      try {
        const body = await req.clone().json();
        accountFilter = body?.account_id || null;
      } catch { /* no body */ }
    }

    // Parse scope: "discover" (default) finds CDN URLs, "cache" stores to Storage
    const scope = url.searchParams.get("scope") || "all";

    // Concurrency guard
    const { data: running } = await supabase
      .from("media_refresh_logs")
      .select("id")
      .eq("status", "running")
      .limit(1);
    if (running && running.length > 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "media_refresh_running" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Scope: discover — find CDN URLs for null-thumbnail creatives ──
    if (scope === "discover" || scope === "all") {
      await runDiscovery(supabase, accountFilter);
    }

    // ── Scope: cache — download CDN URLs to permanent storage ──
    if (scope === "cache" || scope === "all") {
      await runCaching(supabase, accountFilter);
    }

    return new Response(
      JSON.stringify({ status: "completed", scope }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("enrich-thumbnails error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Phase 1: Discover CDN URLs for creatives with null thumbnail_url.
 */
async function runDiscovery(supabase: any, accountFilter: string | null) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .is("thumbnail_url", null)
    .gt("impressions", 0);
  if (accountFilter) query = query.eq("account_id", accountFilter);

  const { data: withSpend } = await query
    .gt("spend", 0)
    .order("spend", { ascending: false })
    .limit(MAX_ITEMS);

  let items = withSpend || [];

  if (items.length < MAX_ITEMS) {
    const remaining = MAX_ITEMS - items.length;
    let zeroQuery = supabase
      .from("creatives")
      .select("ad_id, account_id")
      .is("thumbnail_url", null)
      .gt("impressions", 0)
      .or("spend.is.null,spend.eq.0");
    if (accountFilter) zeroQuery = zeroQuery.eq("account_id", accountFilter);
    const { data: zeroSpend } = await zeroQuery.limit(remaining);
    if (zeroSpend) items = [...items, ...zeroSpend];
  }

  if (items.length === 0) {
    console.log("Discovery: No null-thumbnail creatives to enrich.");
    return;
  }

  console.log(`Discovery: ${items.length} null-thumbnail creatives (account: ${accountFilter || "all"})`);

  const startTime = Date.now();
  let enriched = 0, sentinel = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Discovery budget exceeded at item ${i}. Skipping rest.`);
      break;
    }

    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (c: any) => {
        const imageUrl = await discoverImageUrl(c.ad_id, c.account_id);
        if (imageUrl) {
          await supabase.from("creatives").update({ thumbnail_url: imageUrl }).eq("ad_id", c.ad_id);
          return "enriched";
        } else {
          await supabase.from("creatives").update({ thumbnail_url: NO_THUMB_SENTINEL }).eq("ad_id", c.ad_id);
          return "sentinel";
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value === "enriched") enriched++;
        else sentinel++;
      }
    }

    if (i > 0 && i % 50 === 0) {
      console.log(`Discovery progress: ${enriched} enriched, ${sentinel} sentinel, ${i}/${items.length}`);
    }
  }

  console.log(`Discovery done: ${enriched} enriched, ${sentinel} sentinel`);
}

/**
 * Phase 2: Cache CDN thumbnail URLs to permanent Supabase Storage.
 * Targets creatives that have a thumbnail_url but no thumbnail_storage_path.
 */
async function runCaching(supabase: any, accountFilter: string | null) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id, thumbnail_url")
    .not("thumbnail_url", "is", null)
    .neq("thumbnail_url", NO_THUMB_SENTINEL)
    .is("thumbnail_storage_path", null)
    .gt("impressions", 0);
  if (accountFilter) query = query.eq("account_id", accountFilter);

  const { data: items } = await query
    .order("spend", { ascending: false })
    .limit(500); // smaller batch — storage uploads are slower

  if (!items?.length) {
    console.log("Caching: No creatives need storage caching.");
    return;
  }

  console.log(`Caching: ${items.length} creatives to store (account: ${accountFilter || "all"})`);

  const startTime = Date.now();
  const CACHE_BATCH = 10; // smaller parallel batch for storage uploads
  let cached = 0, failed = 0;

  for (let i = 0; i < items.length; i += CACHE_BATCH) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Caching budget exceeded at item ${i}.`);
      break;
    }

    const batch = items.slice(i, i + CACHE_BATCH);
    const results = await Promise.allSettled(
      batch.map(async (c: any) => {
        const result = await cacheToStorage(supabase, c.thumbnail_url, c.account_id, c.ad_id);
        if (result) {
          // Update thumbnail_url to the permanent storage URL so it never expires
          await supabase.from("creatives")
            .update({
              thumbnail_url: result.publicUrl,
              full_res_url: result.publicUrl,
              thumbnail_storage_path: result.storagePath,
            })
            .eq("ad_id", c.ad_id);
          return "cached";
        }
        return "failed";
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value === "cached") cached++;
        else failed++;
      } else {
        failed++;
      }
    }

    if (i > 0 && i % 30 === 0) {
      console.log(`Caching progress: ${cached} cached, ${failed} failed, ${i}/${items.length}`);
    }
  }

  console.log(`Caching done: ${cached} cached, ${failed} failed`);
}
