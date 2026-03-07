import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";
const DISCOVERY_BATCH_SIZE = 5; // Meta API discovery — sequential to avoid CPU spikes
const CACHE_BATCH_SIZE = 15; // Pure download+upload — parallelizable I/O
const VIDEO_BATCH_SIZE = 1;
const MAX_TOTAL = 5000;
const MAX_VIDEO_SIZE = 150 * 1024 * 1024; // 150MB cap
const TIME_BUDGET_MS = 110_000; // ~110s — leave 10s margin within Supabase's ~150s CPU limit
const FETCH_TIMEOUT_MS = 30_000; // 30s timeout per HTTP request

// How many hours before an account is eligible for re-refresh
// With 12+ accounts cycling every 10-15 min, each account gets refreshed every 2-3 hours
const MEDIA_REFRESH_COOLDOWN_HOURS = 2;

// Sentinel values to mark failed fetches so they're skipped on future runs
const NO_THUMB_SENTINEL = "no-thumbnail";
const NO_VIDEO_SENTINEL = "no-video";

/** Fetch with a timeout — aborts if the request takes longer than timeoutMs */
async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a fresh high-res image URL from Meta Graph API.
 * Returns { thumbnailUrl, fullResUrl } where fullResUrl is the highest-resolution
 * source available (stored separately so the modal can use it without rescaling). */
async function getFreshImageUrl(adId: string, accountId: string): Promise<{ thumbnailUrl: string; fullResUrl: string | null } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${adId}?fields=creative{thumbnail_url,image_url,image_hash,object_story_spec}&access_token=${META_ACCESS_TOKEN}`
    );
    if (!res.ok) {
      console.log(`Meta API failed for ${adId}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) return null;

    const imageHash = creative.image_hash ||
      creative.object_story_spec?.link_data?.image_hash ||
      creative.object_story_spec?.photo_data?.image_hash;
    if (imageHash) {
      const imgRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${accountId}/adimages?hashes=["${imageHash}"]&fields=url,url_128,width,height,original_width,original_height,permalink_url&access_token=${META_ACCESS_TOKEN}`
      );
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const images = imgData?.data;
        if (images && images.length > 0) {
          const img = images[0];
          const fullUrl = img.url;
          const w = img.original_width || img.width || 0;
          console.log(`image_hash for ${adId}: ${w}px wide, url length: ${fullUrl?.length}`);
          if (fullUrl && fullUrl.length > 100) {
            // img.url from adimages is already full-resolution — store it as both thumbnail and full_res_url
            return { thumbnailUrl: fullUrl, fullResUrl: fullUrl };
          }
        }
      }
    }

    const spec = creative.object_story_spec;
    const videoId = spec?.video_data?.video_id || spec?.template_data?.video_data?.video_id;
    if (videoId) {
      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${videoId}?fields=thumbnails{uri,width,height}&access_token=${META_ACCESS_TOKEN}`
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        const thumbs = vidData?.thumbnails?.data;
        if (thumbs && thumbs.length > 0) {
          const sorted = thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
          const best = sorted[0];
          if (best?.uri && (best.width || 0) >= 200) {
            console.log(`Video thumbnail for ${adId}: ${best.width}x${best.height}`);
            return { thumbnailUrl: best.uri, fullResUrl: null };
          }
        }
      }
      const picRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${videoId}/picture?redirect=false&width=1080&height=1080&access_token=${META_ACCESS_TOKEN}`
      );
      if (picRes.ok) {
        const picData = await picRes.json();
        if (picData?.data?.url) {
          console.log(`Video picture fallback (1080px) for ${adId}`);
          // 1080px video poster — use as both thumbnail and full_res_url
          return { thumbnailUrl: picData.data.url, fullResUrl: picData.data.url };
        }
      }
    }

    if (creative.id) {
      const creativeRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${creative.id}?fields=effective_object_story_id,image_url&access_token=${META_ACCESS_TOKEN}`
      );
      if (creativeRes.ok) {
        const creativeData = await creativeRes.json();
        if (creativeData.effective_object_story_id) {
          const postRes = await fetchWithTimeout(
            `https://graph.facebook.com/v21.0/${creativeData.effective_object_story_id}?fields=full_picture&access_token=${META_ACCESS_TOKEN}`
          );
          if (postRes.ok) {
            const postData = await postRes.json();
            if (postData.full_picture) {
              console.log(`Post full_picture for ${adId}`);
              return { thumbnailUrl: postData.full_picture, fullResUrl: null };
            }
          }
        }
      }
    }

    if (creative.image_url) {
      console.log(`Using image_url for ${adId}`);
      return { thumbnailUrl: creative.image_url, fullResUrl: null };
    }

    if (spec) {
      const imageUrl = spec.link_data?.image_url || spec.photo_data?.url || spec.photo_data?.image_url;
      if (imageUrl) return { thumbnailUrl: imageUrl, fullResUrl: null };
    }

    if (creative.thumbnail_url) {
      console.log(`Using original thumbnail_url for ${adId}`);
      return { thumbnailUrl: creative.thumbnail_url, fullResUrl: null };
    }

    return null;
  } catch (e) {
    console.log(`Meta API error for ${adId}:`, e);
    return null;
  }
}

/** Fetch ad preview URL from Meta Graph API for iframe embedding. */
async function getFreshPreviewUrl(adId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${adId}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${META_ACCESS_TOKEN}`
    );
    if (res.ok) {
      const data = await res.json();
      const preview = data?.data?.[0];
      if (preview?.body) {
        const match = preview.body.match(/src="([^"]+)"/);
        if (match?.[1]) {
          const decoded = match[1].replace(/&amp;/g, "&");
          return decoded;
        }
      }
    }
    const adRes = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${adId}?fields=creative{effective_object_story_id}&access_token=${META_ACCESS_TOKEN}`
    );
    if (adRes.ok) {
      const adData = await adRes.json();
      const storyId = adData?.creative?.effective_object_story_id;
      if (storyId) {
        const parts = storyId.split("_");
        if (parts.length === 2) {
          return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
        }
      }
    }
    return null;
  } catch (e) {
    console.log(`Preview URL error for ${adId}:`, e);
    return null;
  }
}

/** Fetch a fresh video source URL from Meta Graph API. */
async function getFreshVideoUrl(adId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${adId}?fields=creative{object_story_spec,video_id}&access_token=${META_ACCESS_TOKEN}`
    );
    if (!res.ok) {
      console.log(`Meta video API failed for ${adId}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const creative = data?.creative;
    if (!creative) return null;

    const spec = creative.object_story_spec;

    const videoIds: string[] = [];
    if (creative.video_id) videoIds.push(creative.video_id);
    if (spec?.video_data?.video_id) videoIds.push(spec.video_data.video_id);
    if (spec?.template_data?.video_data?.video_id) videoIds.push(spec.template_data.video_data.video_id);

    if (spec?.video_data?.video_url) {
      console.log(`Found video_url in spec for ${adId}`);
      return spec.video_data.video_url;
    }

    for (const vid of [...new Set(videoIds)]) {
      const vidRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${vid}?fields=source&access_token=${META_ACCESS_TOKEN}`
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        if (vidData?.source) {
          console.log(`Got video source from video_id ${vid} for ${adId}`);
          return vidData.source;
        }
      }
    }

    return null;
  } catch (e) {
    console.log(`Meta video API error for ${adId}:`, e);
    return null;
  }
}

async function downloadAndCache(
  supabase: any,
  bucket: string,
  accountId: string,
  adId: string,
  url: string,
  type: "image" | "video"
): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, 60_000); // 60s for large file downloads
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

/** Shared mutable start time so inner helpers can check budget */
let _invocationStart = 0;

/** Helper to check if we've exceeded our time budget */
function isOverBudget(startTime?: number): boolean {
  return Date.now() - (startTime ?? _invocationStart) > TIME_BUDGET_MS;
}

/** Helper to update the progress log row */
async function updateLog(supabase: any, logId: number, updates: Record<string, any>) {
  await supabase.from("media_refresh_logs").update(updates).eq("id", logId);
}

/**
 * Pick the single account to process this invocation.
 *
 * Strategy (in priority order):
 *   1. Explicit account_id in request — use that directly
 *   2. account_id=all (or missing) → round-robin by last_media_sync ASC NULLS FIRST
 *      among active accounts, skipping any refreshed within MEDIA_REFRESH_COOLDOWN_HOURS
 *
 * Prioritisation within the rotation: accounts with NULL last_media_sync (never refreshed)
 * come first, then accounts sorted by oldest refresh, then by total spend DESC as tiebreaker
 * so high-value accounts get refreshed more often.
 */
async function pickAccount(
  supabase: any,
  requestedAccountId: string | null
): Promise<{ account: any | null; skippedAll: boolean; nextAccount: any | null }> {
  // Explicit account requested — use it no matter what
  if (requestedAccountId && requestedAccountId !== "all") {
    const { data: account } = await supabase
      .from("ad_accounts")
      .select("id, name, total_spend, last_media_sync")
      .eq("id", requestedAccountId)
      .single();
    return { account: account || null, skippedAll: false, nextAccount: null };
  }

  // Rotation: fetch all active accounts sorted by staleness
  const { data: accounts } = await supabase
    .from("ad_accounts")
    .select("id, name, total_spend, last_media_sync")
    .eq("is_active", true)
    .order("last_media_sync", { ascending: true, nullsFirst: true })
    .order("total_spend", { ascending: false, nullsFirst: false });

  if (!accounts || accounts.length === 0) {
    return { account: null, skippedAll: true, nextAccount: null };
  }

  const cooldownMs = MEDIA_REFRESH_COOLDOWN_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  // Find the first account outside the cooldown window
  for (const acc of accounts) {
    if (!acc.last_media_sync) {
      // Never refreshed — highest priority
      const nextAcc = accounts.find((a: any) => a.id !== acc.id);
      return { account: acc, skippedAll: false, nextAccount: nextAcc || null };
    }
    const lastRefresh = new Date(acc.last_media_sync).getTime();
    if (now - lastRefresh >= cooldownMs) {
      const nextAcc = accounts.find((a: any) => a.id !== acc.id);
      return { account: acc, skippedAll: false, nextAccount: nextAcc || null };
    }
  }

  // All accounts are within cooldown — log this and skip
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

    // ── CHANGE 1: Single-account rotation ──────────────────────────────────
    // Pick ONE account to process this invocation (or use the explicit one)
    const { account: targetAccount, skippedAll, nextAccount } = await pickAccount(supabase, accountFilter);

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

    // Use the resolved single account for all queries below
    const resolvedAccountId = targetAccount.id;
    console.log(`Processing account: ${targetAccount.name} (${resolvedAccountId}) — last refresh: ${targetAccount.last_media_sync || "never"}`);

    // Concurrency guard: skip if this specific account already has a running refresh
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

    // Create a progress log entry
    const { data: logRow } = await supabase
      .from("media_refresh_logs")
      .insert({ account_id: resolvedAccountId, status: "running", current_phase: 1 })
      .select("id")
      .single();
    const logId = logRow?.id;

    // Phase 1: Discover work for this single account
    // FAST PATH: thumbnails with a real CDN URL not yet cached to storage
    const uncachedThumbsQuery = supabase
      .from("creatives")
      .select("ad_id, account_id, thumbnail_url")
      .not("thumbnail_url", "is", null)
      .neq("thumbnail_url", NO_THUMB_SENTINEL)
      .not("thumbnail_url", "like", `%/storage/v1/object/public/%`)
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0);
    const { data: uncachedThumbs } = await uncachedThumbsQuery
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(MAX_TOTAL);

    // SLOW PATH: NULL thumbnails + no-thumbnail sentinels — both need Meta API re-discovery
    const missingThumbsQuery = supabase
      .from("creatives")
      .select("ad_id, account_id, thumbnail_url")
      .or("thumbnail_url.is.null,thumbnail_url.eq.no-thumbnail")
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0);
    const { data: missingThumbs } = await missingThumbsQuery
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(MAX_TOTAL);

    const fastPathThumbs = uncachedThumbs || [];
    const slowPathThumbs = missingThumbs || [];
    const allThumbWork = [...fastPathThumbs, ...slowPathThumbs].slice(0, MAX_TOTAL);

    // Videos: include null AND no-video sentinel rows
    const missingVideosQuery = supabase
      .from("creatives")
      .select("ad_id, account_id")
      .or("video_url.is.null,video_url.eq.no-video")
      .eq("account_id", resolvedAccountId)
      .gt("video_views", 0)
      .gt("impressions", 0);
    const { data: missingVideos } = await missingVideosQuery
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(2000);

    const uncachedVideosQuery = supabase
      .from("creatives")
      .select("ad_id, account_id, video_url")
      .not("video_url", "is", null)
      .not("video_url", "like", `%/storage/v1/object/public/%`)
      .neq("video_url", NO_VIDEO_SENTINEL)
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0);
    const { data: uncachedVideos } = await uncachedVideosQuery.limit(2000);

    // Find ads missing preview_url
    const missingPreviewQuery = supabase
      .from("creatives")
      .select("ad_id")
      .is("preview_url", null)
      .eq("account_id", resolvedAccountId)
      .gt("impressions", 0);
    const { data: missingPreviews } = await missingPreviewQuery.limit(MAX_TOTAL);

    const thumbs = allThumbWork;
    const noVideos = missingVideos || [];
    const videos = uncachedVideos || [];
    const previews = missingPreviews || [];

    const thumbsTotal = thumbs.length;
    const videosTotal = noVideos.length + videos.length;

    // Update log with totals
    if (logId) {
      await updateLog(supabase, logId, {
        current_phase: 1,
        thumbs_total: thumbsTotal,
        videos_total: videosTotal,
      });
    }

    console.log(`[${targetAccount.name}] Discovery: fastThumbs=${fastPathThumbs.length} slowThumbs=${slowPathThumbs.length} missingVideos=${noVideos.length} uncachedVideos=${videos.length} previews=${previews.length}`);

    if (thumbsTotal === 0 && videosTotal === 0) {
      console.log(`[${targetAccount.name}] All media already cached — marking complete.`);
      if (logId) {
        await updateLog(supabase, logId, {
          status: "completed",
          current_phase: 3,
          completed_at: new Date().toISOString(),
        });
      }
      // Still update last_media_sync so rotation moves to next account
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

    // Phase 2: Process thumbnails
    if (logId) await updateLog(supabase, logId, { current_phase: 2 });
    const invocationStart = Date.now();
    _invocationStart = invocationStart;
    let budgetExceeded = false;

    let thumbCached = 0, thumbFailed = 0;

    // FAST PATH: parallel download+upload for thumbnails that already have CDN URLs
    for (let i = 0; i < fastPathThumbs.length; i += CACHE_BATCH_SIZE) {
      if (isOverBudget()) {
        console.log(`Budget reached during fast-path at ${i}/${fastPathThumbs.length}. Cached: ${thumbCached}`);
        budgetExceeded = true;
        break;
      }
      const batch = fastPathThumbs.slice(i, i + CACHE_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (c: any) => {
          if (isOverBudget()) return false;
          const storageUrl = await downloadAndCache(supabase, THUMB_BUCKET, c.account_id, c.ad_id, c.thumbnail_url, "image");
          if (storageUrl) {
            await supabase.from("creatives").update({ thumbnail_url: storageUrl }).eq("ad_id", c.ad_id);
            return true;
          } else {
            // CDN URL expired or bad — mark as sentinel
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

    // SLOW PATH: sequential Meta API discovery for NULL thumbnails
    if (!budgetExceeded) {
      for (let i = 0; i < slowPathThumbs.length; i += DISCOVERY_BATCH_SIZE) {
        if (isOverBudget()) {
          console.log(`Budget reached during slow-path at ${i}/${slowPathThumbs.length}`);
          budgetExceeded = true;
          break;
        }
        const batch = slowPathThumbs.slice(i, i + DISCOVERY_BATCH_SIZE);
        for (const c of batch) {
          if (isOverBudget()) continue;
          const freshResult = await getFreshImageUrl(c.ad_id, c.account_id);
          if (!freshResult) {
            await supabase.from("creatives").update({ thumbnail_url: NO_THUMB_SENTINEL }).eq("ad_id", c.ad_id);
            thumbFailed++;
            continue;
          }
          // Store the CDN URL for now — fast-path will cache it next run.
          // Also persist full_res_url when available so the modal can serve the hi-res version.
          const updatePayload: Record<string, string | null> = { thumbnail_url: freshResult.thumbnailUrl };
          if (freshResult.fullResUrl) updatePayload.full_res_url = freshResult.fullResUrl;
          await supabase.from("creatives").update(updatePayload).eq("ad_id", c.ad_id);
          thumbCached++;
        }
      }
    }

    // Phase 3: Process videos (only if we have budget remaining)
    if (logId) await updateLog(supabase, logId, { current_phase: 3 });

    let videosFetched = 0, videosMarkedNA = 0;
    if (!budgetExceeded) {
      for (let i = 0; i < noVideos.length; i += DISCOVERY_BATCH_SIZE) {
        if (isOverBudget()) { budgetExceeded = true; break; }
        const batch = noVideos.slice(i, i + DISCOVERY_BATCH_SIZE);
        for (const c of batch) {
          if (isOverBudget()) continue;
          const freshUrl = await getFreshVideoUrl(c.ad_id);
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

        if (isOverBudget()) {
          console.log(`Time budget reached during video discovery. Processed ${videosFetched + videosMarkedNA}/${noVideos.length}`);
          budgetExceeded = true;
          break;
        }
      }
    }

    let videoCached = 0, videoFailed = 0;
    if (!budgetExceeded) {
      for (let i = 0; i < videos.length; i += VIDEO_BATCH_SIZE) {
        if (isOverBudget()) { budgetExceeded = true; break; }
        const batch = videos.slice(i, i + VIDEO_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (c: any) => {
            if (isOverBudget()) return false;
            const freshUrl = await getFreshVideoUrl(c.ad_id);
            if (!freshUrl) { return false; }
            const storageUrl = await downloadAndCache(supabase, VIDEO_BUCKET, c.account_id, c.ad_id, freshUrl, "video");
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

        if (isOverBudget()) {
          console.log(`Time budget reached during video caching. Processed ${videoCached + videoFailed}/${videos.length}`);
          budgetExceeded = true;
          break;
        }
        if (i + VIDEO_BATCH_SIZE < videos.length) await new Promise(r => setTimeout(r, 500));
      }
    }

    const totalVideosCached = videosFetched + videoCached;
    const totalVideosFailed = videosMarkedNA + videoFailed;

    // Phase 4: Backfill preview_url for iframe embeds (only if budget remains)
    let previewsFetched = 0;
    if (!budgetExceeded && previews.length > 0) {
      console.log(`Phase 4: Fetching preview_url for ${previews.length} ads...`);
      for (let i = 0; i < previews.length; i++) {
        if (isOverBudget()) { budgetExceeded = true; break; }
        const c = previews[i];
        const previewUrl = await getFreshPreviewUrl(c.ad_id);
        if (previewUrl) {
          await supabase.from("creatives").update({ preview_url: previewUrl }).eq("ad_id", c.ad_id);
          previewsFetched++;
        }
      }
      console.log(`  Preview URLs fetched: ${previewsFetched}/${previews.length}`);
    }

    const durationMs = Date.now() - invocationStart;

    // Finalize log
    if (logId) {
      await updateLog(supabase, logId, {
        status: "completed",
        current_phase: 3,
        thumbs_cached: thumbCached,
        thumbs_failed: thumbFailed,
        videos_cached: totalVideosCached,
        videos_failed: totalVideosFailed,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      });
    }

    // ── CHANGE 1: Update last_media_sync for this account ─────────────────
    // Always update even if budget was exceeded — we did process this account
    await supabase
      .from("ad_accounts")
      .update({ last_media_sync: new Date().toISOString() })
      .eq("id", resolvedAccountId);

    // Remaining work summary
    const thumbsRemaining = allThumbWork.length - (thumbCached + thumbFailed);
    const videosRemaining = (noVideos.length + videos.length) - (totalVideosCached + totalVideosFailed);
    const previewsRemaining = previews.length - previewsFetched;

    console.log(
      `[${targetAccount.name}] Done — ` +
      `Thumbs: ${thumbCached} cached, ${thumbFailed} failed, ${thumbsRemaining} remaining | ` +
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
      // Rotation info for observability
      next_account: nextAccount
        ? { id: nextAccount.id, name: nextAccount.name, last_media_sync: nextAccount.last_media_sync }
        : null,
      cooldown_hours: MEDIA_REFRESH_COOLDOWN_HOURS,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Refresh media error:", e);
    // Try to mark any running log as failed
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
