// =============================================================================
// apify-capture — US-002 per-ad Apify creative capture (service-role).
// =============================================================================
// Given { ad_id, force? }, capture ONE creative whose ad_archive_id_status is
// 'resolved': run the locked apify~facebook-ads-scraper actor on the SINGLE
// locked Ad-Library ?id= URL, download the returned media SERVER-SIDE, land it in
// owned storage byte-identically to the API tier (content-hash asset_key,
// ad-videos/ad-thumbnails buckets, media_assets row with capture_source='apify'),
// update the creative row, and charge the per-day spend ledger.
//
// This is the per-ad worker; a separate cron drain selects resolved-but-uncaptured
// creatives and POSTs { ad_id } here (so retry/backoff is enforced by comparing
// apify_last_attempt_at, per verdanote's cron-drain pattern). verify_jwt=false and
// no self-auth — internal only, never linked from a client (mirrors
// drain-media-queue / refresh-media-queue). It runs a PAID actor, so the budget
// gate (AC#2) is always enforced, even under force.
//
// ALL branch logic lives in _shared/apify-capture-logic.ts (unit-tested). This
// file is the thin I/O shell: gate -> run actor -> download+store -> update rows.
//
// Locked facts: see _shared/apify-capture-logic.ts header + US-000-spike.md.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { ACTOR_CONFIGS } from "../_shared/actor-configs.ts";
import {
  assetStoragePath,
  computeContentHash,
  fetchWithTimeout,
  looksLikeHtml,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";
import {
  alreadyCovered,
  archiveIdSkipReason,
  buildAdArchiveUrl,
  budgetDecision,
  type CapturedAsset,
  computeSpendUsd,
  finalCaptureStatus,
  parseApifyCaptureResult,
  planCreativeMediaUpdate,
  retryDecision,
} from "../_shared/apify-capture-logic.ts";

const APIFY_BASE = "https://api.apify.com/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";

// Buffered download cap (mirrors cache-creative-image's API-tier path, which also
// arrayBuffer()s to content-hash). Real Meta ad videos are well under this
// (US-000 samples were 14-27MB); a runaway response is bounded, not OOM'd.
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Today's UTC calendar day (matches apify_spend.day / add_apify_spend). */
function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Download media bytes SERVER-SIDE and store them byte-identically to an API
 * asset: SHA-256 content-hash asset_key, asset-keyed storage path
 * (<account>/assets/<hash>.<ext>), media_assets upsert onConflict
 * (account_id, asset_key). The ONLY difference from the API tier is
 * capture_source='apify' on rows this function inserts. A content-hash collision
 * with an existing (meta_api) asset dedupes to that row WITHOUT changing its
 * provenance (it was genuinely fetched by the API tier). Returns the owned
 * public url + media_assets id, or null on any guard failure.
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
    const res = await fetchWithTimeout(url, 60_000);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (type === "image" && bytes.byteLength < 5000) return null; // too small to be a real image
    if (type === "video" && bytes.byteLength > MAX_VIDEO_SIZE) {
      console.warn(`[${adId}] apify video exceeds ${MAX_VIDEO_SIZE} bytes — not stored`);
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

    const ext =
      type === "video"
        ? contentType.includes("webm") ? "webm" : "mp4"
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
          capture_source: "apify", // US-001 provenance — the only shape difference
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
 * Backfill pending carousel-frame IMAGE assets from the parsed Apify cards,
 * mirroring drain-media-queue.backfillFrameAssets — link each pending
 * creative_frames row (asset_id NULL, media_type != 'video') to the stored image
 * of the card at the same frame_index. Video frames are left for the video path.
 * Returns the number of frames newly linked.
 */
async function backfillCarouselFrames(
  supabase: Supa,
  adId: string,
  accountId: string,
  cards: Array<{ video: string | null; image: string | null }>,
): Promise<number> {
  const { data: frameRows } = await supabase
    .from("creative_frames")
    .select("frame_index, media_type, asset_id")
    .eq("ad_id", adId);
  // deno-lint-ignore no-explicit-any
  const pending = (frameRows ?? []).filter((f: any) => f.asset_id == null && f.media_type !== "video");
  if (pending.length === 0) return 0;

  let linked = 0;
  for (const row of pending) {
    const card = cards[row.frame_index];
    const imgUrl = card?.image;
    if (!imgUrl) continue;
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

/**
 * Invoke the locked actor via run-sync-get-dataset-items on the SINGLE locked URL
 * and return the dataset items. Mirrors scrape-ad.tryApifyAdLibrary: memory=2048,
 * actor timeout=90 (under the ~150s edge gateway wall), AbortController at 125s.
 * Throws on transport/auth/quota errors so the caller records a retryable failure.
 */
async function runActor(url: string, apifyToken: string): Promise<{ items: unknown[]; count: number }> {
  const config = ACTOR_CONFIGS.facebook_ad;
  const input = config.buildInput(url); // { startUrls: [{ url }] } — url passes through unchanged
  const runUrl =
    `${APIFY_BASE}/acts/${config.actorId}/run-sync-get-dataset-items` +
    `?token=${apifyToken}&memory=2048&timeout=90`;
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), 125_000);
  let resp: Response;
  try {
    resp = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("apify run-sync aborted after 125s");
    throw e;
  } finally {
    clearTimeout(abortTimer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    if (resp.status === 401 || resp.status === 403) throw new Error("invalid or unauthorized APIFY_TOKEN");
    if (resp.status === 402) throw new Error("apify quota exhausted (402)");
    throw new Error(`apify run-sync error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const items = await resp.json().catch(() => []);
  const arr = Array.isArray(items) ? items : [];
  return { items: arr, count: arr.length };
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
  try {
    const body = await req.json();
    adId = String(body?.ad_id ?? "");
    force = body?.force === true;
    if (!adId) throw new Error("ad_id required");
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || "bad request" }, 400);
  }

  const apifyToken = Deno.env.get("APIFY_TOKEN");
  if (!apifyToken) return jsonResponse({ error: "APIFY_TOKEN not configured" }, 500);

  // -- Load creative --------------------------------------------------------
  const { data: creative, error: fetchErr } = await supabase
    .from("creatives")
    .select(
      "ad_id, account_id, ad_archive_id, ad_archive_id_status, video_url, full_res_url, " +
      "thumbnail_url, image_quality, apify_attempts, apify_last_attempt_at, apify_capture_status",
    )
    .eq("ad_id", adId)
    .maybeSingle();
  if (fetchErr || !creative) {
    return jsonResponse({ ad_id: adId, status: "error", reason: "creative_not_found" }, 404);
  }
  const accountId: string = creative.account_id;

  // -- AC#1: archive-id gate ------------------------------------------------
  const archiveSkip = archiveIdSkipReason(creative.ad_archive_id_status, creative.ad_archive_id);
  if (archiveSkip) {
    return jsonResponse({ ad_id: adId, status: "skipped", reason: archiveSkip });
  }

  // -- AC#1: already-covered gate (unless force) ----------------------------
  if (!force && alreadyCovered(creative)) {
    return jsonResponse({ ad_id: adId, status: "skipped", reason: "already_covered" });
  }

  // -- AC#5: retry / backoff / terminal gate --------------------------------
  const now = Date.now();
  const retry = retryDecision({
    attempts: creative.apify_attempts ?? 0,
    lastAttemptAt: creative.apify_last_attempt_at,
    now,
    force,
  });
  if (retry.action === "terminal") {
    // Attempt cap already reached — persist the terminal state and stop.
    await supabase.from("creatives")
      .update({ apify_capture_status: "failed" })
      .eq("ad_id", adId).eq("account_id", accountId);
    return jsonResponse({ ad_id: adId, status: "skipped", reason: "max_attempts_exceeded" });
  }
  if (retry.action === "backoff") {
    return jsonResponse({
      ad_id: adId, status: "skipped", reason: "backoff",
      next_eligible_at: retry.nextEligibleAt ? new Date(retry.nextEligibleAt).toISOString() : null,
    });
  }

  // -- AC#2: budget gate BEFORE the actor call ------------------------------
  const day = utcDay();
  const { data: spendRow } = await supabase
    .from("apify_spend")
    .select("spent_usd, cap_usd")
    .eq("day", day)
    .maybeSingle();
  const budget = budgetDecision({ capUsd: spendRow?.cap_usd ?? null, spentUsd: spendRow?.spent_usd ?? 0 });
  if (!budget.allowed) {
    return jsonResponse({ ad_id: adId, status: "skipped", reason: budget.reason });
  }

  // -- Record the attempt BEFORE running (so a mid-run crash still burns an
  //     attempt and backoff is enforced by apify_last_attempt_at). ----------
  const attemptsAfter = (creative.apify_attempts ?? 0) + 1;
  await supabase.from("creatives")
    .update({
      apify_capture_status: "pending",
      apify_attempts: attemptsAfter,
      apify_last_attempt_at: new Date(now).toISOString(),
    })
    .eq("ad_id", adId).eq("account_id", accountId);

  // -- Run the actor on THE locked URL --------------------------------------
  const url = buildAdArchiveUrl(creative.ad_archive_id);
  let items: unknown[];
  let itemCount: number;
  try {
    const run = await runActor(url, apifyToken);
    items = run.items;
    itemCount = run.count;
  } catch (e) {
    // Transport/auth/quota/timeout — record NOTHING to media columns; leave the
    // attempt burned so the drain retries with backoff (or terminates at max).
    const st = finalCaptureStatus({ landedAny: false, attempts: attemptsAfter });
    await supabase.from("creatives")
      .update({ apify_capture_status: st.status })
      .eq("ad_id", adId).eq("account_id", accountId);
    // No confirmed billed item on a failed transport — do not charge.
    return jsonResponse({ ad_id: adId, status: "failed", reason: "actor_error", detail: (e as Error).message }, 502);
  }

  // -- Charge actual usage (a single ?id= lookup bills exactly one item, even
  //     when empty). ---------------------------------------------------------
  const spendUsd = computeSpendUsd(itemCount);
  await supabase.rpc("add_apify_spend", { p_day: day, p_usd: spendUsd }).then(
    () => {},
    (e: unknown) => console.error(`[${adId}] add_apify_spend failed:`, (e as Error)?.message ?? e),
  );

  // -- Parse + download + store ---------------------------------------------
  const parsed = parseApifyCaptureResult(items);

  let videoAsset: CapturedAsset | null = null;
  let imageAsset: CapturedAsset | null = null;
  if (parsed.video) {
    videoAsset = await downloadAndStore(supabase, VIDEO_BUCKET, accountId, adId, parsed.video, "video");
  }
  if (parsed.image) {
    imageAsset = await downloadAndStore(supabase, THUMB_BUCKET, accountId, adId, parsed.image, "image");
  }

  // Carousel frames (AC#4 "frames"): link pending creative_frames image assets.
  let framesLinked = 0;
  if (parsed.isCarousel) {
    framesLinked = await backfillCarouselFrames(supabase, adId, accountId, parsed.cards);
  }

  // -- AC#4: plan the creatives update (never overwrite owned urls; sentinel-safe) --
  const mediaUpdate = planCreativeMediaUpdate(
    { video_url: creative.video_url, full_res_url: creative.full_res_url },
    { video: videoAsset, image: imageAsset },
  );
  const landedAny = Object.keys(mediaUpdate).length > 0 || framesLinked > 0;

  const status = finalCaptureStatus({ landedAny, attempts: attemptsAfter });
  const finalUpdate: Record<string, unknown> = { ...mediaUpdate, apify_capture_status: status.status };
  await supabase.from("creatives")
    .update(finalUpdate)
    .eq("ad_id", adId).eq("account_id", accountId);

  return jsonResponse({
    ad_id: adId,
    status: status.status === "captured" ? "captured" : (parsed.empty ? "no_items" : status.status),
    reason: landedAny ? undefined : (parsed.empty ? "no_items" : "no_media"),
    captured: {
      video: !!mediaUpdate.video_url,
      image: !!mediaUpdate.full_res_url,
      frames_linked: framesLinked,
    },
    attempts: attemptsAfter,
    billed_items: itemCount,
    spend_usd: spendUsd,
    day,
  });
}

// Guard the network bind so tests can import the module without serving.
if (!Deno.env.get("APIFY_CAPTURE_NO_SERVE")) {
  serve(handler);
}
