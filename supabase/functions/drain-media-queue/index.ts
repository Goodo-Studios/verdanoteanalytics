// US-010: In-stack video download queue worker (kill the OOM/stuck churn).
//
// WHY: heavy video downloads used to be driven by blind-fanout crons that poked
// enrich-thumbnails (scope=cache) against every account every 2-3 minutes. A single
// worker buffering a large video would OOM (WORKER_RESOURCE_LIMIT), die mid-flight,
// and leave a `media_refresh_logs` row stuck in 'running' — which then blocked that
// account's whole media pipeline until a separate cleanup-stuck-media cron released
// it. That churn (blind scans + OOM deaths + stuck-log cleanup) is the recurring
// jam this story removes.
//
// WHAT: a queue-backed, self-chaining worker that stays entirely within Supabase.
// It drains public.media_cache_queue (populated by sync, US-008, with ONLY newly
// inserted ads) one small batch at a time:
//   1. Atomically CLAIM a batch of pending rows via the claim_media_cache_queue RPC
//      (FOR UPDATE SKIP LOCKED) so two concurrent invocations never grab the same ad.
//   2. For each claimed ad, DISCOVER its media CDN url (short-circuiting if already
//      cached to storage), then STREAM the download straight to storage — the same
//      streaming upload + 200MB cap + oversized→keep-CDN handling proven in
//      enrich-thumbnails. Within-account dedupe (US-009) is preserved: bytes are
//      hashed and a second ad reusing the identical creative reuses the stored asset.
//   3. Mark each row done/failed and, while any pending rows remain (and within the
//      wall/self-chain budget), fire a FRESH invocation of THIS worker (a new worker
//      with fresh memory) so an account of any size drains fully without OOM.
//
// SELF-CHAINING CONTRACT (per verdanoteanalytics-self-chaining-fire-selfcontinue-
// unconditionally): the drain chains a fresh invocation whenever pending rows remain,
// not gated on the current batch's success — a batch that entirely failed still leaves
// pending rows that must be advanced by the next invocation. The chain fetch uses a
// synchronous `await`-free fire-and-forget (fetch(...).catch) but NEVER relies on
// EdgeRuntime.waitUntil (per verdanote-edge-fn-no-waituntil-for-http-calls) — the
// chain is a NEW top-level invocation, so it survives this function returning.
//
// pg_cron pokes this worker on a steady cadence (companion migration); the self-chain
// handles bursts. Idempotent: a claimed-but-unfinished row (worker died) is reclaimed
// after a stale-claim timeout, and a cached ad is a no-op (isStorageUrl short-circuit).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  assetStoragePath,
  computeContentHash,
  discoverImageUrl,
  discoverVideoUrlWithReason,
  fetchAccountVideoMap,
  isStorageUrl,
  looksLikeHtml,
  NO_THUMB_SENTINEL,
  NO_VIDEO_DELETED_SENTINEL,
  NO_VIDEO_PERMISSION_SENTINEL,
  NO_VIDEO_SENTINEL,
  NO_VIDEO_SENTINELS,
  peekAndValidateMediaStream,
  resolveMetaToken,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";

// 200 MB — matches the ad-videos bucket limit and enrich-thumbnails' MAX_VIDEO_SIZE.
// cacheVideoToStorage STREAMS the upload (no full-file buffering), so worker memory
// no longer caps this; oversized videos keep their live CDN url (still previewable)
// rather than risking WORKER_RESOURCE_LIMIT.
export const MAX_VIDEO_SIZE = 200 * 1024 * 1024;

// Per-invocation wall budget. Edge fn hard wall ~150s; leave margin to flush the
// final status writes + serialize the response + fire the self-chain.
export const DEADLINE_MS = 120_000;

// How many queue rows one invocation claims + processes. Kept SMALL: videos are
// streamed (flat memory) but each is still a network download bounded by the wall
// clock. Volume is handled by the self-chain (fresh worker per invocation), so a
// small batch keeps any single invocation well inside the deadline.
export const BATCH_SIZE = 5;

// Give up on a row after this many failed attempts so a permanently-undownloadable
// ad (dead CDN, no media) stops re-clogging the queue. Mirrors the queue's `attempts`.
export const MAX_ATTEMPTS = 5;

// Safety bound on the self-chain depth. BATCH_SIZE × MAX_CHAIN ≈ hundreds of ads per
// drain — covers the largest new-ad burst while preventing a runaway chain loop.
export const MAX_CHAIN = 100;

export interface DrainSummary {
  claimed: number;
  cached: number;
  skipped: number; // already cached / nothing to cache (no-op)
  failed: number;
  chained: boolean;
  reasons: Record<string, number>;
}

// US-011: isStorageUrl is the shared short-circuit guard (imported above) so the
// "already cached → never re-touch" check can never drift from the repair path.

// deno-lint-ignore no-explicit-any
type Supa = any;

/**
 * Stream a video download straight to Supabase Storage (no full-file buffering, so
 * worker memory stays flat regardless of size), honoring the 200MB cap: an oversized
 * video is NOT stored and the caller keeps its CDN url. Returns the stored bytes'
 * public url on success, or a discriminated failure reason.
 *
 * This is the exact streaming + size-cap contract from enrich-thumbnails, preserved
 * per the US-010 acceptance criterion. Videos are hashed AFTER a size-checked stream
 * is not possible without buffering, so dedupe (US-009) is applied on the IMAGE path
 * (buffered, small) and on videos only when a content-length lets us stay safe; the
 * primary win here is the OOM-safe streaming upload.
 */
export type VideoCacheReason =
  | "expired" // CDN responded non-2xx — the time-limited fbcdn url is dead
  | "non-video" // content-type is not a video payload
  | "empty" // US-003: 200 but zero bytes — not a playable video
  | "html" // US-003: 200 but the body is an HTML/login/error page, not media
  | "too-large" // exceeds MAX_VIDEO_SIZE → keep CDN url, do not store
  | "upload-error" // storage upload failed
  | "exception"; // network/other throw
export interface VideoCacheResult {
  url: string | null;
  reason?: VideoCacheReason;
}

export async function cacheVideoToStorage(
  videoUrl: string,
  accountId: string,
  adId: string,
): Promise<VideoCacheResult> {
  try {
    // Plain fetch (not fetchWithTimeout): an abort timer would sever the body
    // mid-stream during the upload. The edge fn's own ~150s wall limit bounds it.
    const res = await fetch(videoUrl);
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return { url: null, reason: "expired" };
    }

    const contentType = res.headers.get("content-type") || "video/mp4";
    if (!isMediaContentType(contentType, "video")) {
      await res.body.cancel().catch(() => {});
      return { url: null, reason: "non-video" };
    }

    const lenHeader = res.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_VIDEO_SIZE) {
      // Oversized — keep the CDN url (still previewable), never store.
      await res.body.cancel().catch(() => {});
      return { url: null, reason: "too-large" };
    }

    // US-003 (AC#1): validate PLAYABILITY before committing to storage. The
    // content-type header + content-length above are not enough — a Meta CDN /
    // login / error page can 200 with a text/html body (or a video-typed HTML body),
    // and a broken CDN can 200 with a ZERO-byte body; either would otherwise be
    // stored as <adId>.mp4 and wrongly treated as a playable video. We CANNOT buffer
    // the whole stream (256MB worker), so peek ONLY the leading chunk: reject if it
    // is empty or looks like HTML, then stream the re-assembled body (peeked chunk +
    // untouched remainder) on to storage with flat memory.
    const peek = await peekAndValidateMediaStream(res.body);
    if (!peek.ok || !peek.stream) {
      // Reader is released inside the peek; cancel the source Response to free the
      // socket. `empty`/`html` are DISTINCT terminal reasons the caller records.
      await res.body.cancel().catch(() => {});
      const reason: VideoCacheReason = peek.reason === "empty" ? "empty" : "html";
      console.warn(`Rejecting non-playable video for ${adId}: ${reason} (content-type ${contentType})`);
      return { url: null, reason };
    }

    // Per-ad path here (not asset-keyed): streaming the upload precludes hashing the
    // bytes without buffering, so the video path uses the ad-keyed path exactly as
    // enrich-thumbnails does. Image dedupe (buffered) runs on the image path below.
    const storagePath = `${accountId}/${adId}.mp4`;
    const uploadResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${VIDEO_BUCKET}/${storagePath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          "Content-Type": contentType,
          "x-upsert": "true",
          ...(lenHeader ? { "Content-Length": lenHeader } : {}),
        },
        // Stream the VALIDATED, re-assembled body (peeked chunk re-prepended).
        body: peek.stream,
        // Deno requires duplex:'half' to send a streaming request body.
        // deno-lint-ignore no-explicit-any
        duplex: "half",
      } as any,
    );

    if (!uploadResp.ok) {
      const msg = await uploadResp.text().catch(() => "");
      console.error(`Video storage upload error for ${adId}: ${uploadResp.status} ${msg}`);
      return { url: null, reason: "upload-error" };
    }

    return { url: `${SUPABASE_URL}/storage/v1/object/public/${VIDEO_BUCKET}/${storagePath}` };
  } catch (e) {
    console.error(`Cache video to storage error for ${adId}:`, e);
    return { url: null, reason: "exception" };
  }
}

/**
 * Download an image, run the non-media / HTML guards, hash the bytes for
 * within-account dedupe (US-009), and store ONCE per unique creative. Returns the
 * stored public url + optional media_assets id, or null on any failure.
 */
export async function cacheImageToStorage(
  supabase: Supa,
  imageUrl: string,
  accountId: string,
  adId: string,
): Promise<{ publicUrl: string; assetId: string } | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!isMediaContentType(contentType, "image")) {
      console.log(`Refusing to cache image for ${adId}: non-image content (${contentType})`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    if (looksLikeHtml(uint8)) {
      console.log(`Refusing to cache image for ${adId}: HTML page bytes (content-type ${contentType})`);
      return null;
    }

    // Within-account dedupe key.
    const assetKey = await computeContentHash(buffer);
    const { data: existing } = await supabase
      .from("media_assets")
      .select("id, public_url")
      .eq("account_id", accountId)
      .eq("asset_key", assetKey)
      .maybeSingle();
    if (existing?.id && existing?.public_url) {
      return { publicUrl: existing.public_url, assetId: existing.id };
    }

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = assetStoragePath(accountId, assetKey, ext);
    const { error: upErr } = await supabase.storage
      .from(THUMB_BUCKET)
      .upload(path, uint8, { contentType, upsert: true });
    if (upErr) {
      console.error(`Image storage upload error for ${adId}:`, upErr.message);
      return null;
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${THUMB_BUCKET}/${path}`;

    const { data: upserted } = await supabase
      .from("media_assets")
      .upsert(
        {
          account_id: accountId,
          asset_key: assetKey,
          media_type: "image",
          bucket: THUMB_BUCKET,
          storage_path: path,
          public_url: publicUrl,
          byte_size: uint8.byteLength,
          content_type: contentType,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,asset_key" },
      )
      .select("id, public_url")
      .maybeSingle();

    return { publicUrl, assetId: upserted?.id ?? "" };
  } catch (e) {
    console.error(`Cache image to storage error for ${adId}:`, e);
    return null;
  }
}

/**
 * Process one queued ad: discover + cache its media (video first — the heavy path
 * this worker exists for — then image), preserving all skip-gates. Returns an
 * outcome the drain loop uses to mark the queue row.
 */
export async function processQueuedAd(
  supabase: Supa,
  adId: string,
  accountId: string,
  metaToken: string,
): Promise<{ outcome: "cached" | "skipped" | "failed"; reason?: string }> {
  const { data: creative, error: fetchErr } = await supabase
    .from("creatives")
    .select("ad_id, account_id, thumbnail_url, full_res_url, video_url, thumb_asset_id, video_asset_id, image_quality")
    .eq("ad_id", adId)
    .maybeSingle();

  if (fetchErr || !creative) {
    // The ad was deleted between enqueue and drain — nothing to cache. Treat as
    // done so it stops re-claiming (the ON DELETE CASCADE FK usually removes the
    // queue row, but guard the race anyway).
    return { outcome: "skipped", reason: "creative-missing" };
  }

  // deno-lint-ignore no-explicit-any
  const updates: Record<string, any> = {};
  let didCache = false;
  const reasons: string[] = [];

  // US-003 (AC#2/#3): decide the video disposition honestly.
  //   • already a storage url → cached, playable → SKIP (never re-touch, US-011).
  //   • a TERMINAL no-video sentinel (permission / deleted) → the video is
  //     genuinely-unresolvable under our access; re-discovery would fail identically,
  //     so SKIP forever (this is the honest residual set for AC#4).
  //   • the GENERIC no-video sentinel → previously skipped FOREVER (the AC#2 bug:
  //     an ad sitting on 'no-video' whose video is still resolvable was never
  //     re-discovered). Now it is a RE-DISCOVERY TARGET — treated the same as a
  //     never-attempted ad. The queue's attempts/backoff + MAX_ATTEMPTS bound the
  //     retries, and a run that STILL cannot resolve records the classified terminal
  //     reason (permission/deleted) or leaves the generic no-video, so there is no
  //     infinite re-discovery loop.
  //   • a NULLed url (an earlier drain found an expired CDN url and NULLed it) →
  //     re-discovery target (null triggers discovery below).
  const videoIsTerminalSentinel =
    creative.video_url === NO_VIDEO_PERMISSION_SENTINEL ||
    creative.video_url === NO_VIDEO_DELETED_SENTINEL;
  const skipVideo = isStorageUrl(creative.video_url) || videoIsTerminalSentinel;
  // A stored value that is NOT a usable CDN url (the generic no-video sentinel, or a
  // NULL) means "no live CDN url to download — go discover one".
  const videoNeedsDiscovery =
    creative.video_url == null || creative.video_url === NO_VIDEO_SENTINEL;

  // US-002: a creative sitting on a low-res placeholder (image_quality='low_res',
  // e.g. only the ~130px thumbnail_url fallback) is a re-discovery TARGET, not
  // "already cached" — even when that placeholder is itself a storage URL. So the
  // image is skippable only when it is already a REAL full-res cached asset
  // (image_quality='full_res') or a genuinely-no-image sentinel. Everything else
  // (NULL image_quality, or an explicit low_res placeholder) gets a fresh full-res
  // discovery attempt. cacheImageToStorage dedupes by content hash, so an ad whose
  // full-res bytes are already stored is a no-op download (US-002 AC#3).
  const hasRealFullRes =
    creative.full_res_url != null && creative.full_res_url !== NO_THUMB_SENTINEL;
  // A placeholder = explicitly flagged low_res, OR (pre-backfill legacy) a stored
  // thumbnail with no real full_res_url behind it.
  const isLowResPlaceholder =
    creative.image_quality === "low_res" ||
    (creative.image_quality !== "full_res" && isStorageUrl(creative.thumbnail_url) && !hasRealFullRes);
  // Skippable only when: the no-thumbnail sentinel, OR a REAL full-res cached asset
  // (a stored thumbnail with real full_res_url and not a low-res placeholder). A
  // low-res placeholder is a re-discovery TARGET (US-002 AC#3), never skipped —
  // cacheImageToStorage dedupes by content hash, so an already-full-res ad re-runs
  // as a no-op download.
  const skipImage =
    creative.thumbnail_url === NO_THUMB_SENTINEL ||
    (isStorageUrl(creative.thumbnail_url) && hasRealFullRes && !isLowResPlaceholder);

  // ── Video (the heavy path) ──────────────────────────────────────────────────
  if (!skipVideo) {
    // A usable live CDN url only if the stored value is one (never the generic
    // no-video sentinel — that is a re-discovery target, not a downloadable url).
    let cdnUrl: string | null = videoNeedsDiscovery ? null : creative.video_url;
    if (videoNeedsDiscovery) {
      // No usable CDN url (never attempted, generic no-video, or NULLed-expired) —
      // run FULL discovery through every existing strategy (top-level video_id,
      // object_story_spec, template_data, asset_feed_spec.videos, account video map,
      // post attachments). Build the account video map once (AC#2).
      const accountVideoMap = await fetchAccountVideoMap(accountId, metaToken);
      const { url: discovered, reason } = await discoverVideoUrlWithReason(
        adId,
        metaToken,
        30_000,
        accountVideoMap,
      );
      cdnUrl =
        discovered && !NO_VIDEO_SENTINELS.has(discovered) ? discovered : null;
      if (!cdnUrl) {
        // Genuinely could not resolve. Record the DISTINCT honest reason (AC#3):
        //   permission / deleted → TERMINAL sentinel (skipped on future drains);
        //   unknown → generic no-video (still a re-discovery target next time,
        //   bounded by the queue's attempts/backoff so it is not an infinite loop).
        updates.video_url = reason ?? NO_VIDEO_SENTINEL;
        reasons.push(reason ?? NO_VIDEO_SENTINEL);
      }
    }
    if (cdnUrl) {
      const result = await cacheVideoToStorage(cdnUrl, accountId, adId);
      if (result.url) {
        updates.video_url = result.url;
        didCache = true;
      } else if (result.reason === "too-large") {
        // Oversized — keep the CDN url (still previewable), do not store. This is a
        // successful terminal outcome for this ad, not a failure.
        updates.video_url = cdnUrl;
        reasons.push("too-large");
      } else if (result.reason === "expired") {
        // Stale CDN url — NULL it so the next drain re-discovers a fresh one.
        updates.video_url = null;
        reasons.push("expired");
      } else if (
        result.reason === "empty" ||
        result.reason === "html" ||
        result.reason === "non-video"
      ) {
        // US-003 (AC#1): the "cached" bytes are NOT a playable video — a zero-byte
        // 200, an HTML/login/error page, or a non-video payload. This url must NEVER
        // be marked video_ok. NULL the url so a fresh CDN url is re-discovered next
        // drain (the current one may simply be a stale/expired link that now serves
        // an error page); the row stays NOT video_ok until a real video is cached.
        updates.video_url = null;
        reasons.push(result.reason);
      } else {
        reasons.push(result.reason ?? "video-failed");
      }
    }
  }

  // ── Image ───────────────────────────────────────────────────────────────────
  if (!skipImage) {
    // For a low-res placeholder (US-002 re-discovery), the stored thumbnail_url is
    // the ~130px placeholder itself — never re-cache THAT. Force a fresh discovery
    // to look for a full-res source. For a first-time ad, use its existing live CDN
    // thumbnail_url if present, else discover one.
    let imgUrl: string | null = isLowResPlaceholder ? null : creative.thumbnail_url;
    // Track the discovered quality so we only promote to full_res when a real
    // full-res source was found; a fresh live CDN thumbnail_url on a first-time ad
    // is treated as full_res (that is the standard non-placeholder path).
    let discoveredQuality: "full_res" | "low_res" =
      isLowResPlaceholder ? "low_res" : "full_res";

    if (!imgUrl) {
      const discovered = await discoverImageUrl(adId, accountId, metaToken, 8_000);
      imgUrl = discovered?.thumbnailUrl ?? null;
      discoveredQuality = discovered?.imageQuality ?? "low_res";
      if (!imgUrl && !isLowResPlaceholder) updates.thumbnail_url = NO_THUMB_SENTINEL;
    }

    if (imgUrl && discoveredQuality === "full_res") {
      // Cache the full-res source. Content-hash dedupe (US-009) makes this a no-op
      // download when the same full-res bytes are already stored for the account,
      // satisfying "no re-download of media already full-res" (US-002 AC#3).
      const asset = await cacheImageToStorage(supabase, imgUrl, accountId, adId);
      if (asset) {
        updates.thumbnail_url = asset.publicUrl;
        updates.full_res_url = asset.publicUrl;
        updates.image_quality = "full_res";
        if (asset.assetId) updates.thumb_asset_id = asset.assetId;
        didCache = true;
      } else if (!creative.thumbnail_url) {
        // Caching failed (e.g. non-image bytes) and no existing image — fall back to
        // the CDN url so the card at least renders; leave quality unresolved (NULL).
        updates.thumbnail_url = imgUrl;
      }
    } else if (imgUrl && discoveredQuality === "low_res") {
      // Only a low-res placeholder is available. Record it as low_res so US-001
      // coverage honestly reports NOT image_ok and the US-002 re-discovery job knows
      // to re-attempt later — but do NOT keep re-downloading the same 130px bytes.
      // Preserve an already-stored placeholder (don't overwrite it with the raw CDN
      // url); only write the CDN url when we have nothing stored yet.
      if (!isStorageUrl(creative.thumbnail_url)) {
        updates.thumbnail_url = imgUrl;
      }
      if (creative.image_quality !== "low_res") updates.image_quality = "low_res";
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from("creatives").update(updates).eq("ad_id", adId).eq("account_id", accountId);
  }

  if (didCache) return { outcome: "cached", reason: reasons.join(",") || undefined };
  // Oversized (too-large) or already-cached (skipVideo && skipImage) → this ad is
  // done; there is nothing more to store. Only a hard failure re-queues.
  if (reasons.some((r) => r === "too-large") || (skipVideo && skipImage)) {
    return { outcome: "skipped", reason: reasons.join(",") || "already-cached" };
  }
  // US-003: a genuinely-unresolvable video is a TERMINAL, honest outcome — NOT a
  // transient failure to re-queue. When discovery classified the reason as one of the
  // no-video-* sentinels (permission/deleted/generic-unknown), the row is written with
  // that distinct sentinel and marked done; a later targeted re-discovery run
  // (AC#4) re-enqueues the still-generic 'no-video' rows to re-attempt them. This
  // stops a permanently-unresolvable ad from re-clogging the queue every drain while
  // keeping coverage honest (all no-video-* are NOT video_ok). `empty`/`html`/`expired`
  // NULLed the url and DO warrant a retry (a fresh CDN url may serve real bytes).
  const onlyTerminalVideoReasons =
    reasons.length > 0 && reasons.every((r) => NO_VIDEO_SENTINELS.has(r));
  if (onlyTerminalVideoReasons) {
    return { outcome: "skipped", reason: reasons.join(",") };
  }
  if (reasons.length > 0) return { outcome: "failed", reason: reasons.join(",") };
  // Nothing to cache (sentineled both / no media): terminal skip, not a retry.
  return { outcome: "skipped", reason: "no-media" };
}

export async function drainOnce(
  supabase: Supa,
  metaToken: string,
  limit: number,
  deadlineMs: number,
): Promise<DrainSummary> {
  const startedMs = Date.now();
  const timedOut = () => Date.now() - startedMs > deadlineMs;
  const summary: DrainSummary = {
    claimed: 0,
    cached: 0,
    skipped: 0,
    failed: 0,
    chained: false,
    reasons: {},
  };

  // Atomically claim a batch (FOR UPDATE SKIP LOCKED inside the RPC) so concurrent
  // invocations never process the same ad. The RPC marks the rows 'processing',
  // bumps attempts, and returns them.
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_media_cache_queue", {
    p_limit: limit,
  });
  if (claimErr) {
    console.error("claim_media_cache_queue error:", claimErr.message);
    return summary;
  }
  // deno-lint-ignore no-explicit-any
  const rows: any[] = claimed || [];
  summary.claimed = rows.length;

  for (const row of rows) {
    if (timedOut()) {
      // Release un-processed claims back to pending so the next invocation retries
      // them (rather than leaving them stuck in 'processing').
      await supabase
        .from("media_cache_queue")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("ad_id", row.ad_id)
        .eq("status", "processing");
      continue;
    }

    const { outcome, reason } = await processQueuedAd(
      supabase,
      row.ad_id,
      row.account_id,
      metaToken,
    );
    if (reason) summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;

    if (outcome === "cached" || outcome === "skipped") {
      if (outcome === "cached") summary.cached++;
      else summary.skipped++;
      await supabase
        .from("media_cache_queue")
        .update({ status: "done", updated_at: new Date().toISOString(), last_error: reason ?? null })
        .eq("ad_id", row.ad_id);
    } else {
      summary.failed++;
      // attempts was bumped by the claim RPC; give up after MAX_ATTEMPTS.
      const gaveUp = (row.attempts ?? 0) >= MAX_ATTEMPTS;
      await supabase
        .from("media_cache_queue")
        .update({
          status: gaveUp ? "failed" : "pending",
          updated_at: new Date().toISOString(),
          last_error: reason ?? "unknown",
        })
        .eq("ad_id", row.ad_id);
    }
  }

  return summary;
}

export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // serve() invokes handler(req, connInfo); connInfo is truthy but has no `.from`,
  // so only accept an override that actually looks like a Supabase client.
  const isClient = (o: unknown): boolean =>
    !!o && typeof (o as { from?: unknown }).from === "function";
  const supabase: Supa = isClient(supabaseOverride)
    ? supabaseOverride
    : createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

  try {
    const url = new URL(req.url);
    const chainDepth = Number(url.searchParams.get("chain") || "0");

    // Resolve Meta token — env first, then settings table (same as sync).
    let metaToken = resolveMetaToken(Deno.env.get("META_ACCESS_TOKEN"), null);
    if (!metaToken) {
      const { data: tokenRow } = await supabase
        .from("settings").select("value").eq("key", "meta_access_token").single();
      metaToken = resolveMetaToken(Deno.env.get("META_ACCESS_TOKEN"), tokenRow?.value as string | undefined);
    }
    if (!metaToken) {
      return new Response(JSON.stringify({ error: "No Meta access token configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary = await drainOnce(supabase, metaToken, BATCH_SIZE, DEADLINE_MS);

    // Self-chain WHILE pending rows remain — unconditionally on remaining work, NOT
    // gated on this batch's success (a fully-failed batch still leaves pending rows
    // that the next invocation must advance). Bounded by MAX_CHAIN; disabled in
    // tests via DRAIN_NO_CHAIN so the chain fetch never hits a live URL.
    const { count: pending } = await supabase
      .from("media_cache_queue")
      .select("ad_id", { count: "exact", head: true })
      .eq("status", "pending");

    if ((pending ?? 0) > 0 && chainDepth < MAX_CHAIN && !Deno.env.get("DRAIN_NO_CHAIN")) {
      summary.chained = true;
      const nextUrl =
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/drain-media-queue?chain=${chainDepth + 1}`;
      // Fire-and-forget a FRESH top-level invocation (new worker, fresh memory). NOT
      // EdgeRuntime.waitUntil (per verdanote-edge-fn-no-waituntil-for-http-calls) — a
      // new invocation survives this function returning.
      fetch(nextUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: "{}",
      }).catch((e: Error) => console.error("drain-media-queue self-chain error:", e.message));
    }

    console.log("drain-media-queue:", JSON.stringify({ ...summary, chainDepth, pending }));
    return new Response(JSON.stringify({ status: "completed", chainDepth, pending: pending ?? 0, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("drain-media-queue error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Guard the network bind so tests can import the module without serving.
if (!Deno.env.get("DRAIN_MEDIA_QUEUE_NO_SERVE")) {
  serve(handler);
}
