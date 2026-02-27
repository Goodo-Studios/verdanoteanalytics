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
const TIME_BUDGET_MS = 120_000; // 2 minutes wall-clock — stay well within ~150s CPU limit
const FETCH_TIMEOUT_MS = 30_000; // 30s timeout per HTTP request

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

/** Fetch a fresh high-res image URL from Meta Graph API. */
async function getFreshImageUrl(adId: string, accountId: string): Promise<string | null> {
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
            return fullUrl;
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
            return best.uri;
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
          return picData.data.url;
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
              return postData.full_picture;
            }
          }
        }
      }
    }

    if (creative.image_url) {
      console.log(`Using image_url for ${adId}`);
      return creative.image_url;
    }

    if (spec) {
      const imageUrl = spec.link_data?.image_url || spec.photo_data?.url || spec.photo_data?.image_url;
      if (imageUrl) return imageUrl;
    }

    if (creative.thumbnail_url) {
      console.log(`Using original thumbnail_url for ${adId}`);
      return creative.thumbnail_url;
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
    if (accountFilter) console.log(`Filtering to account: ${accountFilter}`);

    // Concurrency guard: skip if another refresh is already running
    const { data: runningLogs } = await supabase
      .from("media_refresh_logs")
      .select("id")
      .eq("status", "running")
      .limit(1);
    if (runningLogs && runningLogs.length > 0) {
      console.log("Skipping: another media refresh is already running.");
      return new Response(JSON.stringify({ skipped: true, reason: "already_running" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a progress log entry
    const { data: logRow } = await supabase
      .from("media_refresh_logs")
      .insert({ account_id: accountFilter || "all", status: "running", current_phase: 1 })
      .select("id")
      .single();
    const logId = logRow?.id;

    // Phase 1: Discover work — only items that haven't been cached or marked as failed
    // Thumbnails: find creatives where thumbnail_url is NULL (never fetched)
    // OR not yet cached to storage AND not marked as "no-thumbnail" sentinel
    // FAST PATH: thumbnails that already have a CDN URL — just download & cache (no Meta API needed)
    let uncachedThumbsQuery = supabase
      .from("creatives")
      .select("ad_id, account_id, thumbnail_url")
      .not("thumbnail_url", "is", null)
      .neq("thumbnail_url", NO_THUMB_SENTINEL)
      .not("thumbnail_url", "like", `%/storage/v1/object/public/%`)
      .gt("impressions", 0);
    if (accountFilter) uncachedThumbsQuery = uncachedThumbsQuery.eq("account_id", accountFilter);
    const { data: uncachedThumbs } = await uncachedThumbsQuery
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(MAX_TOTAL);

    // SLOW PATH: thumbnails with NULL URL — need Meta API discovery
    let missingThumbsQuery = supabase
      .from("creatives")
      .select("ad_id, account_id, thumbnail_url")
      .is("thumbnail_url", null)
      .gt("impressions", 0);
    if (accountFilter) missingThumbsQuery = missingThumbsQuery.eq("account_id", accountFilter);
    const { data: missingThumbs } = await missingThumbsQuery.limit(MAX_TOTAL);

    const fastPathThumbs = uncachedThumbs || [];
    const slowPathThumbs = missingThumbs || [];
    const allThumbWork = [...fastPathThumbs, ...slowPathThumbs].slice(0, MAX_TOTAL);

    // Videos: include null AND no-video sentinel rows (sentinels get a fresh attempt every refresh)
    let missingVideosQuery = supabase
      .from("creatives")
      .select("ad_id, account_id")
      .or(`video_url.is.null,video_url.eq.${NO_VIDEO_SENTINEL}`)
      .gt("video_views", 0)
      .gt("impressions", 0);
    if (accountFilter) missingVideosQuery = missingVideosQuery.eq("account_id", accountFilter);
    const { data: missingVideos } = await missingVideosQuery
      .order("spend", { ascending: false, nullsFirst: false })
      .limit(2000);

    let uncachedVideosQuery = supabase
      .from("creatives")
      .select("ad_id, account_id, video_url")
      .not("video_url", "is", null)
      .not("video_url", "like", `%/storage/v1/object/public/%`)
      .neq("video_url", NO_VIDEO_SENTINEL)
      .gt("impressions", 0);
    if (accountFilter) uncachedVideosQuery = uncachedVideosQuery.eq("account_id", accountFilter);
    const { data: uncachedVideos } = await uncachedVideosQuery.limit(2000);

    // Find ads missing preview_url (for iframe embeds)
    let missingPreviewQuery = supabase
      .from("creatives")
      .select("ad_id")
      .is("preview_url", null)
      .gt("impressions", 0);
    if (accountFilter) missingPreviewQuery = missingPreviewQuery.eq("account_id", accountFilter);
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

    if (thumbsTotal === 0 && videosTotal === 0) {
      console.log("All media already cached.");
      if (logId) {
        await updateLog(supabase, logId, {
          status: "completed",
          current_phase: 3,
          completed_at: new Date().toISOString(),
        });
      }
      return new Response(JSON.stringify({ thumbnails: { cached: 0, failed: 0, total: 0 }, videos: { cached: 0, failed: 0, total: 0 } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${fastPathThumbs.length} thumbnails to cache (fast), ${slowPathThumbs.length} to discover (slow), ${noVideos.length} ads missing video_url, ${videos.length} uncached videos`);

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

    // SLOW PATH: sequential Meta API discovery for NULL thumbnails (only if budget remains)
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
          const freshUrl = await getFreshImageUrl(c.ad_id, c.account_id);
          if (!freshUrl) {
            await supabase.from("creatives").update({ thumbnail_url: NO_THUMB_SENTINEL }).eq("ad_id", c.ad_id);
            thumbFailed++;
            continue;
          }
          // Store the CDN URL for now — fast-path will cache it next run
          await supabase.from("creatives").update({ thumbnail_url: freshUrl }).eq("ad_id", c.ad_id);
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

    // Finalize log — always mark as completed (even partial) so we don't get stuck
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

    // Remaining work summary
    const thumbsRemaining = allThumbWork.length - (thumbCached + thumbFailed);
    const videosRemaining = (noVideos.length + videos.length) - (totalVideosCached + totalVideosFailed);
    const previewsRemaining = previews.length - previewsFetched;
    console.log(`Done — Thumbs: ${thumbCached} cached (${fastPathThumbs.length} fast-path, ${slowPathThumbs.length} slow-path), ${thumbFailed} failed, ${thumbsRemaining} remaining | Videos fetched: ${videosFetched}, cached: ${videoCached}, failed: ${videoFailed}, ${videosRemaining} remaining | Previews: ${previewsFetched}/${previews.length}`);
    if (budgetExceeded) {
      console.log(`⏳ Time budget reached. Next cron run will continue with remaining: ~${thumbsRemaining} thumbs, ~${videosRemaining} videos, ~${previewsRemaining} previews`);
    } else if (thumbsRemaining > 0 || videosRemaining > 0 || previewsRemaining > 0) {
      console.log(`⏳ Next cron run will continue processing: ~${thumbsRemaining} thumbs, ~${videosRemaining} videos, ~${previewsRemaining} previews`);
    } else {
      console.log(`✅ All media fully cached for this batch.`);
    }

    return new Response(JSON.stringify({
      thumbnails: { cached: thumbCached, failed: thumbFailed, total: allThumbWork.length, fastPath: fastPathThumbs.length, slowPath: slowPathThumbs.length },
      videos: { fetched: videosFetched, markedNA: videosMarkedNA, cached: videoCached, failed: videoFailed, total: videos.length + noVideos.length },
      previews: { fetched: previewsFetched, total: previews.length },
      budgetExceeded,
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
