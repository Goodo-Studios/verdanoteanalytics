import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  assetStoragePath,
  computeContentHash,
  discoverImageUrl,
  discoverVideoUrl,
  fetchAccountVideoMap,
  fetchWithTimeout,
  looksLikeHtml,
  NO_THUMB_SENTINEL,
  NO_VIDEO_SENTINEL,
  resolveMetaToken,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// The env secret is NOT set on this project — token is resolved per-request with a
// DB-settings fallback (see handler). Read it here without the `!` non-null assert
// so an unset secret is `undefined`, not a lie the type system believes.
const ENV_META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
const THUMB_BUCKET = "ad-thumbnails";
const VIDEO_BUCKET = "ad-videos";
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;

// A cached asset: the shared per-account stored copy plus its media_assets row id
// so the calling creative can reference it (US-009 within-account dedupe).
interface CachedAsset {
  publicUrl: string;
  assetId: string;
}

/**
 * Download media and store it ONCE per unique creative within the account
 * (US-009). Flow:
 *   1. Fetch bytes and run the existing non-media / HTML guards.
 *   2. Hash the bytes (SHA-256) → asset_key. This is the within-account dedupe key.
 *   3. If media_assets already holds (account_id, asset_key), the copy is already
 *      stored → NO-OP DOWNLOAD-to-storage: reuse the existing storage_path/public_url
 *      and row id. (The re-fetch above is unavoidable to obtain the hash, but no
 *      second copy is ever written to storage and no per-ad file is created.)
 *   4. Otherwise store the bytes at an ASSET-keyed path — <account>/assets/<hash>.<ext>
 *      (never per-ad) — and register the media_assets row.
 *
 * Tenant boundary: account_id scopes both the media_assets lookup AND the storage
 * path, so the same creative in two accounts stores one copy per account — no
 * cross-account sharing.
 */
async function downloadAndCache(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  accountId: string,
  adId: string,
  url: string,
  type: "image" | "video"
): Promise<CachedAsset | null> {
  try {
    const resp = await fetchWithTimeout(url, 60_000);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    if (type === "image" && buffer.byteLength < 5000) return null;
    if (type === "video" && buffer.byteLength > MAX_VIDEO_SIZE) return null;
    const contentType =
      resp.headers.get("content-type") ??
      (type === "video" ? "video/mp4" : "image/jpeg");
    // Guard: never store a non-media payload (e.g. a text/html ad page) as an asset.
    if (!isMediaContentType(contentType, type)) {
      console.log(`Refusing to cache ${type} for ${adId}: non-${type} content (${contentType})`);
      return null;
    }
    // Magic-byte guard: an HTML login/error page can slip past the content-type
    // check (Meta sometimes serves it as application/octet-stream). Sniff the
    // leading bytes so a page is never stored as an asset.
    if (looksLikeHtml(new Uint8Array(buffer))) {
      console.log(`Refusing to cache ${type} for ${adId}: HTML page bytes (content-type ${contentType})`);
      return null;
    }

    // ── Within-account dedupe key ────────────────────────────────────────────
    const assetKey = await computeContentHash(buffer);

    // Already stored for this account? Reuse — no second copy, no per-ad file.
    const { data: existing } = await supabase
      .from("media_assets")
      .select("id, public_url")
      .eq("account_id", accountId)
      .eq("asset_key", assetKey)
      .maybeSingle() as { data: { id: string; public_url: string } | null };
    if (existing?.id && existing?.public_url) {
      console.log(`[${adId}] Dedupe hit: reusing ${type} asset ${assetKey.slice(0, 12)}… for account ${accountId} (no re-download to storage)`);
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
    // Asset-keyed path (NOT per-ad): every ad reusing this creative maps here.
    const path = assetStoragePath(accountId, assetKey, ext);
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, new Uint8Array(buffer), { contentType, upsert: true });
    if (error) return null;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

    // Register the asset. ON CONFLICT (account_id, asset_key) makes a concurrent
    // caller's insert a safe no-op — we re-select to return the winning row's id.
    const { data: upserted, error: assetErr } = await supabase
      .from("media_assets")
      .upsert(
        {
          account_id: accountId,
          asset_key: assetKey,
          media_type: type,
          bucket,
          storage_path: path,
          public_url: publicUrl,
          byte_size: buffer.byteLength,
          content_type: contentType,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "account_id,asset_key" }
      )
      .select("id, public_url")
      .maybeSingle() as {
        data: { id: string; public_url: string } | null;
        error: { message: string } | null;
      };
    if (assetErr || !upserted?.id) {
      // Registry write failed but bytes are stored — still return the URL so the
      // creative renders; asset linkage is best-effort and re-attempted next run.
      console.log(`[${adId}] media_assets upsert failed (${assetErr?.message ?? "no row"}) — returning storage URL without asset id`);
      return { publicUrl, assetId: "" };
    }
    return { publicUrl: upserted.public_url, assetId: upserted.id };
  } catch {
    return null;
  }
}

const isStorageUrl = (url: string | null): boolean =>
  !!url?.includes("/storage/v1/object/public/");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let ad_id: string, account_id: string;
  try {
    const body = await req.json();
    ad_id = body.ad_id;
    account_id = body.account_id;
    if (!ad_id || !account_id) throw new Error("Missing ad_id or account_id");
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: creative, error: fetchErr } = await supabase
    .from("creatives")
    .select("ad_id, account_id, thumbnail_url, full_res_url, video_url, thumb_asset_id, video_asset_id")
    .eq("ad_id", ad_id)
    .single();

  if (fetchErr || !creative) {
    return new Response(JSON.stringify({ error: "Creative not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // string columns (urls) + nullable asset-id FKs (US-009 dedupe references).
  const updates: Record<string, string | null> = {};

  // Skip flags (hoisted): don't re-discover media already cached to storage or
  // confirmed absent (sentinel). Re-run discovery only for null / stale CDN URLs.
  const skipImage =
    creative.thumbnail_url === NO_THUMB_SENTINEL ||
    isStorageUrl(creative.thumbnail_url);
  const skipVideo =
    creative.video_url === NO_VIDEO_SENTINEL ||
    isStorageUrl(creative.video_url);
  const willDiscover = !skipImage || !skipVideo;

  // ── Resolve the Meta token: env secret first, then settings.meta_access_token
  // (same fallback as sync / backfill-play-curves). This function historically
  // read ONLY the env secret — which is NOT set on this project — so it passed
  // `undefined` to the Graph API, EVERY discovery call returned 400, and the row
  // was poisoned with a no-thumbnail / no-video sentinel. Those sentinels then
  // permanently block re-discovery AND make vault-save-creative fail with
  // "Saved 0, 1 failed" (no media to copy). Abort WITHOUT writing sentinels when
  // no token is available, so a token outage can never be mistaken for "no media".
  let metaToken = resolveMetaToken(ENV_META_TOKEN, null);
  if (!metaToken && willDiscover) {
    const { data: tokenRow } = await supabase
      .from("settings").select("value").eq("key", "meta_access_token").single();
    metaToken = resolveMetaToken(ENV_META_TOKEN, tokenRow?.value as string | undefined);
  }
  if (!metaToken && willDiscover) {
    console.error(`[${ad_id}] No Meta access token (env or settings) — aborting without poisoning row`);
    return new Response(
      JSON.stringify({ error: "No Meta access token configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Image ────────────────────────────────────────────────────────────────
  if (!skipImage) {
    console.log(`[${ad_id}] Discovering image...`);
    const result = await discoverImageUrl(ad_id, account_id, metaToken!);
    if (result?.thumbnailUrl) {
      const asset = await downloadAndCache(
        supabase, THUMB_BUCKET, account_id, ad_id, result.thumbnailUrl, "image"
      );
      if (asset) {
        updates.thumbnail_url = asset.publicUrl;
        updates.full_res_url = asset.publicUrl;
        if (asset.assetId) updates.thumb_asset_id = asset.assetId;
      } else {
        // Download failed — store CDN URL as fallback so modal has something
        if (!creative.thumbnail_url) updates.thumbnail_url = result.thumbnailUrl;
        if (result.fullResUrl) updates.full_res_url = result.fullResUrl;
      }
    } else {
      // Discovery found nothing — mark sentinel so we don't retry on every open
      updates.thumbnail_url = NO_THUMB_SENTINEL;
    }
  }

  // ── Video ────────────────────────────────────────────────────────────────
  if (!skipVideo) {
    if (creative.video_url) {
      // Already have a CDN URL — try to cache it to storage first.
      console.log(`[${ad_id}] Caching existing CDN video URL to storage...`);
      const asset = await downloadAndCache(
        supabase, VIDEO_BUCKET, account_id, ad_id, creative.video_url, "video"
      );
      if (asset) {
        updates.video_url = asset.publicUrl;
        if (asset.assetId) updates.video_asset_id = asset.assetId;
      } else {
        // CDN URL is expired or undownloadable — fall through to full re-discovery
        // so we get a fresh URL rather than silently returning a stale one that
        // vault-save-creative's copyMedia will also fail to download (→ 500).
        console.log(`[${ad_id}] CDN video URL download failed — attempting re-discovery...`);
        const accountVideoMap = await fetchAccountVideoMap(account_id, metaToken!);
        const freshUrl = await discoverVideoUrl(ad_id, metaToken!, 30_000, accountVideoMap);
        if (freshUrl && freshUrl !== NO_VIDEO_SENTINEL) {
          const freshAsset = await downloadAndCache(
            supabase, VIDEO_BUCKET, account_id, ad_id, freshUrl, "video"
          );
          // Use storage URL if caching succeeded, otherwise use the fresh CDN URL.
          // Either is better than the expired original — don't write the sentinel
          // (that would permanently block future re-discovery for a video that exists).
          updates.video_url = freshAsset?.publicUrl ?? freshUrl;
          if (freshAsset?.assetId) updates.video_asset_id = freshAsset.assetId;
        }
        // If re-discovery also failed, don't update — preserve the expired CDN URL
        // as-is rather than poisoning the row with a sentinel.
      }
    } else {
      // No URL yet — run full discovery then cache.
      console.log(`[${ad_id}] Discovering video...`);
      // Build account video map so page-owned videos are discoverable despite (#10) permission errors.
      const accountVideoMap = await fetchAccountVideoMap(account_id, metaToken!);
      const videoUrl = await discoverVideoUrl(ad_id, metaToken!, 30_000, accountVideoMap);
      if (videoUrl && videoUrl !== NO_VIDEO_SENTINEL) {
        const asset = await downloadAndCache(
          supabase, VIDEO_BUCKET, account_id, ad_id, videoUrl, "video"
        );
        // Use storage URL if download succeeded, otherwise fall back to CDN URL
        updates.video_url = asset?.publicUrl ?? videoUrl;
        if (asset?.assetId) updates.video_asset_id = asset.assetId;
      } else {
        // Only set sentinel for null video_url (never tried before) — discovery found nothing
        updates.video_url = NO_VIDEO_SENTINEL;
      }
    }
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await supabase
      .from("creatives")
      .update(updates)
      .eq("ad_id", ad_id)
      .eq("account_id", account_id);
    if (updateErr) console.error(`[${ad_id}] Update failed:`, updateErr.message);
  }

  return new Response(
    JSON.stringify({
      ad_id,
      thumbnail_url: updates.thumbnail_url ?? creative.thumbnail_url,
      full_res_url: updates.full_res_url ?? creative.full_res_url,
      video_url: updates.video_url ?? creative.video_url,
      cached: Object.keys(updates).length > 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
