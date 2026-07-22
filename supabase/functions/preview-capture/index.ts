// =============================================================================
// preview-capture — per-ad FREE creative capture via the preview-extraction surface.
// =============================================================================
// Given { ad_id, force? }, capture ONE creative's media WITHOUT Apify and WITHOUT a
// Meta-API media token that can read the source. Two tiers, proven in
// companies/verdanote/projects/apify-creative-capture/preview-extraction-{spike,
// yield}.md + static-coverage-check.md:
//   TIER A (video only, FREE, zero Meta quota): the public Facebook video plugin
//     (plugins/video.php) by meta_video_id → downloadable fbcdn .mp4 (~56% hit). A
//     "Video Unavailable" stub is NOT terminal — fall through to Tier B.
//   TIER B (video misses + ALL statics, metered): Graph /{ad_id}/previews →
//     preview_iframe.php → fetch with Referer + Sec-Fetch-* → parse fbcdn media
//     (video HD/SD; image highest-res; carousel frames).
// Media bytes are downloaded SERVER-SIDE IMMEDIATELY (fbcdn urls are short-lived) and
// stored byte-identically to the API tier (content-hash asset_key, ad-videos /
// ad-thumbnails buckets, media_assets upsert with capture_source='preview',
// creative_frames for carousels). The creatives row is updated sentinel-safe, and on
// success analysis_status is set 'pending' + analyzed_at cleared (the capture→analysis
// handoff; analyze-creative's claim picks up capture_status-independent pending work).
//
// Meta-quota CIRCUIT BREAKER (capture is FREE — NO budget ledger): every Graph
// response's x-app-usage / x-business-use-case-usage is parsed; Tier B PAUSES at >75%
// and STOPS at >90%, and a >=15s floor is enforced before every Graph call
// unconditionally. When the breaker trips the ad is left 'pending' (no attempt burned)
// and the response status is 'quota_paused' so the drain HALTS.
//
// SECURITY: verify_jwt=false, NO self-auth — internal only, never linked from a client
// (mirrors drain-media-queue). The server-side Meta token (env META_ACCESS_TOKEN →
// settings.meta_access_token, same as ad-preview) is NEVER printed. All branch logic
// lives in _shared/preview-capture-logic.ts (unit-tested); this is the thin I/O shell.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  assetStoragePath,
  computeContentHash,
  fetchWithTimeout,
  looksLikeHtml,
  resolveMetaToken,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";
import {
  alreadyCovered,
  buildPreviewsUrl,
  buildVideoPluginUrl,
  type CapturedAsset,
  extractIframeUrl,
  finalCaptureStatus,
  GRAPH_MIN_INTERVAL_MS,
  hasVideoIntent,
  IFRAME_HEADERS,
  isImageAd,
  isStorageOwnedUrl,
  mediaIntentSkipReason,
  parseGraphUsage,
  parseIframeMedia,
  parsePluginVideo,
  planCreativeMediaUpdate,
  PREVIEW_FORMATS,
  quotaDecision,
  type QuotaAction,
  retryDecision,
  shouldAttemptTierB,
} from "../_shared/preview-capture-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";

// Desktop UA for the public plugin + iframe fetches (matches the proven harness).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Buffered download cap (mirrors cache-creative-image's API-tier path). Real Meta ad
// videos are well under this; a runaway response is bounded, not OOM'd.
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;
// Tier-A pacing between plugin fetches for the same ad's multiple video ids.
const PLUGIN_GAP_MS = 3_000;

// deno-lint-ignore no-explicit-any
type Supa = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Download media bytes SERVER-SIDE and store them byte-identically to an API asset:
 * SHA-256 content-hash asset_key, asset-keyed path (<account>/assets/<hash>.<ext>),
 * media_assets upsert onConflict (account_id, asset_key). The only shape difference
 * from the API tier is capture_source='preview'. A content-hash collision with an
 * existing (meta_api) asset dedupes to that row WITHOUT changing its provenance.
 * Returns the owned public url + media_assets id, or null on any guard failure.
 */
async function downloadAndStore(
  supabase: Supa,
  bucket: string,
  accountId: string,
  adId: string,
  url: string,
  type: "image" | "video",
): Promise<CapturedAsset | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (type === "image" && bytes.byteLength < 2000) return null; // too small to be a real image
    if (type === "video" && bytes.byteLength > MAX_VIDEO_SIZE) {
      console.warn(`[${adId}] preview video exceeds ${MAX_VIDEO_SIZE} bytes — not stored`);
      return null;
    }
    const contentType =
      res.headers.get("content-type") || (type === "video" ? "video/mp4" : "image/jpeg");
    if (!isMediaContentType(contentType, type)) {
      console.log(`[${adId}] refusing to store ${type}: non-${type} content (${contentType})`);
      return null;
    }
    if (looksLikeHtml(bytes)) {
      console.log(`[${adId}] refusing to store ${type}: HTML page bytes (${contentType})`);
      return null;
    }

    // Within-account content-hash dedupe key — identical to the API tier.
    const assetKey = await computeContentHash(buffer);
    const { data: existing } = await supabase
      .from("media_assets")
      .select("id, public_url")
      .eq("account_id", accountId)
      .eq("asset_key", assetKey)
      .maybeSingle();
    if (existing?.id && existing?.public_url) {
      // Byte-identical asset already stored (possibly by meta_api) — reuse it and
      // preserve its provenance. No second copy, no capture_source overwrite.
      return { publicUrl: existing.public_url, assetId: existing.id };
    }

    const ext = type === "video"
      ? (contentType.includes("webm") ? "webm" : "mp4")
      : contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";
    const path = assetStoragePath(accountId, assetKey, ext);
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) {
      console.error(`[${adId}] ${type} storage upload error:`, upErr.message);
      return null;
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

    const { data: upserted } = await supabase
      .from("media_assets")
      .upsert(
        {
          account_id: accountId,
          asset_key: assetKey,
          media_type: type,
          bucket,
          storage_path: path,
          public_url: publicUrl,
          byte_size: bytes.byteLength,
          content_type: contentType,
          capture_source: "preview", // provenance — the only shape difference
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,asset_key" },
      )
      .select("id, public_url")
      .maybeSingle();

    return { publicUrl: upserted?.public_url ?? publicUrl, assetId: upserted?.id ?? "" };
  } catch (e) {
    console.error(`[${adId}] downloadAndStore ${type} error:`, e);
    return null;
  }
}

/**
 * Link pending carousel-frame IMAGE assets to the parsed iframe images, in
 * frame_index order (the static-coverage run confirmed the frame count matches
 * expected_frame_count). Only pending image frames (asset_id NULL, media_type !=
 * 'video') are linked. Returns the number newly linked.
 */
async function backfillCarouselFrames(
  supabase: Supa,
  adId: string,
  accountId: string,
  imageUrls: string[],
): Promise<number> {
  const { data: frameRows } = await supabase
    .from("creative_frames")
    .select("frame_index, media_type, asset_id")
    .eq("ad_id", adId);
  // deno-lint-ignore no-explicit-any
  const pending = (frameRows ?? [])
    .filter((f: any) => f.asset_id == null && f.media_type !== "video")
    // deno-lint-ignore no-explicit-any
    .sort((a: any, b: any) => a.frame_index - b.frame_index);
  if (pending.length === 0) return 0;

  let linked = 0;
  let imgIdx = 0;
  for (const row of pending) {
    const imgUrl = imageUrls[imgIdx++];
    if (!imgUrl) break;
    const asset = await downloadAndStore(
      supabase, THUMB_BUCKET, accountId, `${adId}#frame${row.frame_index}`, imgUrl, "image",
    );
    if (asset?.assetId) {
      await supabase
        .from("creative_frames")
        .update({ asset_id: asset.assetId, updated_at: new Date().toISOString() })
        .eq("ad_id", adId)
        .eq("frame_index", row.frame_index);
      linked++;
    }
  }
  return linked;
}

interface QuotaState {
  peak: number;
  graphCalls: number;
}

/**
 * Resolve the preview_iframe.php URL via Graph /{ad_id}/previews, honoring the quota
 * circuit breaker and the >=15s inter-Graph-call floor. Parses x-app-usage /
 * x-business-use-case-usage on EVERY response into state.peak. Returns the iframe url
 * (+ format), or a halt when the breaker trips. NEVER prints the token.
 */
async function resolveIframe(
  adId: string,
  token: string,
  state: QuotaState,
): Promise<{ iframeUrl: string | null; format?: string; halt?: QuotaAction }> {
  for (const fmt of PREVIEW_FORMATS) {
    const action = quotaDecision(state.peak);
    if (action !== "ok") return { iframeUrl: null, halt: action };

    // Unconditional >=15s floor BEFORE every Graph call (across formats AND, because
    // the drain runs preview-capture sequentially and awaits each, across ads too).
    await sleep(GRAPH_MIN_INTERVAL_MS);

    let res: Response;
    try {
      res = await fetchWithTimeout(buildPreviewsUrl(adId, fmt, token), 30_000);
    } catch (e) {
      console.warn(`[${adId}] previews fetch error (${fmt}):`, (e as Error).message);
      continue;
    }
    state.graphCalls++;
    const usage = parseGraphUsage({
      appUsage: res.headers.get("x-app-usage"),
      businessUseCase: res.headers.get("x-business-use-case-usage"),
    });
    if (usage > state.peak) state.peak = usage;

    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      const bodyStr = (j?.data?.[0]?.body as string | undefined) ?? JSON.stringify(j);
      const iframeUrl = extractIframeUrl(bodyStr);
      if (iframeUrl) return { iframeUrl, format: fmt };
    } else {
      await res.text().catch(() => {});
    }
  }
  return { iframeUrl: null };
}

export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const isClient = (o: unknown): boolean =>
    !!o && typeof (o as { from?: unknown }).from === "function";
  const supabase: Supa = isClient(supabaseOverride)
    ? supabaseOverride
    : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // -- Parse body -----------------------------------------------------------
  let adId: string;
  let force = false;
  // tier_a_only: the drain sets this for the remainder of a batch after the Meta-quota
  // breaker tripped — run only the FREE Tier A (public video plugin, zero Meta quota)
  // and skip the metered Tier B. Nothing landed via Tier A → treated as a quota
  // deferral (attempt reverted, row left pending), never a burned attempt.
  let tierAOnly = false;
  try {
    const body = await req.json();
    adId = String(body?.ad_id ?? "");
    force = body?.force === true;
    tierAOnly = body?.tier_a_only === true;
    if (!adId) throw new Error("ad_id required");
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || "bad request" }, 400);
  }

  // -- Load creative --------------------------------------------------------
  const { data: creative, error: fetchErr } = await supabase
    .from("creatives")
    .select(
      "ad_id, account_id, video_url, full_res_url, thumbnail_url, image_quality, " +
        "meta_video_ids, meta_image_hashes, expected_frame_count, " +
        "capture_status, capture_attempts, capture_last_attempt_at",
    )
    .eq("ad_id", adId)
    .maybeSingle();
  if (fetchErr || !creative) {
    return jsonResponse({ ad_id: adId, status: "error", reason: "creative_not_found" }, 404);
  }
  const accountId: string = creative.account_id;

  // -- Already-covered gate (unless force) ----------------------------------
  if (!force && alreadyCovered(creative)) {
    return jsonResponse({ ad_id: adId, status: "skipped", reason: "already_covered" });
  }

  // -- Media-intent gate (NO archive-id gate — ad-scoped by construction) ---
  const intentSkip = mediaIntentSkipReason(creative);
  if (intentSkip) {
    await supabase.from("creatives")
      .update({ capture_status: "skipped" })
      .eq("ad_id", adId).eq("account_id", accountId);
    return jsonResponse({ ad_id: adId, status: "skipped", reason: intentSkip });
  }

  // -- Retry / backoff / terminal gate --------------------------------------
  const now = Date.now();
  const retry = retryDecision({
    attempts: creative.capture_attempts ?? 0,
    lastAttemptAt: creative.capture_last_attempt_at,
    now,
    force,
  });
  if (retry.action === "terminal") {
    await supabase.from("creatives")
      .update({ capture_status: "failed" })
      .eq("ad_id", adId).eq("account_id", accountId);
    return jsonResponse({ ad_id: adId, status: "skipped", reason: "max_attempts_exceeded" });
  }
  if (retry.action === "backoff") {
    return jsonResponse({
      ad_id: adId, status: "skipped", reason: "backoff",
      next_eligible_at: retry.nextEligibleAt ? new Date(retry.nextEligibleAt).toISOString() : null,
    });
  }

  // -- Record the attempt BEFORE working (a mid-run crash still burns an attempt so
  //    backoff is enforced by capture_last_attempt_at). ---------------------
  const attemptsAfter = (creative.capture_attempts ?? 0) + 1;
  await supabase.from("creatives")
    .update({
      capture_status: "pending",
      capture_attempts: attemptsAfter,
      capture_last_attempt_at: new Date(now).toISOString(),
    })
    .eq("ad_id", adId).eq("account_id", accountId);

  const wantsVideo = hasVideoIntent(creative);
  const wantsStatics = isImageAd(creative);
  const expectedFrames = Number(creative.expected_frame_count ?? 0);
  const isCarousel = wantsStatics && expectedFrames > 1;

  let videoAsset: CapturedAsset | null = null;
  let imageAsset: CapturedAsset | null = null;
  let framesLinked = 0;
  const quota: QuotaState = { peak: 0, graphCalls: 0 };
  let quotaHalt = false;

  // -- TIER A: public video plugin (FREE, zero Meta quota) ------------------
  if (wantsVideo) {
    const videoIds: string[] = (creative.meta_video_ids as string[]) ?? [];
    for (let i = 0; i < videoIds.length; i++) {
      if (i > 0) await sleep(PLUGIN_GAP_MS); // pacing between plugin fetches
      const vid = String(videoIds[i]);
      try {
        const res = await fetch(buildVideoPluginUrl(vid), { headers: { "User-Agent": UA } });
        const html = await res.text();
        const parsed = parsePluginVideo(html);
        if (parsed.url) {
          videoAsset = await downloadAndStore(supabase, VIDEO_BUCKET, accountId, adId, parsed.url, "video");
          if (!videoAsset && parsed.candidates[1]) {
            videoAsset = await downloadAndStore(supabase, VIDEO_BUCKET, accountId, adId, parsed.candidates[1], "video");
          }
          if (videoAsset) break;
        }
        // A "Video Unavailable" stub is NOT terminal — fall through to Tier B.
      } catch (e) {
        console.warn(`[${adId}] Tier-A plugin fetch error (vid ${vid}):`, (e as Error).message);
      }
    }
  }

  // -- TIER B: previews edge → iframe (video misses + ALL statics, metered) -
  // Skipped entirely under tier_a_only (quota degrade) — see shouldAttemptTierB. When
  // skipped-but-needed, mark a quota deferral so the attempt is reverted below (the
  // free Tier A already ran; Tier B waits for quota to recover).
  const needVideoB = wantsVideo && !videoAsset;
  const needStaticsB = wantsStatics && !isStorageOwnedUrl(creative.full_res_url);
  if (tierAOnly && (needVideoB || needStaticsB)) {
    quotaHalt = true;
  }
  if (shouldAttemptTierB({ needVideoB, needStaticsB, tierAOnly })) {
    let token = resolveMetaToken(Deno.env.get("META_ACCESS_TOKEN"), null);
    if (!token) {
      const { data } = await supabase.from("settings").select("value").eq("key", "meta_access_token").maybeSingle();
      token = resolveMetaToken(Deno.env.get("META_ACCESS_TOKEN"), data?.value as string | undefined);
    }
    if (!token) {
      // Cannot run Tier B without a token — leave pending (retryable), never a sentinel.
      await supabase.from("creatives").update({ capture_status: "pending" })
        .eq("ad_id", adId).eq("account_id", accountId);
      return jsonResponse({ ad_id: adId, status: "failed", reason: "no_token" }, 500);
    }

    const { iframeUrl, halt } = await resolveIframe(adId, token, quota);
    if (halt) {
      quotaHalt = true;
    } else if (iframeUrl) {
      let iframeHtml = "";
      let iframeStatus = 0;
      try {
        const ires = await fetch(iframeUrl, { headers: { ...IFRAME_HEADERS, "User-Agent": UA } });
        iframeStatus = ires.status;
        iframeHtml = await ires.text();
      } catch (e) {
        console.warn(`[${adId}] Tier-B iframe fetch error:`, (e as Error).message);
      }
      // HTTP 400 = the mechanism-drift signal (required headers changed) — recorded in
      // logs; the health check's iframe-400 drift alarm reads capture_events when present.
      if (iframeStatus === 400) {
        console.warn(`[${adId}] Tier-B iframe HTTP 400 — required headers may have changed`);
      }
      if (iframeHtml && iframeStatus !== 400) {
        const media = parseIframeMedia(iframeHtml);
        if (needVideoB && media.video) {
          videoAsset = await downloadAndStore(supabase, VIDEO_BUCKET, accountId, adId, media.video, "video");
          if (!videoAsset && media.videoCandidates[1]) {
            videoAsset = await downloadAndStore(supabase, VIDEO_BUCKET, accountId, adId, media.videoCandidates[1], "video");
          }
        }
        if (needStaticsB && media.images.length > 0) {
          if (isCarousel) {
            framesLinked = await backfillCarouselFrames(supabase, adId, accountId, media.images);
            // Primary image = the highest-res frame (headline) for the modal.
            imageAsset = await downloadAndStore(supabase, THUMB_BUCKET, accountId, adId, media.images[0], "image");
          } else {
            imageAsset = await downloadAndStore(supabase, THUMB_BUCKET, accountId, adId, media.images[0], "image");
          }
        }
      }
    }
  }

  // -- Plan the sentinel-safe creatives update ------------------------------
  const mediaUpdate = planCreativeMediaUpdate(
    { video_url: creative.video_url, full_res_url: creative.full_res_url },
    { video: videoAsset, image: imageAsset },
  );
  const landedAny = Object.keys(mediaUpdate).length > 0 || framesLinked > 0;

  // -- Quota halt with NOTHING landed: revert the attempt (never burned by a mere
  //    quota deferral, mirroring the throttle pattern) and leave the row pending. --
  if (quotaHalt && !landedAny) {
    await supabase.from("creatives")
      .update({
        capture_status: "pending",
        capture_attempts: creative.capture_attempts ?? 0,
      })
      .eq("ad_id", adId).eq("account_id", accountId);
    return jsonResponse({ ad_id: adId, status: "quota_paused", reason: "quota_paused", peak_usage: quota.peak });
  }

  const status = finalCaptureStatus({ landedAny, attempts: attemptsAfter });
  const finalUpdate: Record<string, unknown> = { ...mediaUpdate, capture_status: status.status };
  // Capture→analysis handoff: on success, (re)queue analysis. analyze-creative's
  // claim_creatives_for_analysis selects analysis_status='pending'; clearing
  // analyzed_at makes next_creative_analysis_account pick the account up.
  if (landedAny) {
    finalUpdate.analysis_status = "pending";
    finalUpdate.analyzed_at = null;
  }
  await supabase.from("creatives")
    .update(finalUpdate)
    .eq("ad_id", adId).eq("account_id", accountId);

  return jsonResponse({
    ad_id: adId,
    status: status.status,
    reason: landedAny ? undefined : "no_media",
    captured: {
      video: !!mediaUpdate.video_url,
      image: !!mediaUpdate.full_res_url,
      frames_linked: framesLinked,
    },
    attempts: attemptsAfter,
    graph_calls: quota.graphCalls,
    peak_usage: quota.peak,
    analysis_handoff: landedAny,
  });
}

// Guard the network bind so tests can import the module without serving.
if (!Deno.env.get("PREVIEW_CAPTURE_NO_SERVE")) {
  serve(handler);
}
