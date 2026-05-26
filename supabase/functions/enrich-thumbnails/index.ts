import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  discoverImageUrl,
  fetchWithTimeout,
  NO_THUMB_SENTINEL,
} from "../_shared/media-discovery.ts";


const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
const BATCH_SIZE = 20;
const TIME_BUDGET_MS = 115_000;
const MAX_ITEMS = 1000;

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

    const scope = url.searchParams.get("scope") || "all";

    // Concurrency guard — scoped to the specific account when account_id is provided,
    // so a sync-triggered per-account run isn't blocked by a concurrent cron run on a different account.
    let guardQuery = supabase.from("media_refresh_logs").select("id").eq("status", "running");
    if (accountFilter) guardQuery = guardQuery.eq("account_id", accountFilter);
    const { data: running } = await guardQuery.limit(1);
    if (running && running.length > 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "media_refresh_running" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (scope === "discover" || scope === "all") {
      await runDiscovery(supabase, accountFilter);
    }

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
        const result = await discoverImageUrl(c.ad_id, c.account_id, META_ACCESS_TOKEN, 8_000);
        if (result) {
          await supabase.from("creatives").update({ thumbnail_url: result.thumbnailUrl }).eq("ad_id", c.ad_id);
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
  }

  console.log(`Discovery done: ${enriched} enriched, ${sentinel} sentinel`);
}

/**
 * Phase 2: Cache CDN thumbnail URLs to permanent Supabase Storage.
 * FIX: No longer overwrites full_res_url with same compressed storage URL.
 */
async function runCaching(supabase: any, accountFilter: string | null) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id, thumbnail_url, full_res_url")
    .not("thumbnail_url", "is", null)
    .neq("thumbnail_url", NO_THUMB_SENTINEL)
    .is("thumbnail_storage_path", null)
    .gt("impressions", 0);
  if (accountFilter) query = query.eq("account_id", accountFilter);

  const { data: items } = await query
    .order("spend", { ascending: false })
    .limit(500);

  if (!items?.length) {
    console.log("Caching: No creatives need storage caching.");
    return;
  }

  console.log(`Caching: ${items.length} creatives to store (account: ${accountFilter || "all"})`);

  const startTime = Date.now();
  const CACHE_BATCH = 10;
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
          // FIX: Only set full_res_url if it was previously null — don't overwrite
          // a higher-resolution CDN URL with the compressed storage version.
          const updatePayload: Record<string, string> = {
            thumbnail_url: result.publicUrl,
            thumbnail_storage_path: result.storagePath,
          };
          if (!c.full_res_url) {
            updatePayload.full_res_url = result.publicUrl;
          }
          await supabase.from("creatives")
            .update(updatePayload)
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
  }

  console.log(`Caching done: ${cached} cached, ${failed} failed`);
}
