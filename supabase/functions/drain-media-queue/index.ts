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
//      streaming upload proven in enrich-thumbnails, now with a deliberate 2GB capture
//      ceiling (US-007: streaming keeps memory flat, so the ceiling is a storage policy,
//      not a memory guard; a video above it is recorded oversized, not left on the CDN).
//      Within-account dedupe (US-009) is preserved: bytes are hashed and a second ad
//      reusing the identical creative reuses the stored asset.
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
  discoverImageUrlWithReason,
  discoverVideoUrlWithReason,
  fetchAccountVideoMap,
  fetchPageTokenMap,
  isStorageUrl,
  looksLikeHtml,
  NO_THUMB_SENTINEL,
  NO_VIDEO_DELETED_SENTINEL,
  NO_VIDEO_OVERSIZED_SENTINEL,
  NO_VIDEO_PERMISSION_SENTINEL,
  NO_VIDEO_SENTINEL,
  NO_VIDEO_SENTINELS,
  peekAndValidateMediaStream,
  resolveMetaToken,
  THROTTLED,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";

// US-007: deliberate capture ceiling — 2 GB.
//
// RATIONALE (replaces the old 200 MB wire, which was a MEMORY guard, not a policy):
// cacheVideoToStorage STREAMS the download straight to storage with `duplex:"half"`
// (peeked chunk + untouched remainder), so worker memory stays FLAT regardless of the
// file's size. Memory is therefore NOT the binding constraint — the old 200 MB cap left
// large-but-perfectly-cacheable videos stranded on an expiring Meta CDN url for no
// memory reason (the US-007 gap). The ceiling now exists only as a STORAGE/BANDWIDTH
// policy limit: a runaway/corrupt multi-GB response should not be streamed into the
// bucket unbounded. 2 GB comfortably exceeds real Meta ad videos (typically <200 MB;
// long-form/high-bitrate outliers reach a few hundred MB), so genuine ad creatives are
// captured while a pathological response is still bounded. The companion migration
// raises the ad-videos bucket file_size_limit to match (SQL cannot exceed the
// project-level storage upload cap; if that is lower, it becomes the true ceiling and
// an upload-error is recorded rather than a silent truncation).
//
// A video whose content-length exceeds this ceiling is NOT streamed; it is recorded as
// the distinct NO_VIDEO_OVERSIZED_SENTINEL (honest-terminal, NOT video_ok) so coverage
// reporting shows "too large to capture under policy" separately from unresolved/gone.
export const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

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
  throttled: number; // Meta rate-limited — re-queued for a short retry, no attempt burned
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
  | "too-large" // US-007: content-length exceeds the 2GB MAX_VIDEO_SIZE ceiling → do not
  // stream; caller records the distinct NO_VIDEO_OVERSIZED_SENTINEL (honest-terminal)
  | "upload-error" // storage upload failed
  | "exception"; // network/other throw
export interface VideoCacheResult {
  url: string | null;
  reason?: VideoCacheReason;
  // media_assets.id of the stored/shared video asset (US: video dedupe by video_id),
  // set only when a supabase client + videoId were supplied. Callers stamp it onto
  // creatives.video_asset_id so sibling ads reference the one shared copy.
  assetId?: string;
  // True when the video was already cached for this (account, video_id) and reused
  // WITHOUT re-downloading — the whole point of the dedupe.
  deduped?: boolean;
}

export async function cacheVideoToStorage(
  videoUrl: string,
  accountId: string,
  adId: string,
  supabase?: Supa,
  videoId?: string,
): Promise<VideoCacheResult> {
  // Dedupe key: Meta's video_id, scoped to the account (tenant isolation). The same
  // video backs many ads, so we store ONE copy per (account, video_id) and let every
  // ad reference it. Only active when a supabase client + videoId are supplied;
  // otherwise this falls back to the legacy per-ad path unchanged.
  const dedupeKey = videoId ? `video:${videoId}` : null;
  try {
    // Dedupe HIT: already cached for this (account, video_id) — skip the download
    // entirely and reuse the stored copy. This is the bulk of the savings (one video
    // reused across dozens of ads never re-downloads).
    if (supabase && dedupeKey) {
      const { data: existing } = await supabase
        .from("media_assets")
        .select("id, public_url")
        .eq("account_id", accountId)
        .eq("asset_key", dedupeKey)
        .maybeSingle();
      if (existing?.id && existing?.public_url) {
        return { url: existing.public_url, assetId: existing.id, deduped: true };
      }
    }
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

    // Storage path: asset-keyed by video_id when we have it (so sibling ads share the
    // one object and dedupe by id — we can't content-hash a streamed upload without
    // buffering, but the Meta video_id is an equally stable key). Falls back to the
    // legacy per-ad path when no videoId was supplied.
    const storagePath = dedupeKey
      ? `${accountId}/assets/video-${videoId}.mp4`
      : `${accountId}/${adId}.mp4`;
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

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${VIDEO_BUCKET}/${storagePath}`;

    // Register the stored copy in the dedupe ledger so sibling ads reuse it (mirrors
    // the image path's media_assets upsert, keyed by video_id instead of a content
    // hash). onConflict makes a concurrent double-store idempotent.
    let assetId: string | undefined;
    if (supabase && dedupeKey) {
      const { data: upserted } = await supabase
        .from("media_assets")
        .upsert(
          {
            account_id: accountId,
            asset_key: dedupeKey,
            media_type: "video",
            bucket: VIDEO_BUCKET,
            storage_path: storagePath,
            public_url: publicUrl,
            byte_size: lenHeader ? Number(lenHeader) : null,
            content_type: contentType,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "account_id,asset_key" },
        )
        .select("id")
        .maybeSingle();
      assetId = upserted?.id ?? undefined;
    }

    return { url: publicUrl, assetId };
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
  pageTokenMap?: Map<string, string>,
  accountVideoMap?: Map<string, string>,
): Promise<{ outcome: "cached" | "skipped" | "failed" | "throttled"; reason?: string }> {
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
  let throttled = false; // a throttle on video OR image discovery — retry, record nothing
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
    // The Meta video_id behind cdnUrl, when discovery resolved one — the dedupe key
    // for cacheVideoToStorage (store once per (account, video_id)).
    let resolvedVideoId: string | undefined;
    if (videoNeedsDiscovery) {
      // No usable CDN url (never attempted, generic no-video, or NULLed-expired) —
      // run FULL discovery through every existing strategy (top-level video_id,
      // object_story_spec, template_data, asset_feed_spec.videos, account video map,
      // post attachments). Prefer the caller's per-account map (built ONCE per drain
      // invocation in drainOnce — paginating the whole advideos library per ad was an
      // N+1 that hammered the rate limit); fall back to building it here so direct
      // callers/tests still work.
      const videoMap = accountVideoMap ?? await fetchAccountVideoMap(accountId, metaToken);
      const { url: discovered, reason, videoId } = await discoverVideoUrlWithReason(
        adId,
        metaToken,
        30_000,
        videoMap,
        pageTokenMap,
      );
      cdnUrl =
        discovered && !NO_VIDEO_SENTINELS.has(discovered) ? discovered : null;
      resolvedVideoId = videoId;
      if (!cdnUrl) {
        if (reason === THROTTLED) {
          // Meta rate-limited us — the "no video found" conclusion is UNRELIABLE. Do
          // NOT write any sentinel to video_url (leave the existing value untouched),
          // flag the ad for a short transient retry, and record NOTHING. A throttle
          // means "we could not check", never "no video exists".
          throttled = true;
          reasons.push(THROTTLED);
        } else {
          // Genuinely could not resolve. Record the DISTINCT honest reason (AC#3):
          //   permission / deleted → TERMINAL sentinel (skipped on future drains);
          //   unknown → generic no-video (still a re-discovery target next time,
          //   bounded by the queue's attempts/backoff so it is not an infinite loop).
          updates.video_url = reason ?? NO_VIDEO_SENTINEL;
          reasons.push(reason ?? NO_VIDEO_SENTINEL);
        }
      }
    }
    if (cdnUrl) {
      const result = await cacheVideoToStorage(cdnUrl, accountId, adId, supabase, resolvedVideoId);
      if (result.url) {
        updates.video_url = result.url;
        // Link the shared asset so sibling ads dedupe against it (US: video dedupe).
        if (result.assetId) updates.video_asset_id = result.assetId;
        if (result.deduped) console.log(`Video dedupe hit for ${adId} (video ${resolvedVideoId}) — reused stored copy, no download`);
        didCache = true;
      } else if (result.reason === "too-large") {
        // US-007: exceeds the deliberate 2GB capture ceiling. Streaming keeps worker
        // memory flat, so this is a POLICY limit, not a memory failure — the video is
        // genuinely-unhandleable under our storage policy and will not shrink, so it is
        // honest-TERMINAL: record the distinct NO_VIDEO_OVERSIZED_SENTINEL (NOT
        // video_ok, its own coverage failure_reason) rather than leaving the live CDN
        // url (which would read as the generic 'video_uncached' and be pointlessly
        // re-attempted every drain, only to hit the same size ceiling). The prior
        // behavior kept the CDN url as "previewable", but such links expire within
        // hours/days and re-discovery cannot fix the size — so the sentinel is both
        // more honest and stops the ad re-clogging the queue.
        updates.video_url = NO_VIDEO_OVERSIZED_SENTINEL;
        reasons.push(NO_VIDEO_OVERSIZED_SENTINEL);
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
      const { result: discovered, reason: imgReason } =
        await discoverImageUrlWithReason(adId, accountId, metaToken, 8_000);
      imgUrl = discovered?.thumbnailUrl ?? null;
      discoveredQuality = discovered?.imageQuality ?? "low_res";
      if (!imgUrl && imgReason === THROTTLED) {
        // Meta rate-limited the image lookup — inconclusive. Never write the
        // NO_THUMB_SENTINEL ("no-thumbnail") for a mere throttle (that would
        // permanently mark a rate-limited ad as having no image). Leave the image
        // columns untouched and flag for a short transient retry.
        throttled = true;
        reasons.push(THROTTLED);
      } else if (!imgUrl && !isLowResPlaceholder) {
        updates.thumbnail_url = NO_THUMB_SENTINEL;
      }
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

  // Throttle takes priority for the queue disposition: a throttle on EITHER media path
  // means that path's conclusion is unreliable and must be retried soon. The row's
  // media columns for the throttled path were deliberately left untouched (no sentinel
  // written), and any half we DID cache this run is already persisted in `updates`, so
  // a re-queue safely short-circuits the cached half (isStorageUrl) and only re-attempts
  // the throttled half. Returning 'throttled' keeps the ad eligible for a normal retry
  // WITHOUT consuming a hard-failure attempt or a terminal disposition.
  if (throttled) return { outcome: "throttled", reason: reasons.join(",") || THROTTLED };

  if (didCache) return { outcome: "cached", reason: reasons.join(",") || undefined };
  // Already-cached (skipVideo && skipImage) → this ad is done; there is nothing more to
  // store. Only a hard failure re-queues. (US-007: an oversized video is no longer a
  // 'too-large' skip that keeps the CDN url — it is written the NO_VIDEO_OVERSIZED_
  // SENTINEL and falls through to the terminal-sentinel skip below, so it is done and
  // will not re-clog the queue.)
  if (skipVideo && skipImage) {
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
    throttled: 0,
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

  // Build the page-token map ONCE per invocation (it is account-independent — the set
  // of Pages assigned to our system user). Threaded into every ad so page-owned video
  // resolves via the owning Page's token. Empty map ⇒ behaves exactly as before.
  const pageTokenMap = rows.length ? await fetchPageTokenMap(metaToken) : undefined;

  // Cache the account video-library map per account across this claimed batch. A batch
  // can span accounts, so key by account_id and build each at most ONCE (previously
  // fetchAccountVideoMap re-paginated the entire advideos library for EVERY ad — a
  // per-ad N+1 that was a primary throttle source at scale).
  const videoMapCache = new Map<string, Map<string, string>>();
  const getVideoMap = async (acct: string): Promise<Map<string, string>> => {
    const hit = videoMapCache.get(acct);
    if (hit) return hit;
    const built = await fetchAccountVideoMap(acct, metaToken);
    videoMapCache.set(acct, built);
    return built;
  };

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

    const accountVideoMap = await getVideoMap(row.account_id);
    const { outcome, reason } = await processQueuedAd(
      supabase,
      row.ad_id,
      row.account_id,
      metaToken,
      pageTokenMap,
      accountVideoMap,
    );
    if (reason) summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;

    if (outcome === "throttled") {
      // Meta rate-limited this ad's discovery — NOT a data verdict and NOT a hard
      // failure. Re-queue it to 'pending' for a SHORT transient retry (the next
      // drain-media-queue-2min poke picks it up soon), leave its media columns
      // untouched, and DO NOT burn an attempt: the claim RPC already bumped attempts,
      // so decrement it back so a throttle never advances the ad toward MAX_ATTEMPTS
      // or the escalating permanent-failure backoff. It is neither done/cached nor a
      // hard failure — just deferred.
      summary.throttled++;
      await supabase
        .from("media_cache_queue")
        .update({
          status: "pending",
          attempts: Math.max(0, (row.attempts ?? 1) - 1),
          updated_at: new Date().toISOString(),
          last_error: reason ?? THROTTLED,
        })
        .eq("ad_id", row.ad_id);
    } else if (outcome === "cached" || outcome === "skipped") {
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
