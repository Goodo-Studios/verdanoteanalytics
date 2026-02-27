import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const BATCH_SIZE = 20; // Process 20 in parallel per batch
const TIME_BUDGET_MS = 115_000; // ~2 min wall-clock (with margin)
const FETCH_TIMEOUT_MS = 8_000; // 8s timeout – fail fast
const MAX_ITEMS = 1000; // Max items per invocation

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
 * Returns a CDN URL string or null if nothing found.
 */
async function discoverImageUrl(adId: string, accountId: string): Promise<string | null> {
  try {
    // Strategy 1: Get creative fields including image_hash and object_story_spec
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v22.0/${adId}?fields=creative{thumbnail_url,image_url,image_hash,object_story_spec}&access_token=${META_ACCESS_TOKEN}`
    );
    if (!res.ok) {
      console.log(`Meta API ${res.status} for ${adId}`);
      await res.text(); // consume body
      return null;
    }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) return null;

    // Strategy 1a: Resolve image_hash → full URL via adimages endpoint
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
        if (img?.url && img.url.length > 100) {
          console.log(`image_hash resolved for ${adId}: ${img.original_width || "?"}px`);
          return img.url;
        }
      } else {
        await imgRes.text();
      }
    }

    // Strategy 1b: Video thumbnail via video_id
    const spec = creative.object_story_spec;
    const videoId =
      spec?.video_data?.video_id || spec?.template_data?.video_data?.video_id;

    if (videoId) {
      // Try thumbnails endpoint first (highest quality)
      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/v22.0/${videoId}?fields=thumbnails{uri,width,height}&access_token=${META_ACCESS_TOKEN}`
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        const thumbs = vidData?.thumbnails?.data;
        if (thumbs?.length) {
          const best = thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
          if (best?.uri && (best.width || 0) >= 200) {
            console.log(`Video thumbnail for ${adId}: ${best.width}x${best.height}`);
            return best.uri;
          }
        }
      } else {
        await vidRes.text();
      }

      // Fallback: video picture endpoint
      const picRes = await fetchWithTimeout(
        `https://graph.facebook.com/v22.0/${videoId}/picture?redirect=false&width=1080&height=1080&access_token=${META_ACCESS_TOKEN}`
      );
      if (picRes.ok) {
        const picData = await picRes.json();
        if (picData?.data?.url) {
          console.log(`Video picture fallback for ${adId}`);
          return picData.data.url;
        }
      } else {
        await picRes.text();
      }
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
            if (postData.full_picture) {
              console.log(`Post full_picture for ${adId}`);
              return postData.full_picture;
            }
          } else {
            await postRes.text();
          }
        }
      } else {
        await creativeRes.text();
      }
    }

    // Strategy 1d: Direct fallback fields
    if (creative.image_url) return creative.image_url;
    if (spec) {
      const imageUrl =
        spec.link_data?.image_url ||
        spec.photo_data?.url ||
        spec.photo_data?.image_url;
      if (imageUrl) return imageUrl;
    }
    if (creative.thumbnail_url) return creative.thumbnail_url;

    return null;
  } catch (e) {
    console.log(`Error discovering image for ${adId}:`, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

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

    // Find null-thumbnail creatives (exclude sentinels)
    let query = supabase
      .from("creatives")
      .select("ad_id, account_id")
      .is("thumbnail_url", null)
      .gt("impressions", 0);
    if (accountFilter) query = query.eq("account_id", accountFilter);

    // Prioritize creatives with spend > 0
    const { data: withSpend } = await query
      .gt("spend", 0)
      .order("spend", { ascending: false })
      .limit(MAX_ITEMS);

    let items = withSpend || [];

    // Fill remaining capacity with zero-spend creatives
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
      console.log("No null-thumbnail creatives to enrich.");
      return new Response(
        JSON.stringify({ enriched: 0, sentinel: 0, total: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Enriching ${items.length} null-thumbnail creatives (account: ${accountFilter || "all"})`);

    const startTime = Date.now();
    let enriched = 0;
    let sentinel = 0;
    let skippedBudget = 0;
    const errors: string[] = [];

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        skippedBudget = items.length - i;
        console.log(`Budget exceeded at item ${i}. Skipping ${skippedBudget} remaining.`);
        break;
      }

      const batch = items.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (c) => {
          const imageUrl = await discoverImageUrl(c.ad_id, c.account_id);
          if (imageUrl) {
            await supabase
              .from("creatives")
              .update({ thumbnail_url: imageUrl })
              .eq("ad_id", c.ad_id);
            return "enriched";
          } else {
            await supabase
              .from("creatives")
              .update({ thumbnail_url: NO_THUMB_SENTINEL })
              .eq("ad_id", c.ad_id);
            return "sentinel";
          }
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value === "enriched") enriched++;
          else sentinel++;
        } else {
          const msg = `${r.reason}`;
          console.log(`Error: ${msg}`);
          errors.push(msg);
        }
      }

      // Progress log every 50 items
      if (i > 0 && i % 50 === 0) {
        console.log(`Progress: ${enriched} enriched, ${sentinel} sentinel, ${i}/${items.length}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `Done in ${(duration / 1000).toFixed(1)}s: ${enriched} enriched, ${sentinel} sentinel, ${skippedBudget} skipped (budget)`
    );

    return new Response(
      JSON.stringify({
        enriched,
        sentinel,
        skippedBudget,
        total: items.length,
        durationMs: duration,
        errors: errors.slice(0, 10),
      }),
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
