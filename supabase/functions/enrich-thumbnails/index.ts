import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  discoverImageUrl,
  discoverVideoUrl,
  fetchAccountVideoMap,
  fetchWithTimeout,
  looksLikeHtml,
  NO_THUMB_SENTINEL,
  NO_VIDEO_SENTINEL,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";


const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
const BATCH_SIZE = 20;
const TIME_BUDGET_MS = 115_000;
const MAX_ITEMS = 1000;
// Per-Graph-fetch timeout for bulk video discovery. Was 8s, which falsely failed
// real videos: discoverVideoUrl makes up to ~6 sequential Graph calls and the
// page-owned-video fallback strategies are routinely slower than 8s, so a valid
// video would abort mid-discovery → `no-video` sentinel (observed recovering ~48
// Cane Masters sentinels once re-discovered with more headroom). 15s clears the
// slow-but-valid responses. Not pushed to the modal path's 30s: a batch of
// BATCH_SIZE runs in parallel and a fully-failing creative costs ~6×timeout, so
// 30s risks one bad creative blowing the 115s TIME_BUDGET_MS; 15s keeps worst-case
// (~90s) inside budget while the retry-backoff handles anything still missed.
const VIDEO_DISCOVERY_TIMEOUT_MS = 15_000;
// Memory-safe cap for video caching. An edge function has ~256 MB; the old code buffered
// the entire file via blob().arrayBuffer() (plus a transient copy) before any size check,
// which OOM'd the worker on large videos (546 WORKER_RESOURCE_LIMIT). We now stream-read
// with an early abort so a single video never exceeds this footprint; oversized videos
// keep their live CDN url (still playable) instead of being cached.
// 64 MB cap. readBodyCapped now does a single arrayBuffer() read (no 2× concat
// buffer), so peak ≈ filesize + one upload copy. 64 MB stays safely under the 256 MB
// worker limit while caching the large majority of ad videos; anything bigger keeps
// its CDN url (still previewable) rather than risking WORKER_RESOURCE_LIMIT.
const MAX_VIDEO_SIZE = 64 * 1024 * 1024;

// Exponential backoff for sentinel retries (hours): 1h → 4h → 12h → 1d → 3d → 7d cap.
// Mirrors refresh-thumbnails so a sentinel written by either path carries the same TTL and
// neither path re-hammers a genuinely-dead creative — but every transient failure self-heals.
const RETRY_BACKOFF_HOURS = [1, 4, 12, 24, 72, 168];
export function nextRetryAfter(retryCount: number): string {
  const idx = Math.min(Math.max(retryCount - 1, 0), RETRY_BACKOFF_HOURS.length - 1);
  return new Date(Date.now() + RETRY_BACKOFF_HOURS[idx] * 60 * 60 * 1000).toISOString();
}

/**
 * Read a Response body into memory but ABORT as soon as it exceeds `maxBytes`.
 * Returns the bytes, or null if the file is over the cap.
 */
async function readBodyCapped(resp: Response, maxBytes: number): Promise<Uint8Array | null> {
  const lenHeader = resp.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > maxBytes) {
    await resp.body?.cancel().catch(() => {});
    return null;
  }
  // When the length is known and within cap, a SINGLE arrayBuffer() read avoids the
  // chunk-accumulate + concat double-buffer below (≈2× memory) that OOMs the worker.
  // Most CDN responses carry content-length, so this is the common, memory-safe path.
  if (lenHeader) {
    const buf = new Uint8Array(await resp.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }
  const reader = resp.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await resp.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

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
    // Guard: never store a non-image payload (e.g. a text/html ad page) as <adId>.jpg.
    if (!isMediaContentType(contentType, "image")) {
      console.log(`Refusing to cache image for ${adId}: non-image content (${contentType})`);
      return null;
    }
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const storagePath = `${accountId}/${adId}.${ext}`;

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Magic-byte guard: a text/html (or octet-stream-disguised) login/error page
    // passes the content-type check above but is not an image. Sniff leading bytes.
    if (looksLikeHtml(uint8)) {
      console.log(`Refusing to cache image for ${adId}: HTML page bytes (content-type ${contentType})`);
      return null;
    }

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

export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // serve() invokes handler(req, connInfo); connInfo is truthy but has no `.from`,
  // so only accept an override that actually looks like a Supabase client.
  const isClient = (o: unknown): boolean =>
    !!o && typeof (o as { from?: unknown }).from === "function";
  // deno-lint-ignore no-explicit-any
  const supabase: any = isClient(supabaseOverride)
    ? supabaseOverride
    : createClient(
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

    // ── Discovery phases ──────────────────────────────────────────────────
    // Populate thumbnail_url / video_url with freshly-discovered CDN urls.
    // These MUST run before the caching phases: caching downloads whatever CDN
    // url discovery just wrote. The previous ordering ran video caching before
    // video discovery for scope=all, so on a fresh account video_url was still
    // null when caching ran (nothing to cache); discovery then wrote a raw CDN
    // url that never got cached that pass and expired before the next run.
    if (scope === "discover" || scope === "all") {
      await runDiscovery(supabase, accountFilter, metaAccessToken);
    }

    if (scope === "video" || scope === "all") {
      await runVideoDiscovery(supabase, accountFilter, metaAccessToken);
    }

    // ── Caching phases ────────────────────────────────────────────────────
    // Download the discovered CDN urls into permanent Supabase Storage before
    // they expire.
    if (scope === "cache") {
      await runCaching(supabase, accountFilter);
      const videoSummary = await runVideoCaching(supabase, accountFilter);

      // Self-chaining drain. A full batch (we processed the whole VIDEO_CACHE_LIMIT)
      // means more un-cached CDN videos almost certainly remain. Chain a FRESH cache
      // invocation — a new worker with fresh memory, which sidesteps the OOM
      // (WORKER_RESOURCE_LIMIT) that a single large batch causes — so an account of
      // any size caches FULLY in one pass, before its freshly-discovered CDN urls
      // expire. This is the core fix that stops the "discovered but never cached →
      // url expires → stuck" failure from recurring on initial sync. Bounded by
      // MAX_CACHE_CHAIN; disabled under ENRICH_NO_CHAIN for tests.
      const chainDepth = Number(url.searchParams.get("cache_chain") || "0");
      const batchWasFull = videoSummary.cached + videoSummary.failed >= VIDEO_CACHE_LIMIT;
      if (batchWasFull && chainDepth < MAX_CACHE_CHAIN && !Deno.env.get("ENRICH_NO_CHAIN")) {
        const nextUrl =
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/enrich-thumbnails?scope=cache&cache_chain=${chainDepth + 1}` +
          (accountFilter ? `&account_id=${encodeURIComponent(accountFilter)}` : "");
        fetch(nextUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
        }).catch((e: Error) => console.error("enrich-thumbnails cache-drain chain error:", e.message));
      }

      return new Response(
        JSON.stringify({ status: "completed", scope, video: videoSummary, chainDepth }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // scope=all chains caching into a SEPARATE invocation rather than running it
    // inline. Discovery + caching in one invocation risks the edge function's
    // ~150s wall-time limit starving the heavy, last video-caching phase — which
    // would again leave a freshly-discovered CDN url uncached until it expires.
    // A fresh invocation gives caching its own full budget. Disabled in tests via
    // ENRICH_NO_CHAIN so the chain fetch doesn't fire against a live URL.
    if (scope === "all" && !Deno.env.get("ENRICH_NO_CHAIN")) {
      const chainUrl =
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/enrich-thumbnails?scope=cache` +
        (accountFilter ? `&account_id=${encodeURIComponent(accountFilter)}` : "");
      fetch(chainUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
      }).catch((e: Error) => console.error("enrich-thumbnails cache-chain error:", e.message));
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

    // repair: heal POISONED rows — ones whose thumbnail_url/video_url is a valid
    // storage URL but the object behind it is an HTML error/login page (saved as
    // .jpg/.mp4 with a lying content-type). The normal pipeline treats any storage
    // URL as "done" and never re-fetches, so these stay permanently broken. Repair
    // validates each storage object's bytes, deletes poisoned objects, NULLs the
    // media columns + storage path + resets retry counters, then chains a fresh
    // scope=all run so the guarded discovery+caching phases repopulate clean media.
    if (scope === "repair") {
      const repaired = await runRepair(supabase, accountFilter);
      if (repaired > 0 && !Deno.env.get("ENRICH_NO_CHAIN")) {
        const chainUrl =
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/enrich-thumbnails?scope=all` +
          (accountFilter ? `&account_id=${encodeURIComponent(accountFilter)}` : "");
        fetch(chainUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
        }).catch((e: Error) => console.error("enrich-thumbnails repair-chain error:", e.message));
      }
      return new Response(
        JSON.stringify({ status: "completed", scope, repaired }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
}

// Register the HTTP handler in production. Guarded so that unit tests can import
// the phase functions below without `serve()` starting a listener on import.
if (!Deno.env.get("ENRICH_NO_SERVE")) {
  serve(handler);
}

/**
 * Phase 1: Discover CDN URLs for creatives with null thumbnail_url.
 *
 * NOTE: media-selection queries intentionally do NOT filter on `impressions > 0`.
 * Creatives with 0/null impressions are still rendered in the ad library, so they
 * must get thumbnails/videos too — otherwise they show as permanently broken cards.
 * Each row is processed once then skipped via its own skip-gate (thumbnail_url IS NULL,
 * thumbnail_storage_path IS NULL, etc.), so removing the gate is bounded, one-time work.
 */
export async function runDiscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  const nowIso = new Date().toISOString();
  // Pick up NULL thumbnails (never tried) AND sentinels whose backoff window is due.
  // Sentinels still inside their window are skipped so dead creatives aren't re-hammered.
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id, thumb_retry_count")
    .or(`thumbnail_url.is.null,thumbnail_url.eq.${NO_THUMB_SENTINEL}`)
    .or(`thumb_retry_after.is.null,thumb_retry_after.lte.${nowIso}`);
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
      .select("ad_id, account_id, thumb_retry_count")
      .or(`thumbnail_url.is.null,thumbnail_url.eq.${NO_THUMB_SENTINEL}`)
      .or(`thumb_retry_after.is.null,thumb_retry_after.lte.${nowIso}`)
      .or("spend.is.null,spend.eq.0");
    if (accountFilter) zeroQuery = zeroQuery.eq("account_id", accountFilter);
    const { data: zeroSpend } = await zeroQuery.limit(remaining);
    if (zeroSpend) items = [...items, ...zeroSpend];
  }

  if (items.length === 0) {
    console.log("Discovery: No null/due-sentinel thumbnail creatives to enrich.");
    return;
  }

  console.log(`Discovery: ${items.length} thumbnail creatives to enrich (account: ${accountFilter || "all"})`);

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
          // Success — clear the backoff bookkeeping so a future regression starts fresh.
          await supabase.from("creatives")
            .update({ thumbnail_url: result.thumbnailUrl, thumb_retry_count: 0, thumb_retry_after: null })
            .eq("ad_id", c.ad_id);
          return "enriched";
        } else {
          // Failure — write sentinel + advance the backoff window so it's retried later, not forever.
          const nextCount = (c.thumb_retry_count ?? 0) + 1;
          await supabase.from("creatives")
            .update({ thumbnail_url: NO_THUMB_SENTINEL, thumb_retry_count: nextCount, thumb_retry_after: nextRetryAfter(nextCount) })
            .eq("ad_id", c.ad_id);
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
export async function runCaching(supabase: any, accountFilter: string | null) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id, thumbnail_url, full_res_url")
    .not("thumbnail_url", "is", null)
    .neq("thumbnail_url", NO_THUMB_SENTINEL)
    .is("thumbnail_storage_path", null);
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
export async function runVideoDiscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  const nowIso = new Date().toISOString();
  // Pick up NULL video_url (never tried) AND sentinels whose backoff window is due.
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id, video_retry_count")
    .or(`video_url.is.null,video_url.eq.${NO_VIDEO_SENTINEL}`)
    .or(`video_retry_after.is.null,video_retry_after.lte.${nowIso}`);
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
      .select("ad_id, account_id, video_retry_count")
      .or(`video_url.is.null,video_url.eq.${NO_VIDEO_SENTINEL}`)
      .or(`video_retry_after.is.null,video_retry_after.lte.${nowIso}`)
      .or("spend.is.null,spend.eq.0");
    if (accountFilter) zeroQuery = zeroQuery.eq("account_id", accountFilter);
    const { data: zeroSpend } = await zeroQuery.limit(remaining);
    if (zeroSpend) items = [...items, ...zeroSpend];
  }

  if (items.length === 0) {
    console.log("Video discovery: No null/due-sentinel video creatives to enrich.");
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
          const videoUrl = await discoverVideoUrl(c.ad_id, metaAccessToken, VIDEO_DISCOVERY_TIMEOUT_MS, accountVideoMap);
          if (videoUrl) {
            await supabase.from("creatives")
              .update({ video_url: videoUrl, video_retry_count: 0, video_retry_after: null })
              .eq("ad_id", c.ad_id);
            return "found";
          } else {
            const nextCount = (c.video_retry_count ?? 0) + 1;
            await supabase.from("creatives")
              .update({ video_url: NO_VIDEO_SENTINEL, video_retry_count: nextCount, video_retry_after: nextRetryAfter(nextCount) })
              .eq("ad_id", c.ad_id);
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
export async function runForcedRediscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .eq("thumbnail_url", NO_THUMB_SENTINEL);
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
            .update({ thumbnail_url: result.thumbnailUrl, full_res_url: result.fullResUrl || result.thumbnailUrl, thumbnail_storage_path: null, thumb_retry_count: 0, thumb_retry_after: null })
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
export async function runVideoRediscovery(supabase: any, accountFilter: string | null, metaAccessToken: string) {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id")
    .eq("video_url", NO_VIDEO_SENTINEL);
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
          const videoUrl = await discoverVideoUrl(c.ad_id, metaAccessToken, VIDEO_DISCOVERY_TIMEOUT_MS, accountVideoMap);
          if (videoUrl) {
            await supabase.from("creatives")
              .update({ video_url: videoUrl, video_retry_count: 0, video_retry_after: null })
              .eq("ad_id", c.ad_id);
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
 * Download a video and upload it to Supabase Storage (ad-videos bucket).
 * Returns the permanent public URL, or null on any failure.
 *
 * Sequential callers only — videos can be 50 MB+; parallel downloads exhaust
 * Deno's 256 MB memory limit.
 */
// Discriminated result so the caller can tell WHY a cache attempt failed and act
// on it (e.g. re-discover an expired CDN url). `reason` is undefined on success.
export type VideoCacheReason =
  | "expired"      // CDN responded non-2xx — the time-limited fbcdn url is dead
  | "non-video"    // content-type is not a video payload
  | "too-large"    // exceeds MAX_VIDEO_SIZE
  | "html"         // magic bytes are an HTML page (content-type lied)
  | "upload-error" // storage upload failed
  | "exception";   // network/other throw
export interface VideoCacheResult { url: string | null; reason?: VideoCacheReason }

async function cacheVideoToStorage(
  supabase: any,
  videoUrl: string,
  accountId: string,
  adId: string
): Promise<VideoCacheResult> {
  try {
    const res = await fetchWithTimeout(videoUrl, 60_000); // generous timeout for large files
    if (!res.ok) { await res.text(); return { url: null, reason: "expired" }; }

    const contentType = res.headers.get("content-type") || "video/mp4";
    // Guard: never store a non-video payload (e.g. a text/html ad page) as <adId>.mp4.
    if (!isMediaContentType(contentType, "video")) {
      console.log(`Refusing to cache video for ${adId}: non-video content (${contentType})`);
      return { url: null, reason: "non-video" };
    }
    const storagePath = `${accountId}/${adId}.mp4`;

    const uint8 = await readBodyCapped(res, MAX_VIDEO_SIZE);
    if (!uint8) {
      console.log(`Skipping over-cap video for ${adId} (> ${(MAX_VIDEO_SIZE / 1024 / 1024).toFixed(0)}MB) — keeping CDN url`);
      return { url: null, reason: "too-large" };
    }

    // Magic-byte guard: reject an HTML page served as a video (content-type lies).
    if (looksLikeHtml(uint8)) {
      console.log(`Refusing to cache video for ${adId}: HTML page bytes (content-type ${contentType})`);
      return { url: null, reason: "html" };
    }

    const { error: uploadError } = await supabase.storage
      .from("ad-videos")
      .upload(storagePath, uint8, { contentType, upsert: true });

    if (uploadError) {
      console.error(`Video storage upload error for ${adId}:`, uploadError.message);
      return { url: null, reason: "upload-error" };
    }

    const { data: publicData } = supabase.storage.from("ad-videos").getPublicUrl(storagePath);
    return {
      url: publicData?.publicUrl ||
        `${SUPABASE_URL_ENV}/storage/v1/object/public/ad-videos/${storagePath}`,
    };
  } catch (e) {
    console.error(`Cache video to storage error for ${adId}:`, e);
    return { url: null, reason: "exception" };
  }
}

/**
 * Phase 4: Cache CDN video URLs to permanent Supabase Storage.
 *
 * Targets creatives with a live CDN video_url (not null, not sentinel, not already
 * a storage URL). Processes a small batch sequentially — videos are large files and
 * parallel downloads would hit Deno's 256 MB memory cap.
 *
 * Once cached, video_url is updated to the storage URL so subsequent syncs skip the
 * row (the storage-URL check in the query excludes already-cached items).
 */
// Per-invocation video cache batch size. Kept SMALL on purpose: although caching
// is sequential, each ≤150 MB video buffer is not reclaimed fast enough across many
// iterations, so a large batch (e.g. 100) drives the worker into Deno's 256 MB
// ceiling → WORKER_RESOURCE_LIMIT kill mid-pass. Volume is handled instead by the
// self-chaining drain (see scope=cache handler): each chained invocation is a fresh
// worker with fresh memory, so an account of any size caches fully without OOM —
// and crucially before its freshly-discovered CDN urls expire.
// Just 2 videos per invocation. Even at the 64MB cap, 8 sequential large videos
// accumulated faster than Deno GC could reclaim and OOM'd the 256MB worker
// (WORKER_RESOURCE_LIMIT) — caching 0 and stalling the queue. Throughput instead
// comes from PARALLELISM: a cron fans out one account-scoped cache worker per active
// account every 2 min, so ~N_accounts × 2 videos cache per tick with each worker's
// peak memory bounded to ~2×64MB.
const VIDEO_CACHE_LIMIT = 2;
// Safety bound on the cache self-chain depth. 20 videos/chain × 40 ≈ 800 videos per
// drain — covers the largest accounts while preventing a runaway chain loop.
const MAX_CACHE_CHAIN = 60;

export interface VideoCachingSummary {
  cached: number;
  failed: number;
  reDiscoverQueued: number;
  reasons: Record<string, number>;
}

export async function runVideoCaching(
  supabase: any,
  accountFilter: string | null
): Promise<VideoCachingSummary> {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id, video_url")
    .not("video_url", "is", null)
    .neq("video_url", NO_VIDEO_SENTINEL)
    .not("video_url", "like", "%/storage/v1/object/public/%");
  if (accountFilter) query = query.eq("account_id", accountFilter);

  const { data: items } = await query
    .order("spend", { ascending: false })
    .limit(VIDEO_CACHE_LIMIT);

  const summary: VideoCachingSummary = { cached: 0, failed: 0, reDiscoverQueued: 0, reasons: {} };

  if (!items?.length) {
    console.log("Video caching: No CDN video URLs need storage caching.");
    return summary;
  }

  console.log(`Video caching: ${items.length} CDN video URLs to cache (account: ${accountFilter || "all"})`);

  const startTime = Date.now();

  // Sequential — videos can be 50 MB+; parallel downloads exhaust Deno's 256 MB memory limit.
  for (const c of items) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log("Video caching budget exceeded.");
      break;
    }

    const result = await cacheVideoToStorage(supabase, c.video_url, c.account_id, c.ad_id);
    if (result.url) {
      await supabase.from("creatives").update({ video_url: result.url }).eq("ad_id", c.ad_id);
      summary.cached++;
    } else {
      summary.failed++;
      const reason = result.reason ?? "unknown";
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;

      // Self-heal a dead CDN url. A non-2xx response means the time-limited fbcdn
      // url has expired — the row is now permanently stuck: video caching can't
      // download it, and video discovery skips it (its video_url is non-null and
      // not a sentinel). NULL it + reset the retry window so the next discovery
      // pass re-fetches a fresh url, which the chained cache phase then stores.
      // This closes the same "looks-set-but-broken" gap that the poison repair
      // closed for storage objects, here for stale CDN urls.
      if (reason === "expired") {
        await supabase
          .from("creatives")
          .update({ video_url: null, video_retry_count: 0, video_retry_after: null })
          .eq("ad_id", c.ad_id);
        summary.reDiscoverQueued++;
      }
    }
  }

  console.log(
    `Video caching done: ${summary.cached} cached, ${summary.failed} failed ` +
    `(${summary.reDiscoverQueued} expired→requeued), reasons: ${JSON.stringify(summary.reasons)}`
  );
  return summary;
}

// ── Repair phase ────────────────────────────────────────────────────────────

const isStorageUrl = (url: string | null | undefined): boolean =>
  typeof url === "string" && url.includes("/storage/v1/object/public/");

/**
 * Split a Supabase public storage URL into its bucket + object key so the object
 * can be deleted. Strips any query string. Returns null for non-storage URLs.
 */
export function parseStoragePublicUrl(
  url: string,
): { bucket: string; path: string } | null {
  const marker = "/storage/v1/object/public/";
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const rest = url.slice(i + marker.length).split("?")[0];
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

/**
 * Validate that a stored media object is actually media — not an HTML error/login
 * page saved with a lying content-type. Fetches only the leading bytes (Range) so
 * a video isn't fully downloaded just to be checked.
 *
 * Returns:
 *   "poison"  — confirmed HTML/text, safe to delete + re-discover.
 *   "ok"      — confirmed real media bytes, leave it alone.
 *   "unknown" — fetch failed (network/transient); do NOT touch the row, so a blip
 *               can never destroy a healthy cached asset.
 */
export async function validateStorageObject(
  url: string,
): Promise<"poison" | "ok" | "unknown"> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Range: "bytes=0-511" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok && res.status !== 206) {
      await res.body?.cancel().catch(() => {});
      return "unknown";
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (looksLikeHtml(buf)) return "poison";
    if (ct.startsWith("text/") || ct.includes("html") || ct.includes("json")) return "poison";
    return "ok";
  } catch {
    return "unknown";
  }
}

/**
 * Repair phase: heal creatives whose cached media is a poisoned storage object
 * (HTML page stored as .jpg/.mp4). For each poisoned object: delete it from the
 * bucket, then NULL the media column(s) + thumbnail_storage_path + reset retry
 * bookkeeping so runDiscovery / runCaching re-fetch clean media. Returns the
 * number of rows repaired (so the caller can decide whether to chain a refill).
 */
export async function runRepair(supabase: any, accountFilter: string | null): Promise<number> {
  let query = supabase
    .from("creatives")
    .select("ad_id, account_id, thumbnail_url, video_url, full_res_url, thumbnail_storage_path")
    .or(
      "thumbnail_url.like.%/storage/v1/object/public/%,video_url.like.%/storage/v1/object/public/%",
    );
  if (accountFilter) query = query.eq("account_id", accountFilter);

  const { data: items } = await query
    .order("spend", { ascending: false })
    .limit(MAX_ITEMS);

  if (!items?.length) {
    console.log("Repair: No storage-cached creatives to validate.");
    return 0;
  }

  console.log(`Repair: validating ${items.length} storage-cached creatives (account: ${accountFilter || "all"})`);

  const startTime = Date.now();
  let repaired = 0, ok = 0, unknown = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Repair budget exceeded at item ${i}. Skipping rest.`);
      break;
    }

    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (c: any) => {
        // deno-lint-ignore no-explicit-any
        const updates: Record<string, any> = {};

        if (isStorageUrl(c.thumbnail_url)) {
          const verdict = await validateStorageObject(c.thumbnail_url);
          if (verdict === "poison") {
            const parsed = parseStoragePublicUrl(c.thumbnail_url);
            if (parsed) await supabase.storage.from(parsed.bucket).remove([parsed.path]).catch(() => {});
            updates.thumbnail_url = null;
            updates.thumbnail_storage_path = null;
            updates.thumb_retry_count = 0;
            updates.thumb_retry_after = null;
            // full_res_url commonly mirrors the poisoned storage URL — null it too
            // (caching only refills full_res_url when it's null). Leave a genuine
            // higher-res CDN url intact.
            if (isStorageUrl(c.full_res_url)) updates.full_res_url = null;
          } else if (verdict === "unknown") {
            return "unknown";
          }
        }

        if (isStorageUrl(c.video_url)) {
          const verdict = await validateStorageObject(c.video_url);
          if (verdict === "poison") {
            const parsed = parseStoragePublicUrl(c.video_url);
            if (parsed) await supabase.storage.from(parsed.bucket).remove([parsed.path]).catch(() => {});
            updates.video_url = null;
            updates.video_retry_count = 0;
            updates.video_retry_after = null;
          } else if (verdict === "unknown" && Object.keys(updates).length === 0) {
            return "unknown";
          }
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from("creatives").update(updates).eq("ad_id", c.ad_id);
          return "repaired";
        }
        return "ok";
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value === "repaired") repaired++;
        else if (r.value === "ok") ok++;
        else unknown++;
      }
    }
  }

  console.log(`Repair done: ${repaired} repaired, ${ok} ok, ${unknown} unknown/transient`);
  return repaired;
}
