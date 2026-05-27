import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  discoverImageUrl,
  discoverVideoUrl,
  fetchAccountVideoMap,
  fetchWithTimeout,
  NO_THUMB_SENTINEL,
  NO_VIDEO_SENTINEL,
} from "../_shared/media-discovery.ts";


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

    // Resolve Meta access token — env var first, then settings table fallback (same as sync function)
    let metaAccessToken = Deno.env.get("META_ACCESS_TOKEN") || null;
    if (!metaAccessToken) {
      const { data: tokenRow } = await supabase.from("settings").select("value").eq("key", "meta_access_token").single();
      metaAccessToken = tokenRow?.value || null;
    }
    if (!metaAccessToken) {
      return new Response(
        JSON.stringify({ error: "No Meta access token configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      await runDiscovery(supabase, accountFilter, metaAccessToken);
    }

    if (scope === "cache" || scope === "all") {
      await runCaching(supabase, accountFilter);
    }

    if (scope === "video") {
      await runVideoDiscovery(supabase, accountFilter, metaAccessToken);
    }

    if (scope === "all") {
      // Unified pass: discover videos for new creatives (null) AND retry a small
      // batch of sentinels — one account-video-map build covers both, avoiding
      // the double-pagination cost of running runVideoDiscovery + runVideoRediscovery
      // sequentially on the same accounts.
      await runVideoDiscoveryFull(supabase, accountFilter, metaAccessToken);
    }

    // force: re-run discovery on sentineled creatives (thumbnail_url = 'no-thumbnail')
    // Use this to recover from runs that happened when the Meta token was expired.
    if (scope === "force") {
      await runForcedRediscovery(supabase, accountFilter, metaAccessToken);
      await runVideoRediscovery(supabase, accountFilter, metaAccessToken);
      await runCaching(supabase, accountFilter);
    }

    // force-video: re-run video discovery only, for creatives with no-video sentinel.
    // Lighter than scope=force — only touches video_url, avoids memory limit on large accounts.
    if (scope === "force-video") {
      await runVideoRediscovery(supabase, accountFilter, metaAccessToken);
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
async function runDiscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
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
        const result = await discoverImageUrl(c.ad_id, c.account_id, metaAccessToken, 8_000);
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

/**
 * Phase 3: Discover video source URLs for creatives with null video_url.
 * Groups creatives by account so the account video library map is built once
 * per account — this is the key fix for (#10) page-permission errors.
 */
async function runVideoDiscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .is("video_url", null)
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
      .is("video_url", null)
      .gt("impressions", 0)
      .or("spend.is.null,spend.eq.0");
    if (accountFilter) zeroQuery = zeroQuery.eq("account_id", accountFilter);
    const { data: zeroSpend } = await zeroQuery.limit(remaining);
    if (zeroSpend) items = [...items, ...zeroSpend];
  }

  if (items.length === 0) {
    console.log("Video discovery: No null-video_url creatives to enrich.");
    return;
  }

  console.log(`Video discovery: ${items.length} creatives to check (account: ${accountFilter || "all"})`);

  // Group by account_id so we build the video library map once per account.
  const byAccount = new Map<string, any[]>();
  for (const c of items) {
    const arr = byAccount.get(c.account_id) || [];
    arr.push(c);
    byAccount.set(c.account_id, arr);
  }

  const startTime = Date.now();
  let found = 0, sentinel = 0;

  for (const [accountId, accountCreatives] of byAccount) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log("Video discovery budget exceeded. Skipping remaining accounts.");
      break;
    }

    // Build account video library map — one API pagination per account, reused for all its creatives.
    const accountVideoMap = await fetchAccountVideoMap(accountId, metaAccessToken);

    for (let i = 0; i < accountCreatives.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`Video discovery budget exceeded at item ${i}. Skipping rest.`);
        break;
      }

      const batch = accountCreatives.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (c: any) => {
          const videoUrl = await discoverVideoUrl(c.ad_id, metaAccessToken, 8_000, accountVideoMap);
          if (videoUrl) {
            await supabase.from("creatives").update({ video_url: videoUrl }).eq("ad_id", c.ad_id);
            return "found";
          } else {
            await supabase.from("creatives").update({ video_url: NO_VIDEO_SENTINEL }).eq("ad_id", c.ad_id);
            return "sentinel";
          }
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value === "found") found++;
          else sentinel++;
        }
      }
    }
  }

  console.log(`Video discovery done: ${found} found, ${sentinel} sentinel`);
}

/**
 * Force re-discovery: re-run image discovery on creatives that were previously
 * sentineled (thumbnail_url = 'no-thumbnail'), e.g. from a bad-token run.
 * Clears the sentinel first so runCaching can pick them up afterwards.
 */
async function runForcedRediscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .eq("thumbnail_url", NO_THUMB_SENTINEL)
    .gt("impressions", 0);
  if (accountFilter) query = query.eq("account_id", accountFilter);

  const { data: items } = await query
    .order("spend", { ascending: false })
    .limit(MAX_ITEMS);

  if (!items?.length) {
    console.log("Force rediscovery: No sentineled image creatives found.");
    return;
  }

  console.log(`Force rediscovery: ${items.length} sentineled image creatives (account: ${accountFilter || "all"})`);

  const startTime = Date.now();
  let enriched = 0, sentinel = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Force rediscovery budget exceeded at item ${i}.`);
      break;
    }

    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (c: any) => {
        const result = await discoverImageUrl(c.ad_id, c.account_id, metaAccessToken, 8_000);
        if (result) {
          await supabase.from("creatives")
            .update({ thumbnail_url: result.thumbnailUrl, full_res_url: result.fullResUrl || result.thumbnailUrl, thumbnail_storage_path: null })
            .eq("ad_id", c.ad_id);
          return "enriched";
        }
        // Leave sentinel in place — still no image available
        return "sentinel";
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value === "enriched") enriched++;
        else sentinel++;
      }
    }
  }

  console.log(`Force rediscovery done: ${enriched} recovered, ${sentinel} still no image`);
}

/**
 * Force re-discovery for videos: re-run video discovery on creatives that were
 * previously sentineled (video_url = 'no-video').
 * Groups by account and builds the video library map once per account.
 */
async function runVideoRediscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .eq("video_url", NO_VIDEO_SENTINEL)
    .gt("impressions", 0);
  if (accountFilter) query = query.eq("account_id", accountFilter);

  const { data: items } = await query
    .order("spend", { ascending: false })
    .limit(MAX_ITEMS);

  if (!items?.length) {
    console.log("Video rediscovery: No sentineled video creatives found.");
    return;
  }

  console.log(`Video rediscovery: ${items.length} sentineled video creatives (account: ${accountFilter || "all"})`);

  // Group by account_id so we build the video library map once per account.
  const byAccount = new Map<string, any[]>();
  for (const c of items) {
    const arr = byAccount.get(c.account_id) || [];
    arr.push(c);
    byAccount.set(c.account_id, arr);
  }

  const startTime = Date.now();
  let found = 0, sentinel = 0;

  for (const [accountId, accountCreatives] of byAccount) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log("Video rediscovery budget exceeded. Skipping remaining accounts.");
      break;
    }

    // Build account video library map — one API pagination per account.
    const accountVideoMap = await fetchAccountVideoMap(accountId, metaAccessToken);

    for (let i = 0; i < accountCreatives.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`Video rediscovery budget exceeded at item ${i}.`);
        break;
      }

      const batch = accountCreatives.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (c: any) => {
          const videoUrl = await discoverVideoUrl(c.ad_id, metaAccessToken, 8_000, accountVideoMap);
          if (videoUrl) {
            await supabase.from("creatives").update({ video_url: videoUrl }).eq("ad_id", c.ad_id);
            return "found";
          }
          return "sentinel";
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value === "found") found++;
          else sentinel++;
        }
      }
    }
  }

  console.log(`Video rediscovery done: ${found} recovered, ${sentinel} still no video`);
}

/**
 * Unified video discovery pass for scope=all (sync-triggered runs).
 *
 * Combines null-video discovery and sentinel retry into a single pass so the
 * account video library map is built only once per account. Without this,
 * running runVideoDiscovery + runVideoRediscovery sequentially would paginate
 * each account's advideos endpoint twice, eating the time budget for large accounts.
 *
 * Strategy:
 *  - Up to MAX_ITEMS new creatives (video_url IS NULL, ordered by spend desc)
 *  - Up to SENTINEL_RETRY_LIMIT recently-sentineled creatives (video_url = 'no-video')
 *    as a lighter background pass to catch transient failures from prior runs
 *  - One fetchAccountVideoMap call per account covers both sets
 *  - Null items: write URL on success, write sentinel on failure (same as runVideoDiscovery)
 *  - Sentinel items: write URL on success, leave sentinel intact on failure (no-op)
 */
const SENTINEL_RETRY_LIMIT = 200;

async function runVideoDiscoveryFull(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  // ── Fetch null-video creatives (high priority — new creatives) ────────────
  let nullQuery = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .is("video_url", null)
    .gt("impressions", 0);
  if (accountFilter) nullQuery = nullQuery.eq("account_id", accountFilter);

  const { data: withSpend } = await nullQuery
    .gt("spend", 0)
    .order("spend", { ascending: false })
    .limit(MAX_ITEMS);

  let nullItems: Array<{ ad_id: string; account_id: string }> = withSpend || [];

  if (nullItems.length < MAX_ITEMS) {
    const remaining = MAX_ITEMS - nullItems.length;
    let zeroQuery = supabase
      .from("creatives")
      .select("ad_id, account_id")
      .is("video_url", null)
      .gt("impressions", 0)
      .or("spend.is.null,spend.eq.0");
    if (accountFilter) zeroQuery = zeroQuery.eq("account_id", accountFilter);
    const { data: zeroSpend } = await zeroQuery.limit(remaining);
    if (zeroSpend) nullItems = [...nullItems, ...zeroSpend];
  }

  // ── Fetch sentinel creatives (lower priority — retry transient failures) ──
  let sentinelQuery = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .eq("video_url", NO_VIDEO_SENTINEL)
    .gt("impressions", 0)
    .gt("spend", 0);
  if (accountFilter) sentinelQuery = sentinelQuery.eq("account_id", accountFilter);

  const { data: sentinelItems } = await sentinelQuery
    .order("spend", { ascending: false })
    .limit(SENTINEL_RETRY_LIMIT);

  const retrySet = new Set((sentinelItems || []).map((c: any) => c.ad_id));
  const allItems = [
    ...nullItems.map((c: any) => ({ ...c, isRetry: false })),
    ...(sentinelItems || []).map((c: any) => ({ ...c, isRetry: true })),
  ];

  if (allItems.length === 0) {
    console.log("Video discovery (full): Nothing to process.");
    return;
  }

  console.log(
    `Video discovery (full): ${nullItems.length} new + ${retrySet.size} sentinel retries` +
    ` (account: ${accountFilter || "all"})`
  );

  // ── Group by account — build map once per account ─────────────────────────
  const byAccount = new Map<string, Array<{ ad_id: string; account_id: string; isRetry: boolean }>>();
  for (const c of allItems) {
    const arr = byAccount.get(c.account_id) || [];
    arr.push(c);
    byAccount.set(c.account_id, arr);
  }

  const startTime = Date.now();
  let found = 0, newSentinel = 0, retryRecovered = 0;

  for (const [accountId, accountCreatives] of byAccount) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log("Video discovery (full) budget exceeded. Skipping remaining accounts.");
      break;
    }

    // Single map build per account covers both null and retry creatives.
    const accountVideoMap = await fetchAccountVideoMap(accountId, metaAccessToken);

    for (let i = 0; i < accountCreatives.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`Video discovery (full) budget exceeded at item ${i}.`);
        break;
      }

      const batch = accountCreatives.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (c) => {
          const videoUrl = await discoverVideoUrl(c.ad_id, metaAccessToken, 8_000, accountVideoMap);
          if (videoUrl) {
            await supabase.from("creatives").update({ video_url: videoUrl }).eq("ad_id", c.ad_id);
            return c.isRetry ? "retry-recovered" : "found";
          } else if (!c.isRetry) {
            // New creative, no video found — write sentinel so we don't retry on every sync.
            await supabase.from("creatives").update({ video_url: NO_VIDEO_SENTINEL }).eq("ad_id", c.ad_id);
            return "sentinel";
          }
          // Sentinel retry that still found nothing — leave as-is.
          return "retry-miss";
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value === "found") found++;
          else if (r.value === "sentinel") newSentinel++;
          else if (r.value === "retry-recovered") retryRecovered++;
        }
      }
    }
  }

  console.log(
    `Video discovery (full) done: ${found} new found, ${newSentinel} new sentinel,` +
    ` ${retryRecovered} sentinels recovered`
  );
}
