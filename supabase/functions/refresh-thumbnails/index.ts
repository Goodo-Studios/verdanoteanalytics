import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  discoverImageUrl,
  discoverPreviewUrl,
  discoverVideoUrl,
  fetchWithTimeout,
  NO_THUMB_SENTINEL,
  NO_VIDEO_SENTINEL,
} from "../_shared/media-discovery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";
const DISCOVERY_BATCH_SIZE = 5;
const CACHE_BATCH_SIZE = 15;
const VIDEO_BATCH_SIZE = 1;
const MAX_TOTAL = 5000;
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;
const TIME_BUDGET_MS = 110_000;
const FETCH_TIMEOUT_MS = 30_000;
const MEDIA_REFRESH_COOLDOWN_HOURS = 2;

async function downloadAndCache(
  supabase: any,
  bucket: string,
  accountId: string,
  adId: string,
  url: string,
  type: "image" | "video"
): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, 60_000);
    if (!resp.ok) {
      console.log(`Download failed ${adId}: HTTP ${resp.status} ${resp.statusText}`);
      return null;
    }
    const blob = await resp.arrayBuffer();
    if (type === "image" && blob.byteLength < 5000) {
      console.log(`Skipping low-quality image for ${adId}: ${blob.byteLength} bytes`);
      return null;
    }
    if (type === "video" && blob.byteLength > MAX_VIDEO_SIZE) {
      console.log(`Skipping oversized video for ${adId}: ${(blob.byteLength / 1024 / 1024).toFixed(1)}MB`);
      return null;
    }
    const contentType = resp.headers.get("content-type") || (type === "video" ? "video/mp4" : "image/jpeg");
    const ext = type === "video"
      ? (contentType.includes("webm") ? "webm" : "mp4")
      : (contentType.includes("png") ? "png" : "jpg");
    const path = `${accountId}/${adId}.${ext}`;

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, new Uint8Array(blob), { contentType, upsert: true });
    if (error) {
      console.log(`Upload error ${adId}:`, error.message);
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  } catch (err) {
    console.log(`Cache error ${adId}:`, err);
    return null;
  }
}

/** Helper to check if we've exceeded our time budget — takes start time as parameter */
function isOverBudget(startTime: number): boolean {
  return Date.now() - startTime > TIME_BUDGET_MS;
}

/** Helper to update the progress log row */
async function updateLog(supabase: any, logId: number, updates: Record<string, any>) {
  await supabase.from("media_refresh_logs").update(updates).eq("id", logId);
}

/**
 * Pick the single account to process this invocation.
 * Strategy: explicit account_id → use that; otherwise round-robin by last_media_sync ASC NULLS FIRST.
 */
async function pickAccount(
  supabase: any,
  requestedAccountId: string | null,
  force = false
): Promise<{ account: any | null; skippedAll: boolean; nextAccount: any | null }> {
  if (requestedAccountId && requestedAccountId !== "all") {
    const { data: account, error } = await supabase
      .from("ad_accounts")
      .select("id, name, creative_count")
      .eq("id", requestedAccountId)
      .single();
    if (error) {
      console.log(`Could not fetch account ${requestedAccountId}: ${error.message}`);
      return { account: { id: requestedAccountId, name: requestedAccountId }, skippedAll: false, nextAccount: null };
    }
    return { account: account || null, skippedAll: false, nextAccount: null };
  }

  let accounts: any[] | null = null;
  const { data: accountsWithSync, error: syncErr } = await supabase
    .from("ad_accounts")
    .select("id, name, last_media_sync, creative_count")
    .eq("is_active", true)
    .order("last_media_sync", { ascending: true, nullsFirst: true })
    .order("creative_count", { ascending: false, nullsFirst: false });

  if (syncErr) {
    console.log(`last_media_sync column not available (${syncErr.message}), using fallback ordering`);
    const { data: fallbackAccounts } = await supabase
      .from("ad_accounts")
      .select("id, name, creative_count, last_synced_at")
      .eq("is_active", true)
      .order("last_synced_at", { ascending: true, nullsFirst: true });
    accounts = fallbackAccounts;
  } else {
    accounts = accountsWithSync;
  }

  if (!accounts || accounts.length === 0) {
    return { account: null, skippedAll: true, nextAccount: null };
  }

  if (force) {
    // Force mode: pick the most stale account, ignoring cooldown
    const nextAcc = accounts.length > 1 ? accounts[1] : null;
    return { account: accounts[0], skippedAll: false, nextAccount: nextAcc };
  }

  const cooldownMs = MEDIA_REFRESH_COOLDOWN_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  for (const acc of accounts) {
    if (!acc.last_media_sync) {
      const nextAcc = accounts.find((a: any) => a.id !== acc.id);
      return { account: acc, skippedAll: false, nextAccount: nextAcc || null };
    }
    const lastRefresh = new Date(acc.last_media_sync).getTime();
    if (now - lastRefresh >= cooldownMs) {
      const nextAcc = accounts.find((a: any) => a.id !== acc.id);
      return { account: acc, skippedAll: false, nextAccount: nextAcc || null };
    }
  }

  const mostStale = accounts[0];
  const staleMs = mostStale.last_media_sync
    ? now - new Date(mostStale.last_media_sync).getTime()
    : 0;
  const staleMin = Math.round(staleMs / 60000);
  console.log(
    `All ${accounts.length} accounts refreshed within cooldown window (${MEDIA_REFRESH_COOLDOWN_HOURS}h). ` +
    `Most stale: ${mostStale.name} (${staleMin}m ago). Skipping.`
  );
  return { account: null, skippedAll: true, nextAccount: mostStale };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("force") === "true";

    let accountFilter: string | null = url.searchParams.get("account_id");
    if (!accountFilter && req.method === "POST") {
      try {
        const body = await req.clone().json();
        accountFilter = body?.account_id || null;
      } catch { /* no body */ }
    }

    const { account: targetAccount, skippedAll, nextAccount } = await pickAccount(supabase, accountFilter, forceRefresh);

    if (skippedAll || !targetAccount) {
      console.log("All accounts are within cooldown — nothing to process.");
      return new Response(JSON.stringify({
        skipped: true,
        reason: "all_accounts_within_cooldown",
        next_eligible_account: nextAccount ? { id: nextAccount.id, name: nextAccount.name, last_media_sync: nextAccount.last_media_sync } : null,
        cooldown_hours: MEDIA_REFRESH_COOLDOWN_HOURS,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolvedAccountId = targetAccount.id;
    console.log(`Processing account: ${targetAccount.name} (${resolvedAccountId}) — last refresh: ${targetAccount.last_media_sync || "never"}`);

    // Concurrency guard
    if (!forceRefresh) {
      const { data: runningLogs } = await supabase
        .from("media_refresh_logs")
        .select("id")
        .eq("status", "running")
        .eq("account_id", resolvedAccountId)
        .limit(1);
      if (runningLogs && runningLogs.length > 0) {
        console.log(`Skipping ${targetAccount.name}: media refresh already running.`);
        return new Response(JSON.stringify({
          skipped: true,
          reason: "already_running",
          account_id: resolvedAccountId,
          next_account: nextAccount ? { id: nextAccount.id, name: nextAccount.name } : null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      await supabase
        .from("media_refresh_logs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("status", "running")
        .eq("account_id", resolvedAccountId);
      console.log(`Force mode: cleared stale running logs for ${resolvedAccountId}`);
    }

    // Create progress log
    const { data: logRow } = await supabase
      .from("media_refresh_logs")
      .insert({ account_id: resolvedAccountId, status: "running", current_phase: 1 })
      .select("id")
      .single();
    const logId = logRow?.id;

    // FIX: Pass invocationStart as a parameter instead of using global mutable state
    const invocationStart = Date.now();

    // ── Phase 1: Discovery ──────────────────────────────────────
    // FAST PATH: thumbnails with CDN URL not yet cached to storage
    const { data: uncachedThumbs } = await supabase
      .from("creatives")
      .select("ad_id, account_id, thumbnail_url")
      .not("thumbnail_url", "is", null)
      .neq("thumbnail_url", NO_THUMB_SENTINEL)
      .not("thumbnail_url", "like", `%/storage/v1/object/public/%`)
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0)
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(MAX_TOTAL);

    // SLOW PATH: NULL + sentinel thumbnails needing Meta API discovery
    const { data: missingThumbs } = await supabase
      .from("creatives")
      .select("ad_id, account_id, thumbnail_url")
      .or("thumbnail_url.is.null,thumbnail_url.eq.no-thumbnail")
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0)
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(MAX_TOTAL);

    // UPGRADE PATH: already cached but full_res_url is missing or same as thumbnail
    // These were cached before higher-res discovery strategies were added
    const { data: upgradeThumbsRaw } = await supabase
      .from("creatives")
      .select("ad_id, account_id, thumbnail_url")
      .like("thumbnail_url", `%/storage/v1/object/public/%`)
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0)
      .or("full_res_url.is.null,full_res_url.eq.thumbnail_url")
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(500);
    const upgradeThumbs = upgradeThumbsRaw || [];

    const fastPathThumbs = uncachedThumbs || [];
    const slowPathThumbs = missingThumbs || [];
    const allThumbWork = [...fastPathThumbs, ...slowPathThumbs].slice(0, MAX_TOTAL);

    // FIX: Thumbnail sentinel reset (like video sentinel reset)
    // Reset no-thumbnail for active ads with meaningful spend — Meta may have valid thumbnails now
    {
      const { data: sentinelThumbRows } = await supabase
        .from("creatives")
        .select("ad_id")
        .eq("thumbnail_url", NO_THUMB_SENTINEL)
        .eq("account_id", resolvedAccountId)
        .gt("spend", 50)
        .gt("impressions", 0)
        .order("spend", { ascending: false, nullsFirst: false })
        .limit(200);
      if (sentinelThumbRows && sentinelThumbRows.length > 0) {
        const ids = sentinelThumbRows.map((r: any) => r.ad_id);
        await supabase.from("creatives").update({ thumbnail_url: null }).in("ad_id", ids);
        console.log(`[${targetAccount.name}] Reset ${ids.length} no-thumbnail sentinels for active ads`);
      }
    }

    // Video sentinel reset — only for likely-video ads, not static/image with auto-play views
    {
      const { data: sentinelRows } = await supabase
        .from("creatives")
        .select("ad_id, ad_type, ad_name")
        .eq("video_url", NO_VIDEO_SENTINEL)
        .eq("account_id", resolvedAccountId)
        .gt("video_views", 500)  // Higher threshold: filter out auto-play on static ads
        .gt("spend", 100)
        .order("spend", { ascending: false, nullsFirst: false })
        .limit(100);
      if (sentinelRows && sentinelRows.length > 0) {
        // Skip ads that are clearly not videos
        const STATIC_TYPES = ["Static Image", "Graphic", "Image", "Carousel"];
        const eligible = sentinelRows.filter((r: any) => {
          if (STATIC_TYPES.includes(r.ad_type)) return false;
          return true;
        });
        if (eligible.length > 0) {
          const ids = eligible.map((r: any) => r.ad_id);
          await supabase.from("creatives").update({ video_url: null }).in("ad_id", ids);
          console.log(`[${targetAccount.name}] Reset ${ids.length} no-video sentinels for likely-video ads (skipped ${sentinelRows.length - eligible.length} static)`);
        }
      }
    }

    // Videos needing discovery (null or sentinel) — exclude known static ad types
    const { data: missingVideosRaw } = await supabase
      .from("creatives")
      .select("ad_id, account_id, ad_type, ad_name")
      .or("video_url.is.null,video_url.eq.no-video")
      .eq("account_id", resolvedAccountId)
      .gt("video_views", 0)
      .gt("impressions", 0)
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(2000);
    // Filter out static ad types that can't have real videos
    const STATIC_AD_TYPES = ["Static Image", "Graphic", "Image"];
    const missingVideos = (missingVideosRaw || []).filter((c: any) => {
      if (STATIC_AD_TYPES.includes(c.ad_type)) return false;
      return true;
    });

    // FIX: Videos with existing CDN URLs — skip re-discovery, just download directly
    const { data: uncachedVideos } = await supabase
      .from("creatives")
      .select("ad_id, account_id, video_url")
      .not("video_url", "is", null)
      .not("video_url", "like", `%/storage/v1/object/public/%`)
      .neq("video_url", NO_VIDEO_SENTINEL)
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0)
      .limit(2000);

    // Preview URLs
    const { data: missingPreviews } = await supabase
      .from("creatives")
      .select("ad_id")
      .is("preview_url", null)
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0)
      .limit(MAX_TOTAL);

    const noVideos = missingVideos;
    const videos = uncachedVideos || [];
    const previews = missingPreviews || [];

    const thumbsTotal = allThumbWork.length;
    const videosTotal = noVideos.length + videos.length;

    if (logId) {
      await updateLog(supabase, logId, {
        current_phase: 1,
        thumbs_total: thumbsTotal,
        videos_total: videosTotal,
      });
    }

    console.log(`[${targetAccount.name}] Discovery: fastThumbs=${fastPathThumbs.length} slowThumbs=${slowPathThumbs.length} upgradeThumbs=${upgradeThumbs.length} missingVideos=${noVideos.length} uncachedVideos=${videos.length} previews=${previews.length}`);

    if (thumbsTotal === 0 && videosTotal === 0 && upgradeThumbs.length === 0) {
      console.log(`[${targetAccount.name}] All media already cached — marking complete.`);
      if (logId) {
        await updateLog(supabase, logId, {
          status: "completed",
          current_phase: 4,
          completed_at: new Date().toISOString(),
        });
      }
      await supabase
        .from("ad_accounts")
        .update({ last_media_sync: new Date().toISOString() })
        .eq("id", resolvedAccountId);

      return new Response(JSON.stringify({
        account: { id: resolvedAccountId, name: targetAccount.name },
        thumbnails: { cached: 0, failed: 0, total: 0 },
        videos: { cached: 0, failed: 0, total: 0 },
        next_account: nextAccount ? { id: nextAccount.id, name: nextAccount.name } : null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Phase 2: Process thumbnails ──────────────────────────────────────
    if (logId) await updateLog(supabase, logId, { current_phase: 2 });
    let budgetExceeded = false;
    let thumbCached = 0, thumbFailed = 0;

    // FAST PATH: parallel download+upload for thumbnails with CDN URLs
    for (let i = 0; i < fastPathThumbs.length; i += CACHE_BATCH_SIZE) {
      if (isOverBudget(invocationStart)) {
        console.log(`Budget reached during fast-path at ${i}/${fastPathThumbs.length}. Cached: ${thumbCached}`);
        budgetExceeded = true;
        break;
      }
      const batch = fastPathThumbs.slice(i, i + CACHE_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (c: any) => {
          if (isOverBudget(invocationStart)) return false;
          const storageUrl = await downloadAndCache(supabase, THUMB_BUCKET, c.account_id, c.ad_id, c.thumbnail_url, "image");
          if (storageUrl) {
            await supabase.from("creatives").update({
              thumbnail_url: storageUrl,
              full_res_url: storageUrl,
              thumbnail_storage_path: `${c.account_id}/${c.ad_id}`,
            }).eq("ad_id", c.ad_id);
            return true;
          } else {
            await supabase.from("creatives").update({ thumbnail_url: NO_THUMB_SENTINEL }).eq("ad_id", c.ad_id);
            return false;
          }
        })
      );
      thumbCached += results.filter((r: any) => r.status === "fulfilled" && r.value).length;
      thumbFailed += results.filter((r: any) => r.status === "rejected" || (r.status === "fulfilled" && !r.value)).length;

      if (logId && i % 60 === 0) {
        await updateLog(supabase, logId, { thumbs_cached: thumbCached, thumbs_failed: thumbFailed });
      }
    }

    // SLOW PATH: Meta API discovery for NULL thumbnails — discover AND cache to storage
    if (!budgetExceeded) {
      for (let i = 0; i < slowPathThumbs.length; i += DISCOVERY_BATCH_SIZE) {
        if (isOverBudget(invocationStart)) {
          console.log(`Budget reached during slow-path at ${i}/${slowPathThumbs.length}`);
          budgetExceeded = true;
          break;
        }
        const batch = slowPathThumbs.slice(i, i + DISCOVERY_BATCH_SIZE);
        for (const c of batch) {
          if (isOverBudget(invocationStart)) continue;
          const freshResult = await discoverImageUrl(c.ad_id, c.account_id, META_ACCESS_TOKEN, FETCH_TIMEOUT_MS);
          if (!freshResult) {
            await supabase.from("creatives").update({ thumbnail_url: NO_THUMB_SENTINEL }).eq("ad_id", c.ad_id);
            thumbFailed++;
            continue;
          }
          // Cache the discovered URL to storage (same as fast path)
          const bestUrl = freshResult.fullResUrl || freshResult.thumbnailUrl;
          const storageUrl = await downloadAndCache(supabase, THUMB_BUCKET, c.account_id, c.ad_id, bestUrl, "image");
          if (storageUrl) {
            await supabase.from("creatives").update({
              thumbnail_url: storageUrl,
              full_res_url: storageUrl,
              thumbnail_storage_path: `${c.account_id}/${c.ad_id}`,
            }).eq("ad_id", c.ad_id);
            thumbCached++;
          } else {
            // Fallback: store the CDN URL directly if download fails
            const updatePayload: Record<string, string | null> = { thumbnail_url: freshResult.thumbnailUrl };
            if (freshResult.fullResUrl) updatePayload.full_res_url = freshResult.fullResUrl;
            await supabase.from("creatives").update(updatePayload).eq("ad_id", c.ad_id);
            thumbCached++;
          }
        }
      }
    }

    // ── Phase 2b: Upgrade already-cached thumbnails with better resolution ──
    let thumbUpgraded = 0;
    if (!budgetExceeded && upgradeThumbs.length > 0) {
      console.log(`[${targetAccount.name}] Phase 2b: Upgrading ${upgradeThumbs.length} cached thumbnails...`);
      for (let i = 0; i < upgradeThumbs.length; i += DISCOVERY_BATCH_SIZE) {
        if (isOverBudget(invocationStart)) {
          console.log(`Budget reached during upgrade at ${i}/${upgradeThumbs.length}`);
          budgetExceeded = true;
          break;
        }
        const batch = upgradeThumbs.slice(i, i + DISCOVERY_BATCH_SIZE);
        for (const c of batch) {
          if (isOverBudget(invocationStart)) continue;
          const freshResult = await discoverImageUrl(c.ad_id, c.account_id, META_ACCESS_TOKEN, FETCH_TIMEOUT_MS);
          if (!freshResult || !freshResult.fullResUrl) continue;
          const newUrl = freshResult.fullResUrl;
          const storageUrl = await downloadAndCache(supabase, THUMB_BUCKET, c.account_id, c.ad_id, newUrl, "image");
          if (storageUrl) {
            await supabase.from("creatives").update({
              thumbnail_url: storageUrl,
              full_res_url: storageUrl,
              thumbnail_storage_path: `${c.account_id}/${c.ad_id}`,
            }).eq("ad_id", c.ad_id);
            thumbUpgraded++;
          }
        }
      }
      if (thumbUpgraded > 0) {
        console.log(`[${targetAccount.name}] Upgraded ${thumbUpgraded}/${upgradeThumbs.length} thumbnails to higher resolution`);
      }
    }

    // ── Phase 3: Preview URLs ──────────────────────────────────────
    if (logId) await updateLog(supabase, logId, { current_phase: 3 });
    let previewsFetched = 0;
    if (!budgetExceeded && previews.length > 0) {
      console.log(`[${targetAccount.name}] Phase 3: Fetching preview_url for ${previews.length} ads...`);
      for (let i = 0; i < previews.length; i++) {
        if (isOverBudget(invocationStart)) { budgetExceeded = true; break; }
        const c = previews[i];
        const previewUrl = await discoverPreviewUrl(c.ad_id, META_ACCESS_TOKEN, FETCH_TIMEOUT_MS);
        if (previewUrl) {
          await supabase.from("creatives").update({ preview_url: previewUrl }).eq("ad_id", c.ad_id);
          previewsFetched++;
        }
        if (i > 0 && i % 25 === 0 && logId) {
          await updateLog(supabase, logId, {});
        }
      }
      console.log(`  Preview URLs fetched: ${previewsFetched}/${previews.length}`);
    }

    // ── Phase 4: Videos ──────────────────────────────────────
    if (logId) await updateLog(supabase, logId, { current_phase: 4 });

    let videosFetched = 0, videosMarkedNA = 0;
    if (!budgetExceeded) {
      for (let i = 0; i < noVideos.length; i += DISCOVERY_BATCH_SIZE) {
        if (isOverBudget(invocationStart)) { budgetExceeded = true; break; }
        const batch = noVideos.slice(i, i + DISCOVERY_BATCH_SIZE);
        for (const c of batch) {
          if (isOverBudget(invocationStart)) continue;
          const freshUrl = await discoverVideoUrl(c.ad_id, META_ACCESS_TOKEN, FETCH_TIMEOUT_MS);
          if (!freshUrl) {
            await supabase.from("creatives").update({ video_url: NO_VIDEO_SENTINEL }).eq("ad_id", c.ad_id);
            videosMarkedNA++;
          } else {
            const storageUrl = await downloadAndCache(supabase, VIDEO_BUCKET, c.account_id, c.ad_id, freshUrl, "video");
            if (storageUrl) {
              await supabase.from("creatives").update({ video_url: storageUrl }).eq("ad_id", c.ad_id);
            } else {
              await supabase.from("creatives").update({ video_url: freshUrl }).eq("ad_id", c.ad_id);
            }
            videosFetched++;
          }
        }

        if (logId) {
          await updateLog(supabase, logId, { videos_cached: videosFetched, videos_failed: videosMarkedNA });
        }

        if (isOverBudget(invocationStart)) {
          console.log(`Time budget reached during video discovery. Processed ${videosFetched + videosMarkedNA}/${noVideos.length}`);
          budgetExceeded = true;
          break;
        }
      }
    }

    // FIX: uncachedVideos already have valid URLs — download directly, don't re-discover via Meta API
    let videoCached = 0, videoFailed = 0;
    if (!budgetExceeded) {
      for (let i = 0; i < videos.length; i += VIDEO_BATCH_SIZE) {
        if (isOverBudget(invocationStart)) { budgetExceeded = true; break; }
        const batch = videos.slice(i, i + VIDEO_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (c: any) => {
            if (isOverBudget(invocationStart)) return false;
            // Use existing video_url directly — no need to re-discover
            const storageUrl = await downloadAndCache(supabase, VIDEO_BUCKET, c.account_id, c.ad_id, c.video_url, "video");
            if (storageUrl) {
              await supabase.from("creatives").update({ video_url: storageUrl }).eq("ad_id", c.ad_id);
              return true;
            }
            return false;
          })
        );
        videoCached += results.filter((r: any) => r.status === "fulfilled" && r.value).length;
        videoFailed += results.filter((r: any) => r.status === "rejected" || (r.status === "fulfilled" && !r.value)).length;

        if (logId) {
          await updateLog(supabase, logId, {
            videos_cached: videosFetched + videoCached,
            videos_failed: videosMarkedNA + videoFailed,
          });
        }

        if (isOverBudget(invocationStart)) {
          console.log(`Time budget reached during video caching. Processed ${videoCached + videoFailed}/${videos.length}`);
          budgetExceeded = true;
          break;
        }
        if (i + VIDEO_BATCH_SIZE < videos.length) await new Promise(r => setTimeout(r, 500));
      }
    }

    const totalVideosCached = videosFetched + videoCached;
    const totalVideosFailed = videosMarkedNA + videoFailed;
    const durationMs = Date.now() - invocationStart;

    // Finalize log — FIX: current_phase: 4 (was 3)
    if (logId) {
      await updateLog(supabase, logId, {
        status: "completed",
        current_phase: 4,
        thumbs_cached: thumbCached,
        thumbs_failed: thumbFailed,
        videos_cached: totalVideosCached,
        videos_failed: totalVideosFailed,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      });
    }

    const thumbsRemaining = allThumbWork.length - (thumbCached + thumbFailed);
    const videosRemaining = (noVideos.length + videos.length) - (totalVideosCached + totalVideosFailed);

    // Only update last_media_sync when this account is fully done (no remaining work)
    // This ensures the account stays at the front of the queue until complete
    if (thumbsRemaining <= 0 && videosRemaining <= 0) {
      try {
        await supabase
          .from("ad_accounts")
          .update({ last_media_sync: new Date().toISOString() })
          .eq("id", resolvedAccountId);
        console.log(`[${targetAccount.name}] Fully complete — updated last_media_sync`);
      } catch (e) {
        console.log(`Note: could not update last_media_sync: ${e}`);
      }
    } else {
      console.log(`[${targetAccount.name}] ${thumbsRemaining} thumbs + ${videosRemaining} videos remaining — staying in queue`);
    }

    console.log(
      `[${targetAccount.name}] Done — ` +
      `Thumbs: ${thumbCached} cached, ${thumbFailed} failed, ${thumbUpgraded} upgraded, ${thumbsRemaining} remaining | ` +
      `Videos fetched: ${videosFetched}, cached: ${videoCached}, failed: ${videoFailed}, ${videosRemaining} remaining | ` +
      `Previews: ${previewsFetched}/${previews.length} | ` +
      `Budget exceeded: ${budgetExceeded}`
    );

    if (nextAccount) {
      console.log(`Next account in rotation: ${nextAccount.name} (${nextAccount.id})`);
    }

    return new Response(JSON.stringify({
      account: { id: resolvedAccountId, name: targetAccount.name },
      thumbnails: {
        cached: thumbCached,
        failed: thumbFailed,
        total: allThumbWork.length,
        fastPath: fastPathThumbs.length,
        slowPath: slowPathThumbs.length,
        remaining: thumbsRemaining,
      },
      videos: {
        fetched: videosFetched,
        markedNA: videosMarkedNA,
        cached: videoCached,
        failed: videoFailed,
        total: videos.length + noVideos.length,
        remaining: videosRemaining,
      },
      previews: { fetched: previewsFetched, total: previews.length },
      budgetExceeded,
      next_account: nextAccount
        ? { id: nextAccount.id, name: nextAccount.name, last_media_sync: nextAccount.last_media_sync }
        : null,
      cooldown_hours: MEDIA_REFRESH_COOLDOWN_HOURS,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Refresh media error:", e);
    try {
      const { data: runningLogs } = await supabase
        .from("media_refresh_logs")
        .select("id")
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1);
      if (runningLogs?.[0]) {
        await supabase.from("media_refresh_logs").update({
          status: "failed",
          completed_at: new Date().toISOString(),
          api_errors: JSON.stringify([String(e)]),
        }).eq("id", runningLogs[0].id);
      }
    } catch { /* best effort */ }
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
