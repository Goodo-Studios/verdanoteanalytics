import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveConvention } from "../_shared/naming-convention.ts";
import { parseAdName, type ParsedAdName, type AdNameTags } from "../_shared/parse-ad-name.ts";
import { resolveTags, type PartialTags } from "../_shared/resolve-tags.ts";
import { parsePlayCurve } from "../_shared/play-curve.ts";
import { RECENT_WINDOW_DAYS, RETENTION_DAYS } from "../_shared/retention-config.ts";
import { extractDestinationLink, normalizeDestinationUrl } from "../_shared/normalize-destination.ts";
import {
  assetStoragePath,
  computeContentHash,
  discoverAllVideoUrls,
  fetchAccountVideoMap,
  isStorageUrl,
  looksLikeHtml,
} from "../_shared/media-discovery.ts";
import { isMediaContentType } from "../_shared/vault-save-logic.ts";

// US-002: Rolling-window incremental daily sync.
//
// A scheduled sync on an already-backfilled account only needs to re-pull a
// rolling recent window (RECENT_WINDOW_DAYS) instead of the full
// date_range_days retention window — Meta daily numbers for a past date freeze
// once the attribution window closes (~7d, safely inside 28d), so historical
// daily rows are immutable and fetched once (by the US-004 backfill). This
// turns a daily update from 180–365 days of Meta calls into ~28.
//
// Safety: the window must comfortably exceed the max gap between daily syncs
// so no day is ever missed. We take max(RECENT_WINDOW_DAYS,
// days-since-last-successful-sync + attribution buffer). RECENT_WINDOW_DAYS=28
// dominates for a healthy daily cadence; the max() only widens the window if a
// sync was skipped for longer than the recent window (e.g. an outage), keeping
// the "always full range to prevent gaps" guarantee without the full-range cost.
export function computeDailyWindowDays(opts: {
  /** true only for a scheduled/incremental sync on an already-backfilled account */
  rollingEligible: boolean;
  /** account.date_range_days-derived full window (fallback / non-rolling path) */
  dateRangeDays: number;
  /** account.last_data_sync ISO string, or null if never synced */
  lastDataSync: string | null;
  /** attribution click window in days, used as the recency buffer */
  clickWindow: number;
  /** injectable clock for tests */
  now?: Date;
}): number {
  const { rollingEligible, dateRangeDays, lastDataSync, clickWindow } = opts;
  // Not eligible for the rolling optimization (initial sync, or account not yet
  // backfilled by US-004): keep the prior full-window behavior so coverage is
  // never silently narrowed before history exists locally.
  if (!rollingEligible) return dateRangeDays;

  const now = opts.now ?? new Date();
  let gapDays = 0;
  if (lastDataSync) {
    const lastMs = new Date(lastDataSync).getTime();
    if (!Number.isNaN(lastMs)) {
      gapDays = Math.ceil((now.getTime() - lastMs) / (24 * 60 * 60 * 1000));
      if (gapDays < 0) gapDays = 0;
    }
  }
  // Recency buffer covers late-arriving conversions still inside the attribution
  // window when the last sync ran.
  const gapWithBuffer = gapDays + Math.max(0, clickWindow);
  const window = Math.max(RECENT_WINDOW_DAYS, gapWithBuffer);
  // Cap at the retention window — history beyond this lives locally (never
  // re-fetched from Meta). We do NOT clamp to date_range_days here: that field
  // was the legacy incremental window (default 14d) and is smaller than the
  // rolling window we now want, so clamping to it would defeat the point.
  return Math.min(window, RETENTION_DAYS);
}

// US-008: Event-driven media cache enqueue helper.
//
// Given the ad_ids in a Phase-1 upsert batch and the set of ad_ids that ALREADY
// existed in public.creatives before this run, return the ad_ids that are NEWLY
// inserted this run — the only ones that should be enqueued for media caching.
// Sync must enqueue ONLY new ads, never the whole account (that is the blind
// fanout this workstream replaces). Pure + deterministic so the "enqueue exactly
// the new ads" contract is unit-testable without a live DB. De-dupes within the
// batch (Meta can page the same ad twice) and excludes any id already present.
export function newlyInsertedAdIds(
  batchAdIds: readonly string[],
  existingAdIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of batchAdIds) {
    if (!id) continue;
    if (existingAdIds.has(id)) continue; // already in creatives → not new
    if (seen.has(id)) continue;          // dedupe within the batch
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ── US-004: carousel frame capture ────────────────────────────────────────────
//
// A carousel / multi-frame ad's coverage used to key off a single thumbnail, so a
// 5-card carousel with only card #1 cached read as "covered". US-004 makes the sync
// declare the EXPECTED frame count on the creative and populate an ordered per-frame
// ledger (public.creative_frames) so media_coverage.frames_ok can hold it honest.
//
// The sync already fetches creative{object_story_spec, asset_feed_spec} on its
// Phase-1 ad fetch (Story B), so deriving the frames adds NO extra Meta call on the
// hot path — the ordered frame set comes straight from the spec in hand.

/** One discovered frame of an ad, before it is written to creative_frames. */
export interface DiscoveredFrame {
  frame_index: number; // 0-based ordered position (matches scrape-ad `position`)
  media_type: "image" | "video" | "carousel_frame" | "video_thumbnail";
  /** live source url (CDN) for the frame, used to fetch+hash for asset linking */
  url: string | null;
}

/**
 * US-004: Meta's REPORTED frame count for a creative — the "expected" side of
 * frames_ok. Only a genuine multi-card carousel (object_story_spec.link_data.
 * child_attachments with >1 card) declares an expected count here; the count is the
 * number of cards Meta reports. A single-image / single-video / single-card ad, or
 * an ad whose card count cannot be reliably read, returns null — NEVER a guess. A
 * false >1 count would create a false 'frames_incomplete', so the rule is: only
 * count when Meta explicitly enumerates >1 carousel cards. Pure + dependency-free so
 * the contract is unit-testable without a live creative.
 *
 * Mirrors migration 20260714000027: expected_frame_count NULL/<=1 → frames_ok
 * trivially TRUE (no regression); >1 → captured creative_frames COUNT must reach it.
 */
export function expectedFrameCount(creative: unknown): number | null {
  // deno-lint-ignore no-explicit-any
  const c = creative as any;
  const children = c?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(children) && children.length > 1) return children.length;
  // No reliable multi-frame signal — leave null rather than guess (a single-asset
  // ad, or a spec we can't confidently count, must stay frames_ok-trivial).
  return null;
}

/**
 * US-004: derive the ORDERED frame ledger for an ad from the creative spec already
 * in hand (object_story_spec.link_data.child_attachments — every carousel card — and
 * asset_feed_spec.videos — every dynamic-creative video variant). Returns frames in
 * a stable order with 0-based frame_index so a re-sync UPSERTs each frame in place
 * (keyed on (ad_id, frame_index)) and never duplicates. media_type mirrors the
 * scrape-ad taxonomy: a carousel card is 'carousel_frame', a feed video is 'video'.
 *
 * Only produces a ledger for a GENUINE multi-frame ad (a carousel with >1 card, or an
 * asset_feed_spec carrying >1 video) — a single-asset ad yields no rows (its
 * frames_ok is trivially TRUE via expected_frame_count null/<=1, so a ledger would be
 * noise). Pure + dependency-free so ordering is unit-testable without a live creative.
 */
export function deriveFrames(creative: unknown): DiscoveredFrame[] {
  // deno-lint-ignore no-explicit-any
  const c = creative as any;
  const frames: DiscoveredFrame[] = [];
  let idx = 0;

  const children = c?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(children) && children.length > 1) {
    for (const child of children) {
      const isVideo = !!child?.video_id;
      const url =
        child?.picture ??
        child?.image_url ??
        child?.original_image_url ??
        null;
      frames.push({
        frame_index: idx++,
        media_type: isVideo ? "video" : "carousel_frame",
        url: typeof url === "string" ? url : null,
      });
    }
    return frames;
  }

  const feedVideos = c?.asset_feed_spec?.videos;
  if (Array.isArray(feedVideos) && feedVideos.length > 1) {
    for (const v of feedVideos) {
      const url =
        (typeof v?.video_url === "string" ? v.video_url : null) ??
        (typeof v?.thumbnail_url === "string" ? v.thumbnail_url : null);
      frames.push({ frame_index: idx++, media_type: "video", url });
    }
    return frames;
  }

  return frames;
}

// US-004: cap on the number of frame BYTES fetched+hashed for asset linking within a
// single Phase-1 batch. The frame LEDGER (index + media_type) is always written from
// the spec (free, no download); asset_id linking is the only part that touches the
// network, so it is bounded here so a large-account sync can never turn frame capture
// into the blind media fanout the workstream removed. Frames beyond the cap (or on a
// timed-out phase) are written with asset_id NULL — the drain worker / a later
// re-sync links them; frames_ok already holds on the row COUNT, not asset presence.
export const MAX_FRAME_ASSET_FETCHES_PER_BATCH = 40;

/**
 * US-004: fetch a frame's bytes, hash them, and upsert into the shared per-account
 * media_assets registry (the SAME content-hash dedupe drain-media-queue uses), then
 * return the asset id to link on the frame. Returns null on any failure / non-image
 * bytes so the frame is simply stored with asset_id NULL (still counted by
 * frames_ok). Best-effort and never throws.
 */
async function linkFrameAsset(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  accountId: string,
  url: string,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    // Only image frames are hashed here (carousel cards); a video frame's heavy
    // download stays the drain worker's job.
    if (!isMediaContentType(contentType, "image")) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const buffer = await res.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    if (looksLikeHtml(uint8)) return null;

    const assetKey = await computeContentHash(buffer);
    // Reuse an already-stored asset (dedupe) — no re-upload of identical bytes.
    const { data: existing } = await supabase
      .from("media_assets")
      .select("id")
      .eq("account_id", accountId)
      .eq("asset_key", assetKey)
      .maybeSingle();
    if (existing?.id) return existing.id as string;

    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";
    const path = assetStoragePath(accountId, assetKey, ext);
    const { error: upErr } = await supabase.storage
      .from("ad-thumbnails")
      .upload(path, uint8, { contentType, upsert: true });
    if (upErr) return null;
    const publicUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ad-thumbnails/${path}`;

    const { data: upserted } = await supabase
      .from("media_assets")
      .upsert(
        {
          account_id: accountId,
          asset_key: assetKey,
          media_type: "image",
          bucket: "ad-thumbnails",
          storage_path: path,
          public_url: publicUrl,
          byte_size: uint8.byteLength,
          content_type: contentType,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,asset_key" },
      )
      .select("id")
      .maybeSingle();
    return (upserted?.id as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * US-004: upsert the ordered creative_frames ledger for one ad. Writes one row per
 * derived frame keyed on (ad_id, frame_index) so a re-sync updates in place and never
 * duplicates (mirrors migration 20260714000027's UNIQUE(ad_id, frame_index)). The
 * ledger (index + media_type) is always written; asset_id is linked to a shared
 * media_assets content-hash row when the frame's bytes are fetched within the batch
 * budget, else left NULL (drain / a later re-sync links it). Best-effort: any DB
 * error is logged and swallowed so frame capture never breaks the sync control flow.
 */
export async function upsertCreativeFrames(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  adId: string,
  accountId: string,
  frames: DiscoveredFrame[],
  opts?: { fetchAssets?: boolean; assetBudget?: { remaining: number } },
): Promise<void> {
  if (frames.length === 0) return;
  const fetchAssets = opts?.fetchAssets ?? false;
  const budget = opts?.assetBudget;
  const rows: {
    ad_id: string;
    frame_index: number;
    media_type: string;
    asset_id: string | null;
  }[] = [];
  for (const f of frames) {
    let assetId: string | null = null;
    // Link an asset only for image frames with a live (non-storage) CDN url, and
    // only while the per-batch fetch budget allows — keeps frame capture off the
    // large-account blind-fanout path.
    if (
      fetchAssets &&
      f.media_type !== "video" &&
      typeof f.url === "string" &&
      f.url.startsWith("http") &&
      !isStorageUrl(f.url) &&
      (!budget || budget.remaining > 0)
    ) {
      assetId = await linkFrameAsset(supabase, accountId, f.url);
      if (budget) budget.remaining -= 1;
    }
    rows.push({
      ad_id: adId,
      frame_index: f.frame_index,
      media_type: f.media_type,
      asset_id: assetId,
    });
  }
  const { error } = await supabase
    .from("creative_frames")
    .upsert(rows, { onConflict: "ad_id,frame_index" });
  if (error) {
    console.error(`US-004 creative_frames upsert error for ${adId}:`, error.message);
  }
}

// US-003: Canonical reference for the LOCAL snapshot rollup.
//
// The production rollup runs in Postgres (rollup_creatives_from_daily, migration
// 20260714000002) so the aggregation happens next to the data. This TS function
// is the authoritative ARITHMETIC SPEC for that SQL — the two MUST stay in sync.
// It exists so the rollup contract is unit-testable without a live DB: summable
// base metrics are summed; ratios are DERIVED from those sums (never averaged);
// retention scalars are video-view weighted. Keeping the math here documented +
// tested guards against silent drift when the SQL is edited.
export interface DailyRollupInputRow {
  spend?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  purchases?: number | null;
  purchase_value?: number | null;
  adds_to_cart?: number | null;
  video_views?: number | null;
  hold_rate?: number | null;
  frequency?: number | null;
  video_avg_play_time?: number | null;
  retention_p25?: number | null;
  retention_p50?: number | null;
  retention_p75?: number | null;
  retention_p100?: number | null;
}

export function rollupDailyRows(rows: DailyRollupInputRow[]) {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  let spend = 0, impressions = 0, clicks = 0, purchases = 0, purchase_value = 0;
  let adds_to_cart = 0, video_views = 0, thruplays = 0, vaptWeighted = 0, freqWeighted = 0;
  // Retention: video-view weighted; only days with a scalar AND views contribute.
  let p25Num = 0, p50Num = 0, p75Num = 0, p100Num = 0, retWeight = 0;

  for (const r of rows) {
    const vv = n(r.video_views);
    spend += n(r.spend);
    impressions += n(r.impressions);
    clicks += n(r.clicks);
    purchases += n(r.purchases);
    purchase_value += n(r.purchase_value);
    adds_to_cart += n(r.adds_to_cart);
    video_views += vv;
    // Reconstruct daily thruplays from hold_rate so aggregate hold_rate derives
    // from summed base metrics (the daily table stores hold_rate, not thruplays).
    if (r.hold_rate != null && vv > 0) thruplays += (n(r.hold_rate) / 100) * vv;
    vaptWeighted += n(r.video_avg_play_time) * vv;
    freqWeighted += n(r.frequency) * n(r.impressions);
    if (vv > 0) {
      if (r.retention_p50 != null) { retWeight += vv; }
      if (r.retention_p25 != null) p25Num += n(r.retention_p25) * vv;
      if (r.retention_p50 != null) p50Num += n(r.retention_p50) * vv;
      if (r.retention_p75 != null) p75Num += n(r.retention_p75) * vv;
      if (r.retention_p100 != null) p100Num += n(r.retention_p100) * vv;
    }
  }

  return {
    // Summable base metrics.
    spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views,
    // Ratios DERIVED from sums (never averaged).
    roas: spend > 0 ? purchase_value / spend : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cost_per_add_to_cart: adds_to_cart > 0 ? spend / adds_to_cart : 0,
    thumb_stop_rate: impressions > 0 && video_views > 0 ? (video_views / impressions) * 100 : 0,
    hold_rate: video_views > 0 && thruplays > 0 ? (thruplays / video_views) * 100 : 0,
    video_avg_play_time: video_views > 0 ? vaptWeighted / video_views : 0,
    // APPROXIMATE — impression-weighted mean daily frequency; summed daily reach
    // would overcount so no exact aggregate frequency exists locally (accepted).
    frequency: impressions > 0 ? freqWeighted / impressions : 0,
    result_count: purchases,
    cost_per_result: purchases > 0 ? spend / purchases : 0,
    // Retention scalars: view-weighted, null when no weighted days.
    retention_p25: retWeight > 0 ? p25Num / retWeight : null,
    retention_p50: retWeight > 0 ? p50Num / retWeight : null,
    retention_p75: retWeight > 0 ? p75Num / retWeight : null,
    retention_p100: retWeight > 0 ? p100Num / retWeight : null,
  };
}

// US-003: Phase 5 tagging flows through the single canonical parser + precedence
// resolver — no inline regex. Stored tag columns hold display names, so parser
// output (canonical vocab) is mapped through toDisplayName before the resolver.
const DISPLAY_NAMES: Record<string, string> = {
  UGCNative: "UGC Native", StudioClean: "Studio Clean", TextForward: "Text Forward",
  NoTalent: "No Talent", ProblemCallout: "Problem Callout", StatementBold: "Statement Bold",
  AuthorityIntro: "Authority Intro", BeforeAndAfter: "Before & After", PatternInterrupt: "Pattern Interrupt",
};
function toDisplayName(val: string): string { return DISPLAY_NAMES[val] || val; }

/** Parser tags (canonical vocab) -> display-name PartialTags for the resolver's parser layer. */
function parsedDisplayTags(parsed: ParsedAdName | null): AdNameTags | null {
  if (!parsed) return null;
  const t = parsed.tags;
  return {
    ad_type: t.ad_type ? toDisplayName(t.ad_type) : null,
    person: t.person ? toDisplayName(t.person) : null,
    style: t.style ? toDisplayName(t.style) : null,
    product: t.product,
    hook: t.hook ? toDisplayName(t.hook) : null,
    theme: t.theme,
  };
}

/** A name_mappings row -> PartialTags for the resolver's Coda (csv_match) layer. */
function mappingTags(m: Record<string, unknown> | null): PartialTags | null {
  if (!m) return null;
  return {
    ad_type: (m.ad_type as string) ?? null,
    person: (m.person as string) ?? null,
    style: (m.style as string) ?? null,
    product: (m.product as string) ?? null,
    hook: (m.hook as string) ?? null,
    theme: (m.theme as string) ?? null,
  };
}

// ─── Meta API Helper ─────────────────────────────────────────────────────────

const META_API_VERSION = "v22.0";
const MAX_RATE_LIMIT_RETRIES = 5; // Up from 3 — handles large account rate pressure
// Overridable so tests can run the exhaustion path without real 30s+ backoffs.
const BACKOFF_BASE_SEC = Number(Deno.env.get("SYNC_BACKOFF_BASE_SEC") ?? "30");

// Informational notes pushed into apiErrors for operator visibility (throttle
// backoffs, resumable pauses) — the sync handled them and lost no data, so they
// must not flip the final status to completed_with_errors. A run whose only
// log entries are backoffs is a fully successful sync.
const INFORMATIONAL_NOTE_PATTERNS = [
  /^Rate limited, backing off /,
  /^Rate limit retries exhausted — paused with resumable cursor$/,
];
export function isInformationalSyncNote(message: string): boolean {
  return INFORMATIONAL_NOTE_PATTERNS.some((re) => re.test(message));
}
export function countRealErrors(errs: { message?: string }[]): number {
  return errs.filter((e) => !isInformationalSyncNote(e.message || "")).length;
}

export async function metaFetch(
  url: string,
  ctx: { metaApiCalls: number; apiErrors: { timestamp: string; message: string }[]; isTimedOut: () => boolean }
): Promise<{ data: any[] | null; next: string | null; error: boolean; rateLimited: boolean; retriableUrl: string | null }> {
  if (ctx.isTimedOut()) return { data: null, next: null, error: false, rateLimited: false, retriableUrl: url };

  let rateLimitRetries = 0;
  while (true) {
    ctx.metaApiCalls++;
    try {
      const resp = await fetch(url);
      const json = await resp.json();

      if (json.error) {
        const isRateLimitError = json.error.code === 80004 || json.error.code === 80000 || json.error.error_subcode === 2446079
          || json.error.code === 4 || json.error.code === 17 || json.error.code === 32
          || (typeof json.error.message === "string" && (
            json.error.message.includes("request limit") || json.error.message.includes("rate limit") || json.error.message.includes("too many calls")
          ));
        if (isRateLimitError && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          rateLimitRetries++;
          // Exponential backoff: 30s, 60s, 120s, 180s, 300s — capped at 5 min
          const waitSec = Math.min(300, BACKOFF_BASE_SEC * Math.pow(2, rateLimitRetries - 1));
          console.log(`Rate limited, waiting ${waitSec}s (retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})...`);
          ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Rate limited, backing off ${waitSec}s` });
          // Interruptible wait: check timeout every second instead of sleeping the full duration.
          // This prevents rate-limit backoffs from overrunning the phase budget and causing
          // Supabase's hard wall-clock limit to kill the function before state can be saved.
          const waitUntil = Date.now() + waitSec * 1000;
          while (Date.now() < waitUntil) {
            await new Promise(r => setTimeout(r, 1000));
            if (ctx.isTimedOut()) return { data: null, next: null, error: false, rateLimited: true, retriableUrl: url };
          }
          continue;
        }
        if (json.error.message?.includes("reduce the amount of data")) {
          // Meta wants smaller pages — retry with progressively halved limits until we get data or hit minimum
          console.log("Meta asked to reduce data volume — retrying with smaller page size");
          ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: "Reduce data request — retrying with smaller page" });
          let currentLimit = parseInt((url.match(/limit=(\d+)/) || [])[1] || "200");
          let reducedUrl = url;
          for (let attempt = 0; attempt < 4; attempt++) {
            currentLimit = Math.max(10, Math.floor(currentLimit / 2));
            reducedUrl = url.replace(/limit=\d+/, `limit=${currentLimit}`);
            console.log(`  Reduce attempt ${attempt + 1}: limit=${currentLimit}`);
            ctx.metaApiCalls++;
            await new Promise(r => setTimeout(r, 500));
            const retryResp = await fetch(reducedUrl);
            const retryJson = await retryResp.json();
            if (!retryJson.error) {
              return { data: retryJson.data || [], next: retryJson.paging?.next || null, error: false, rateLimited: false, retriableUrl: null };
            }
            if (!retryJson.error?.message?.includes("reduce the amount of data")) {
              // Different error — stop retrying
              break;
            }
          }
          return { data: null, next: null, error: true, rateLimited: false, retriableUrl: null };
        }
        if (isRateLimitError) {
          // Retries exhausted but the URL is still valid — hand the cursor back so the
          // next invocation resumes this exact page instead of restarting the phase
          // (restart caused duplicate upserts and wasted budget under app-wide limits).
          console.error(`Rate limit retries exhausted (${MAX_RATE_LIMIT_RETRIES}) — pausing with resumable cursor`);
          ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Rate limit retries exhausted — paused with resumable cursor` });
          return { data: null, next: null, error: false, rateLimited: true, retriableUrl: url };
        }
        // Log full error details for debugging (especially useful for NDC "unknown error")
        const fullErrMsg = `Meta API error — code: ${json.error.code ?? "?"}, subcode: ${json.error.error_subcode ?? "?"}, type: ${json.error.type ?? "?"}, msg: ${json.error.message ?? "?"}`;
        console.error(fullErrMsg, JSON.stringify(json.error));
        ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: fullErrMsg });
        return { data: null, next: null, error: true, rateLimited: false, retriableUrl: null };
      }

      return { data: json.data || [], next: json.paging?.next || null, error: false, rateLimited: false, retriableUrl: null };
    } catch (fetchErr) {
      console.error("Fetch error:", fetchErr);
      ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Network error: ${String(fetchErr)}` });
      return { data: null, next: null, error: true, rateLimited: false, retriableUrl: null };
    }
  }
}

// ─── Metrics Parsing Helper ──────────────────────────────────────────────────

function parseInsightsRow(row: any, optimizationGoal?: string) {
  const spend = parseFloat(row.spend || "0");
  const roas = row.purchase_roas?.[0]?.value ? parseFloat(row.purchase_roas[0].value) : 0;
  const ctr = parseFloat(row.ctr || "0");
  const clicks = parseInt(row.clicks || "0");
  const impressions = parseInt(row.impressions || "0");
  const cpm = parseFloat(row.cpm || "0");
  const cpc = parseFloat(row.cpc || "0");
  const frequency = parseFloat(row.frequency || "0");

  let purchases = 0, purchaseValue = 0, cpa = 0;
  let addsToCart = 0, costPerAtc = 0;
  let videoViews = 0, thruPlays = 0;

  if (row.actions) {
    const purchaseTypes = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
    const pa = row.actions.find((a: any) => purchaseTypes.includes(a.action_type));
    if (pa) purchases = parseInt(pa.value || "0");
    const atcTypes = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"];
    const atc = row.actions.find((a: any) => atcTypes.includes(a.action_type));
    if (atc) addsToCart = parseInt(atc.value || "0");
    const vv = row.actions.find((a: any) => a.action_type === "video_view");
    if (vv) videoViews = parseInt(vv.value || "0");
  }
  if (row.video_thruplay_watched_actions) {
    const tp = row.video_thruplay_watched_actions.find((a: any) => a.action_type === "video_view");
    if (tp) thruPlays = parseInt(tp.value || "0");
  }
  if (row.action_values) {
    const purchaseTypes = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
    const pv = row.action_values.find((a: any) => purchaseTypes.includes(a.action_type));
    if (pv) purchaseValue = parseFloat(pv.value || "0");
  }
  if (row.cost_per_action_type) {
    const purchaseTypes = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
    const cp = row.cost_per_action_type.find((a: any) => purchaseTypes.includes(a.action_type));
    if (cp) cpa = parseFloat(cp.value || "0");
    const atcTypes = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"];
    const cpatc = row.cost_per_action_type.find((a: any) => atcTypes.includes(a.action_type));
    if (cpatc) costPerAtc = parseFloat(cpatc.value || "0");
  }

  // US-003: Generic outcome metrics — branch on account optimization goal
  const objective = optimizationGoal ?? 'PURCHASE';
  let resultCount = 0;
  let costPerResult = 0;

  if (objective === 'SESSION_CONVERSION') {
    if (row.actions) {
      const sessionAction = row.actions.find((a: any) => a.action_type === 'onsite_conversion.flow_complete');
      if (sessionAction) resultCount = parseInt(sessionAction.value || '0');
    }
    if (row.cost_per_action_type) {
      const sessionCost = row.cost_per_action_type.find((a: any) => a.action_type === 'onsite_conversion.flow_complete');
      if (sessionCost) costPerResult = parseFloat(sessionCost.value || '0');
    }
  } else {
    // PURCHASE (default) — mirror purchases and cpa into generic columns
    resultCount = purchases;
    costPerResult = cpa;
  }

  const thumbStopRate = impressions > 0 && videoViews > 0 ? (videoViews / impressions) * 100 : 0;
  const holdRate = videoViews > 0 && thruPlays > 0 ? (thruPlays / videoViews) * 100 : 0;

  let videoAvgPlayTime = 0;
  if (row.video_avg_time_watched_actions) {
    const vat = row.video_avg_time_watched_actions.find((a: any) => a.action_type === "video_view");
    if (vat) videoAvgPlayTime = parseFloat(vat.value || "0");
  }

  // US-002: frame-retention curve. `video_play_curve_actions` nests a per-interval
  // retention array under `value` (NOT the flat {action_type, value} shape). The
  // parser normalizes to true percentages [0,100] and derives p25/50/75/100 in one
  // pass; non-video / missing → nulls (no zero-fill). These flow into the Phase-2
  // bulk_update_creative_metrics RPC payload (persisted) and are stripped before the
  // Phase-4 creative_daily_metrics upsert (no daily columns for them).
  const { play_curve, retention_p25, retention_p50, retention_p75, retention_p100 } =
    parsePlayCurve(row.video_play_curve_actions);

  return { spend, roas, cpa, ctr, clicks, impressions, cpm, cpc, frequency, purchases, purchase_value: purchaseValue, thumb_stop_rate: thumbStopRate, hold_rate: holdRate, video_avg_play_time: videoAvgPlayTime, adds_to_cart: addsToCart, cost_per_add_to_cart: costPerAtc, video_views: videoViews, play_curve, retention_p25, retention_p50, retention_p75, retention_p100, result_count: resultCount, cost_per_result: costPerResult };
}

// US-003: Winner/concern Slack alert. Extracted from the old Phase-2 aggregate
// fetch so it can run AFTER the LOCAL rollup produces the snapshot (the snapshot
// is no longer built by a full-window Meta pull). Reads the freshly-rolled-up
// creatives snapshot + prior_roas and notifies on threshold crossings. Non-fatal.
async function runSnapshotAlerts(supabase: any, account: any, accountId: string) {
  try {
    const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
    if (!slackUrl) return;

    const spendThreshold = account.iteration_spend_threshold || 50;
    const scaleThreshold = account.scale_threshold || 2.0;
    const killThreshold = account.kill_threshold || 1.0;

    const { data: candidates } = await supabase
      .from("creatives")
      .select("ad_id, ad_name, roas, prior_roas, spend")
      .eq("account_id", accountId)
      .gt("spend", spendThreshold);

    // Extract a readable display name from raw Meta ad names / naming convention strings.
    // e.g. "iAT:IMG>iName:SomeCoolAd>iSrc:Branded>..." → "SomeCoolAd"
    // e.g. "Canada>iCR:PelaCreative>..." → "Canada"
    // e.g. "BM_Bearaby_R8V1E_Video" → as-is (truncated if long)
    const cleanName = (name: string) => {
      if (!name) return "Unknown";
      const m = name.match(/(?:^|>)iName:([^>]+)/i);
      if (m) return m[1];
      if (name.includes(">")) return name.split(">")[0] || name.substring(0, 40);
      return name.length > 45 ? name.substring(0, 42) + "…" : name;
    };

    const newWinners: { name: string; roas: number; spend: number }[] = [];
    const newConcerns: { name: string; roas: number; prior_roas: number }[] = [];

    for (const c of (candidates || [])) {
      const roas = Number(c.roas) || 0;
      const priorRoas = c.prior_roas != null ? Number(c.prior_roas) : null;

      // Only fire when we've seen this ad before and it just crossed the threshold.
      // Skipping priorRoas === null prevents 100+ "new winner" alerts on first sync.
      if (roas >= scaleThreshold && priorRoas !== null && priorRoas < scaleThreshold) {
        newWinners.push({ name: cleanName(c.ad_name), roas, spend: Number(c.spend) || 0 });
      }
      if (roas < killThreshold && priorRoas !== null && priorRoas >= killThreshold) {
        newConcerns.push({ name: cleanName(c.ad_name), roas, prior_roas: priorRoas });
      }
    }

    if (newWinners.length > 0 || newConcerns.length > 0) {
      const appUrl = Deno.env.get("APP_URL") || "https://verdanote.com";
      const blocks: any[] = [];

      if (newWinners.length > 0) {
        // Sort by spend desc, show top 5
        const top = [...newWinners].sort((a, b) => b.spend - a.spend).slice(0, 5);
        const lines = top.map(w =>
          `• ${w.name} — *${w.roas.toFixed(2)}x* ROAS · $${w.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })} spend`
        ).join("\n");
        const extra = newWinners.length > 5 ? `\n_+${newWinners.length - 5} more_` : "";
        blocks.push({ type: "header", text: { type: "plain_text", text: `🟢 New Winners — ${account.name}`, emoji: true } });
        blocks.push({ type: "section", text: { type: "mrkdwn", text: lines + extra } });
      }

      if (newConcerns.length > 0) {
        const top = [...newConcerns].sort((a, b) => b.prior_roas - a.prior_roas).slice(0, 5);
        const lines = top.map(c =>
          `• ${c.name} — *${c.roas.toFixed(2)}x* ROAS (was ${c.prior_roas.toFixed(2)}x)`
        ).join("\n");
        const extra = newConcerns.length > 5 ? `\n_+${newConcerns.length - 5} more_` : "";
        if (blocks.length > 0) blocks.push({ type: "divider" });
        blocks.push({ type: "header", text: { type: "plain_text", text: `🔴 New Concerns — ${account.name}`, emoji: true } });
        blocks.push({ type: "section", text: { type: "mrkdwn", text: lines + extra } });
      }

      blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View in Verdanote →", emoji: true }, url: `${appUrl}/creatives` }] });

      console.log(`Sending Slack alert: ${newWinners.length} winners, ${newConcerns.length} concerns`);
      await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
    }
  } catch (slackErr) {
    console.error("Slack notification error (non-fatal):", slackErr);
  }
}

// ─── Phase Budget ────────────────────────────────────────────────────────────
// Phase budget: 4 minutes (240s). Requires Supabase function timeout >= 300s (Pro plan).
// 110s budget -- leaves ~40s margin within Supabase's 150s hard wall to save cursor state.
// Large accounts resume from cursor on next trigger; the sync manager re-triggers automatically.
// Do NOT set above 110s unless Supabase function timeout is confirmed > 150s.
// NOTE: Phase 1 (metadata fetch) uses PHASE_1_BUDGET_MS for large account safety
const PHASE_BUDGET_MS = 110 * 1000;
const PHASE_1_BUDGET_MS = 100 * 1000; // Must stay under platform's ~150s hard wall-clock limit
const HEARTBEAT_INTERVAL_MS = 20 * 1000;

// ─── Auto-Continue: Self-Invocation ──────────────────────────────────────────
// After a phase budget expires and state is saved, the function fires a non-blocking
// HTTP POST to /sync/continue so the next phase starts immediately instead of
// waiting for the cron tick (~1 min). This eliminates the race condition where
// cleanup-stuck-syncs marks a sync as "stuck" before the cron re-invokes it.
async function selfContinue(claimId: string): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.warn("selfContinue: missing env vars — falling back to cron");
      return;
    }
    // Fire-and-forget: don't await the full response, just ensure the request is sent.
    const continuePromise = fetch(`${supabaseUrl}/functions/v1/sync/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ time: new Date().toISOString(), claim_id: claimId }),
    }).catch((err) => {
      console.warn("selfContinue fetch error (non-fatal):", err);
    });
    // Keep the isolate alive until the request actually leaves. Without this the
    // runtime can tear the worker down the moment the handler returns its
    // Response, dropping the in-flight fetch before it's sent — the chain then
    // stalls until the cron backstop notices. EdgeRuntime is the Supabase
    // (Deno Deploy) global; guard for envs (tests/local) that lack it.
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(continuePromise);
    }
    console.log("selfContinue: fired non-blocking continue invocation");
  } catch (err) {
    console.warn("selfContinue error (non-fatal):", err);
  }
}

// ─── Promote Next Queued Sync ────────────────────────────────────────────────
async function promoteNextQueued(supabase: any) {
  // Check for cooldown between sequential account syncs (default: 2 min to let Meta rate limits recover)
  const { data: cooldownRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "sync_cooldown_minutes")
    .single();
  const cooldownMinutes = parseFloat(cooldownRow?.value || "2"); // Default 2 min cooldown

  if (cooldownMinutes > 0) {
    // Find the most recently completed sync
    const { data: lastCompleted } = await supabase
      .from("sync_logs")
      .select("completed_at")
      .in("status", ["completed", "completed_with_errors", "failed", "cancelled"])
      .order("completed_at", { ascending: false })
      .limit(1);

    if (lastCompleted?.length && lastCompleted[0].completed_at) {
      const completedAt = new Date(lastCompleted[0].completed_at).getTime();
      const cooldownMs = cooldownMinutes * 60 * 1000;
      const elapsed = Date.now() - completedAt;
      if (elapsed < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        console.log(`Cooldown active — next sync will start in ~${remainingSec}s`);
        return; // cron will retry in ~1 minute
      }
    }
  }

  const { data: next } = await supabase.from("sync_logs")
    .select("id, sync_state")
    .eq("status", "queued")
    .order("started_at", { ascending: true })
    .limit(1);
  if (next?.length) {
    await supabase.from("sync_logs").update({
      status: "running",
      sync_state: { ...(next[0].sync_state || {}), last_activity: new Date().toISOString() },
    }).eq("id", next[0].id);
    console.log(`Promoted queued sync ${next[0].id} to running`);
  }
}

// ─── Sync Worker: Resumable Phase Execution ──────────────────────────────────
// Phases:
//   1 = Fetch ads metadata (lightweight — no media)
//   2 = Fetch aggregated insights (batch upsert)
//   3 = Cleanup zero-spend + count
//   4 = Daily metric breakdowns (batch upsert, chunked)
//   5 = Finalize

async function runSyncPhase(supabase: any, syncLog: any, metaToken: string) {
  const startMs = Date.now();
  const phase = syncLog.current_phase || 1;
  // Use extended budget for Phase 1 (metadata fetch) to handle large accounts
  const phaseBudget = phase === 1 ? PHASE_1_BUDGET_MS : PHASE_BUDGET_MS;
  const isTimedOut = () => (Date.now() - startMs) > phaseBudget;
  const ctx = { metaApiCalls: 0, apiErrors: [] as { timestamp: string; message: string }[], isTimedOut };

  // Lightweight heartbeat
  let lastHeartbeat = Date.now();
  const heartbeat = async () => {
    if (Date.now() - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeat = Date.now();
    try {
      const { data: current } = await supabase.from("sync_logs").select("sync_state").eq("id", syncLog.id).single();
      const currentState = current?.sync_state || {};
      await supabase.from("sync_logs").update({
        sync_state: { ...currentState, last_activity: new Date().toISOString() },
      }).eq("id", syncLog.id);
    } catch (_) { /* best effort */ }
  };

  const accountId = syncLog.account_id;
  const { data: account } = await supabase.from("ad_accounts").select("*").eq("id", accountId).single();
  if (!account) {
    await supabase.from("sync_logs").update({ status: "failed", api_errors: JSON.stringify([{ timestamp: new Date().toISOString(), message: "Account not found" }]), completed_at: new Date().toISOString() }).eq("id", syncLog.id);
    await promoteNextQueued(supabase);
    return;
  }

  const state = syncLog.sync_state || {};
  const syncType = syncLog.sync_type || "manual";
  const syncScope = state.sync_scope || "full";
  const dateRangeDays = syncType === "initial" ? 90 : (account.date_range_days || 14);

  // ── Attribution windows — passed to Meta API for accurate conversion data ──
  const clickWindow = account.click_window || 7;
  const viewWindow = account.view_window || 1;
  const attributionSetting = `action_attribution_windows=["${clickWindow}d_click","${viewWindow}d_view"]`;

  // ── CHANGE 2: Incremental sync — determine date window ──────────────────
  const lastDataSync: string | null = account.last_data_sync || null;
  const isInitialSync = syncType === "initial" || !lastDataSync;

  let incrementalSinceDate: string | null = null;
  if (!isInitialSync && lastDataSync) {
    const lastSyncMs = new Date(lastDataSync).getTime();
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const effectiveSince = Math.min(lastSyncMs, twoDaysAgo);
    incrementalSinceDate = new Date(effectiveSince).toISOString().split("T")[0];
    console.log(
      `Incremental sync for ${account.name}: fetching data since ${incrementalSinceDate} ` +
      `(last_data_sync: ${lastDataSync}, attribution: ${clickWindow}d_click/${viewWindow}d_view)`
    );
  } else {
    console.log(
      `Initial/full sync for ${account.name}: fetching last ${dateRangeDays} days ` +
      `(attribution: ${clickWindow}d_click/${viewWindow}d_view)`
    );
  }
  // ────────────────────────────────────────────────────────────────────────

  // Determine which phases to run based on sync_scope
  const scopePhases: Record<string, number[]> = {
    full: [1, 2, 3, 4, 5],
    metadata: [1, 5],
    insights: [2, 3, 5],
    daily: [4, 5],
    lite: [1, 2, 3, 5],
  };
  const allowedPhases = scopePhases[syncScope] || scopePhases.full;


  // Adaptive settings based on account size — gentler on Meta API for larger accounts
  const creativeCount = account.creative_count || 0;
  const isLargeAccount = creativeCount > 3000;
  const insightsPageSize = isLargeAccount ? 200 : 500;
  const interRequestDelayMs = isLargeAccount ? 300 : 150;
  // Phase 1 always uses campaign-by-campaign fetching — it's more resilient
  // against Meta API errors and supports resumable cursors per campaign
  console.log(`Account size: ${creativeCount} creatives — page_size=${insightsPageSize}, delay=${interRequestDelayMs}ms`);

  console.log(`\n━━━ Phase ${phase} for ${account.name} (${accountId}) ━━━`);

  // Check cancellation
  const { data: statusCheck } = await supabase.from("sync_logs").select("status").eq("id", syncLog.id).single();
  if (statusCheck?.status === "cancelled") {
    await promoteNextQueued(supabase);
    return;
  }

  const saveState = async (nextPhase: number, newState: any, status = "running") => {
    // Exclude non-serializable fields (Set objects) from persisted state
    const { _validAdCache, ...serializableState } = state;
    const merged = { ...serializableState, ...newState, last_activity: new Date().toISOString() };
    try {
      await supabase.from("sync_logs").update({
        current_phase: nextPhase,
        sync_state: merged,
        status,
        creatives_fetched: merged.creatives_fetched ?? syncLog.creatives_fetched ?? 0,
        creatives_upserted: merged.creatives_upserted ?? syncLog.creatives_upserted ?? 0,
        tags_parsed: merged.tags_parsed ?? syncLog.tags_parsed ?? 0,
        tags_csv_matched: merged.tags_csv_matched ?? syncLog.tags_csv_matched ?? 0,
        tags_manual_preserved: merged.tags_manual_preserved ?? syncLog.tags_manual_preserved ?? 0,
        tags_untagged: merged.tags_untagged ?? syncLog.tags_untagged ?? 0,
        meta_api_calls: (syncLog.meta_api_calls || 0) + ctx.metaApiCalls,
        api_errors: JSON.stringify([...JSON.parse(syncLog.api_errors || "[]"), ...ctx.apiErrors]),
        duration_ms: (syncLog.duration_ms || 0) + (Date.now() - startMs),
        ...(status !== "running" ? { completed_at: new Date().toISOString() } : {}),
      }).eq("id", syncLog.id);
    } catch (saveErr) {
      console.error("saveState failed:", saveErr);
      try {
        await supabase.from("sync_logs").update({
          sync_state: { ...state, last_activity: new Date().toISOString(), save_error: String(saveErr) },
        }).eq("id", syncLog.id);
      } catch (_) { /* truly lost */ }
    }

    if (status !== "running") {
      await promoteNextQueued(supabase);
    }
  };

  // Check sync_scope — skip phases not in scope
  if (!allowedPhases.includes(phase)) {
    const nextAllowed = allowedPhases.find((p: number) => p > phase);
    if (nextAllowed) {
      console.log(`Scope "${syncScope}": skipping phase ${phase}, jumping to phase ${nextAllowed}`);
      await saveState(nextAllowed, {});
      return;
    } else {
      const finalStatus = countRealErrors(JSON.parse(syncLog.api_errors || "[]")) > 0 ? "completed_with_errors" : "completed";
      await saveState(5, {}, finalStatus);
      return;
    }
  }

  try {
    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: Fetch ads metadata — CAMPAIGN-BY-CAMPAIGN (large account safe)
    //   For large accounts (NDC has 18k+ ads), fetching all ads in one
    //   account-level sweep causes Meta to error mid-stream. Instead:
    //   1. Fetch all campaigns first (lightweight, rarely errors)
    //   2. For each campaign, fetch its ads — errors only lose one campaign
    //   3. Resume from exactly where we left off (campaign index + cursor)
    //   Small accounts fall through to the flat sweep as before.
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 1) {
      // Get manual/csv-tagged ad IDs to preserve their tags (only update metadata)
      const { data: taggedAds } = await supabase.from("creatives").select("ad_id")
        .eq("account_id", accountId).in("tag_source", ["manual", "csv"]);
      const taggedAdIds = new Set((taggedAds || []).map((a: any) => a.ad_id));

      let fetchedCount = state.creatives_fetched || 0;

      // Helper: upsert a batch of ads to the DB
      const upsertAds = async (ads: any[]) => {
        const upsertBatch: any[] = [];
        const metadataBatch: { ad_id: string; data: any }[] = [];
        // US-004: ordered frame ledger per multi-frame ad in this batch, derived from
        // the creative spec already in hand (no extra Meta call). Written to
        // creative_frames AFTER the creatives upsert succeeds (the FK requires the
        // parent row to exist first).
        const framesByAd = new Map<string, DiscoveredFrame[]>();
        for (const ad of ads) {
          // Build post URL: prefer effective_object_story_id, fall back to permalink_url
          let adPostUrl: string | null = null;
          const storyId = ad.creative?.effective_object_story_id;
          if (storyId && storyId.includes("_")) {
            const [pageId, postId] = storyId.split("_", 2);
            if (pageId && postId) {
              adPostUrl = `https://www.facebook.com/${pageId}/posts/${postId}/`;
            }
          }

          const metadata = {
            ad_name: ad.name,
            ad_status: ad.status || "UNKNOWN",
            campaign_name: ad.campaign?.name || null,
            adset_name: ad.adset?.name || null,
            ad_post_url: adPostUrl,
            created_time: ad.created_time || null,
          };
          // Story B — landing-page forward-fill (ADDITIVE + FAILSAFE).
          // Derive the ad's destination from object_story_spec/asset_feed_spec (now
          // requested on the existing Phase 1 fetch) so new/changed ads carry
          // landing_page_url + destination_key without a manual backfill. Wrapped in
          // try/catch: any failure leaves BOTH null and must never throw or alter
          // sync control flow. Same extractor + normalizer the backfill uses.
          let landingPageUrl: string | null = null;
          let destinationKey: string | null = null;
          try {
            const rawLink = extractDestinationLink(ad.creative);
            const key = normalizeDestinationUrl(rawLink);
            if (key !== null) {
              landingPageUrl = rawLink;
              destinationKey = key;
            }
          } catch (_destErr) {
            // Purely best-effort: leave landing_page_url/destination_key null.
            landingPageUrl = null;
            destinationKey = null;
          }

          // US-004: declare Meta's REPORTED frame count on the creative. Only a
          // genuine multi-card carousel yields a >1 count; everything else stays
          // null (never guessed) so frames_ok is trivially TRUE (no regression).
          const frameCount = expectedFrameCount(ad.creative);
          // Derive the ordered frame ledger for a genuine multi-frame ad (carousel
          // cards / >1 dynamic video). Single-asset ads yield [] (no ledger needed).
          const frames = deriveFrames(ad.creative);
          if (frames.length > 0) framesByAd.set(ad.id, frames);

          if (taggedAdIds.has(ad.id)) {
            metadataBatch.push({ ad_id: ad.id, data: metadata });
          } else {
            upsertBatch.push({
              ad_id: ad.id,
              account_id: accountId,
              platform: "meta",
              unique_code: ad.name.split("_")[0],
              ...metadata,
              // Only include the columns when we resolved a real destination, so a
              // no-link ad never overwrites a previously-backfilled value with null.
              ...(destinationKey !== null
                ? { landing_page_url: landingPageUrl, destination_key: destinationKey }
                : {}),
              // Only set expected_frame_count when Meta reports a genuine multi-frame
              // count (>1); leaving it out for single-asset ads avoids overwriting a
              // prior value with null and keeps frames_ok trivially TRUE for them.
              ...(frameCount != null ? { expected_frame_count: frameCount } : {}),
            });
          }
        }
        if (upsertBatch.length > 0) {
          // US-008: event-driven media caching — enqueue ONLY ads this run newly
          // inserts into creatives (never the whole account). Determine "new" by
          // diffing the batch's ad_ids against those that already exist BEFORE the
          // upsert, then upsert, then enqueue the diff into media_cache_queue.
          // Cheap: one indexed .in() lookup per batch (batches are one Meta page).
          const batchAdIds = upsertBatch.map((r) => r.ad_id as string);
          const { data: existingRows, error: existingErr } = await supabase
            .from("creatives")
            .select("ad_id")
            .in("ad_id", batchAdIds);
          if (existingErr) {
            // If we can't tell which are new, skip enqueue for this batch rather
            // than risk enqueuing the whole batch (blind fanout is exactly what
            // US-008 removes). Caching still happens via the existing pipeline.
            console.error("Phase 1 new-ad lookup error:", existingErr.message);
          }
          const existingAdIds = new Set<string>((existingRows || []).map((r: { ad_id: string }) => r.ad_id));

          const { error } = await supabase.from("creatives").upsert(upsertBatch, { onConflict: "ad_id" });
          if (error) {
            console.error("Phase 1 upsert error:", error.message);
          } else if (!existingErr) {
            // Only enqueue after a clean upsert AND a reliable existing-id read.
            const newAdIds = newlyInsertedAdIds(batchAdIds, existingAdIds);
            if (newAdIds.length > 0) {
              const queueRows = newAdIds.map((ad_id) => ({ ad_id, account_id: accountId, status: "pending" }));
              // ignoreDuplicates: an ad already queued (e.g. a resumed Phase 1
              // re-processing the same page) must not error or reset its state.
              const { error: queueErr } = await supabase
                .from("media_cache_queue")
                .upsert(queueRows, { onConflict: "ad_id", ignoreDuplicates: true });
              if (queueErr) {
                console.error("Phase 1 media_cache_queue enqueue error:", queueErr.message);
              } else {
                console.log(`  Enqueued ${newAdIds.length} new ad(s) for media caching`);
              }
            }
          }
        }
        if (metadataBatch.length > 0) {
          const rpcPayload = metadataBatch.map(({ ad_id, data }) => ({ ad_id, ...data }));
          const { error } = await supabase.rpc("bulk_update_creative_metadata", { payload: JSON.stringify(rpcPayload) });
          if (error) console.error("Phase 1 metadata RPC error:", error.message);
        }

        // US-004: write the ordered creative_frames ledger for the multi-frame ads in
        // this batch. Runs AFTER the creatives upsert / metadata RPC so the parent row
        // the frame FK references exists. Best-effort + resumable-safe: keyed on
        // (ad_id, frame_index) so a re-sync UPSERTs in place (never duplicates), and a
        // per-batch asset-fetch budget + isTimedOut() gate keep it off the blind
        // large-account fanout path — frames beyond the budget are written with
        // asset_id NULL (drain / a later re-sync links them; frames_ok holds on COUNT).
        if (framesByAd.size > 0) {
          const assetBudget = { remaining: MAX_FRAME_ASSET_FETCHES_PER_BATCH };
          // Reused across this batch's video-frame ads so page-owned video sources
          // resolve via the account library map (avoids #10 permission errors);
          // built lazily on first need so image-only carousel batches never pay for it.
          let accountVideoMap: Map<string, string> | undefined;
          for (const [adId, frames] of framesByAd) {
            // US-004: for a multi-VIDEO ad (asset_feed_spec) whose frames have no
            // inline source url, resolve EVERY variant via discoverAllVideoUrls (the
            // multi-result sibling of discoverVideoUrl) and fill the ledger's video
            // frame urls in order. Gated on remaining phase time so it never turns
            // frame capture into a large-account blind fanout.
            const needsVideoResolve =
              !isTimedOut() &&
              frames.some((f) => f.media_type === "video" && !f.url);
            if (needsVideoResolve) {
              if (!accountVideoMap) {
                accountVideoMap = await fetchAccountVideoMap(accountId, metaToken);
              }
              const sources = await discoverAllVideoUrls(adId, metaToken, 30_000, accountVideoMap);
              let si = 0;
              for (const f of frames) {
                if (f.media_type === "video" && !f.url && si < sources.length) {
                  f.url = sources[si++];
                }
              }
            }
            await upsertCreativeFrames(supabase, adId, accountId, frames, {
              // Only spend the network budget on asset linking while the phase has
              // time left; a timed-out phase still writes the ledger (asset_id NULL).
              fetchAssets: !isTimedOut(),
              assetBudget,
            });
          }
        }
      };

      const deliveredFilter = encodeURIComponent(JSON.stringify([
        { field: "impressions", operator: "GREATER_THAN", value: "0" }
      ]));

      // ── Campaign-by-campaign fetch ──────────────────────────────────
      // Step 1: fetch all campaigns (or resume from saved list)
      let campaigns: { id: string; name: string }[] = state.campaigns || [];

      if (campaigns.length === 0) {
        console.log("Phase 1 (large): fetching campaign list...");
        // Filter out DELETED and ARCHIVED campaigns to reduce API calls
        const campStatusFilter = encodeURIComponent(JSON.stringify([
          { field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED"] }
        ]));
        let campUrl: string | null =
          `https://graph.facebook.com/${META_API_VERSION}/${accountId}/campaigns?` +
          `fields=id,name&filtering=${campStatusFilter}&limit=200&access_token=${encodeURIComponent(metaToken)}`;
        while (campUrl && !isTimedOut()) {
          const result = await metaFetch(campUrl, ctx);
          if (result.error) {
            console.error("Failed to fetch campaigns — will retry next continue");
            await saveState(1, { campaigns: [], creatives_fetched: fetchedCount });
            return;
          }
          if (result.rateLimited && result.retriableUrl) {
            // Rate-limit pause mid-list: never persist a partial campaign list — the
            // campaign loop below would treat it as the complete account and the
            // missing campaigns' ads would never be fetched. Restart the list next run.
            console.log("Campaign list fetch paused (rate-limited) — will refetch next continue");
            await saveState(1, { campaigns: [], creatives_fetched: fetchedCount });
            return;
          }
          campaigns.push(...(result.data || []).map((c: any) => ({ id: c.id, name: c.name })));
          campUrl = result.next;
          if (campUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
        }
        if (campUrl) {
          // Timed out mid-list — same rule: a partial campaign list must not survive.
          console.log("Campaign list fetch timed out — will refetch next continue");
          await saveState(1, { campaigns: [], creatives_fetched: fetchedCount });
          return;
        }
        console.log(`  Found ${campaigns.length} ACTIVE/PAUSED campaigns`);

        // ── Spend-based pre-filter: only keep campaigns with spend in the date window ──
        // This dramatically reduces API calls for accounts with many paused/inactive campaigns.
        if (campaigns.length > 0 && !isTimedOut()) {
          const filterEndDate = new Date().toISOString().split("T")[0];
          const filterStartDate = incrementalSinceDate || (() => {
            const d = new Date();
            d.setDate(d.getDate() - dateRangeDays);
            return d.toISOString().split("T")[0];
          })();
          const spendTimeRange = JSON.stringify({ since: filterStartDate, until: filterEndDate });
          const activeSet = new Set<string>();

          // Fetch campaign-level insights (spend only) — one paginated call covers all campaigns
          let spendUrl: string | null =
            `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
            `time_range=${encodeURIComponent(spendTimeRange)}&level=campaign` +
            `&fields=campaign_id,spend&limit=500&access_token=${encodeURIComponent(metaToken)}`;
          while (spendUrl && !isTimedOut()) {
            const result = await metaFetch(spendUrl, ctx);
            if (result.error) {
              console.warn("Spend pre-filter failed — proceeding with all campaigns");
              activeSet.clear();
              break;
            }
            if (result.rateLimited && result.retriableUrl) {
              // Partial spend data would silently drop campaigns whose spend rows live in
              // the unfetched pages. The filter is an optimization only — fall back to all.
              console.warn("Spend pre-filter rate-limited mid-pagination — proceeding with all campaigns");
              activeSet.clear();
              break;
            }
            for (const row of result.data || []) {
              if (parseFloat(row.spend || "0") > 0) {
                activeSet.add(row.campaign_id);
              }
            }
            spendUrl = result.next;
            if (spendUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
          }
          if (spendUrl) {
            // Timed out mid-pagination — same rule: partial spend data must not filter.
            console.warn("Spend pre-filter timed out mid-pagination — proceeding with all campaigns");
            activeSet.clear();
          }

          if (activeSet.size > 0) {
            const before = campaigns.length;
            campaigns = campaigns.filter(c => activeSet.has(c.id));
            console.log(`  Spend filter: ${campaigns.length}/${before} campaigns had spend since ${filterStartDate}`);
          }
        }
      }

      // Step 2: iterate campaigns, resuming from saved index
      let campIdx = state.campaign_index || 0;
      let campCursor: string | null = state.campaign_cursor || null;

      while (campIdx < campaigns.length && !isTimedOut()) {
        await heartbeat();
        const campaign = campaigns[campIdx];

        // Check cancellation per campaign
        const { data: sc } = await supabase.from("sync_logs").select("status").eq("id", syncLog.id).single();
        if (sc?.status === "cancelled") return;

        // Fetch ads for this campaign
        let nextUrl: string | null = campCursor || (
          `https://graph.facebook.com/${META_API_VERSION}/${campaign.id}/ads?` +
          // object_story_spec/asset_feed_spec are requested INSIDE the existing
          // creative{...} expansion (Story B landing-page forward-fill). This adds
          // fields to a request already being made — NOT a new Meta call and NOT a
          // batching change — so the hot-path fetch/rate-limit contract is unchanged.
          `fields=id,name,status,created_time,campaign{name},adset{name},creative{effective_object_story_id,object_story_spec,asset_feed_spec}` +
          `&filtering=${deliveredFilter}` +
          `&limit=200&access_token=${encodeURIComponent(metaToken)}`
        );
        campCursor = null; // reset for next campaign

        let campFetched = 0;
        let campError = false;

        while (nextUrl && !isTimedOut()) {
          const result = await metaFetch(nextUrl, ctx);
          if (result.error) {
            // Error on this campaign — log it, skip to next campaign
            // (don't abort the whole phase — other campaigns are independent)
            ctx.apiErrors.push({
              timestamp: new Date().toISOString(),
              message: `Ad fetch failed for campaign ${campaign.id} (${campaign.name}) — skipping`,
            });
            console.warn(`  Campaign ${campaign.name} errored — skipping`);
            campError = true;
            break;
          }
          // Rate-limited timeout: save the retriable URL as cursor so we resume this exact page
          if (result.rateLimited && result.retriableUrl) {
            console.log(`Phase 1 paused (rate-limited) mid-campaign ${campIdx + 1}/${campaigns.length} at ${fetchedCount} total ads`);
            await saveState(1, {
              campaigns,
              campaign_index: campIdx,
              campaign_cursor: result.retriableUrl,
              creatives_fetched: fetchedCount,
            });
            return;
          }
          if (result.data && result.data.length > 0) {
            await upsertAds(result.data);
            campFetched += result.data.length;
            fetchedCount += result.data.length;
          }
          nextUrl = result.next;
          if (nextUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
        }

        if (nextUrl && isTimedOut()) {
          // Timed out mid-campaign (not rate-limited) — save cursor and resume this campaign next invocation
          console.log(`Phase 1 paused mid-campaign ${campIdx + 1}/${campaigns.length} at ${fetchedCount} total ads`);
          await saveState(1, {
            campaigns,
            campaign_index: campIdx,
            campaign_cursor: nextUrl,
            creatives_fetched: fetchedCount,
          });
          return;
        }

        if (!campError && (campIdx % 10 === 0 || campIdx === campaigns.length - 1)) {
          // Throttled: per-campaign lines on 200-campaign accounts drown real errors
          console.log(`  Campaign ${campIdx + 1}/${campaigns.length} (${campaign.name}): ${campFetched} ads`);
        }

        campIdx++;
      }

      if (campIdx >= campaigns.length) {
        console.log(`Phase 1 complete (campaign-by-campaign): ${fetchedCount} ads across ${campaigns.length} campaigns`);
        await saveState(2, { campaigns: null, campaign_index: null, campaign_cursor: null, ads_cursor: null, creatives_fetched: fetchedCount });
      } else {
        // Timed out between campaigns
        console.log(`Phase 1 paused between campaigns at index ${campIdx}`);
        await saveState(1, { campaigns, campaign_index: campIdx, campaign_cursor: null, creatives_fetched: fetchedCount });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2: (US-003) No-op — the aggregate snapshot is now built LOCALLY.
    //   The full-window aggregate insights fetch to Meta has been REMOVED.
    //   Previously Phase 2 re-pulled the entire date_range_days window from
    //   Meta a SECOND time (Phase 4 already pulls the daily grain) just to
    //   populate the creatives snapshot. Since daily rows freeze once the
    //   attribution window closes and are stored permanently per (ad_id,date),
    //   the snapshot can be recomputed from those daily rows with zero extra
    //   Meta calls. That local rollup + Slack alerting + last_data_sync bump
    //   now run in Phase 5, AFTER Phase 4 has written the daily rows for this
    //   run (see rollup_creatives_from_daily RPC, migration
    //   20260714000002_rpc_rollup_creatives_from_daily.sql).
    //
    //   Phase 2 is retained as an explicit no-op transition so the resumable
    //   phase machine, sync_scope maps ("insights": [2,3,5]), and any saved
    //   sync_state referencing phase 2 keep working unchanged.
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 2) {
      console.log("Phase 2: aggregate snapshot deferred to local rollup in Phase 5 (no Meta fetch)");
      await saveState(3, { insights_cursor: null, insights_count: 0, insights_time_range: null, insights_since_date: null });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 3: Cleanup zero-spend creatives + count
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 3) {
      console.log("Phase 3: Cleanup zero-spend creatives...");

      // Delete zero-spend creatives EXCEPT:
      // - manually/csv-tagged ones (user investment)
      // - placeholder ads created by Phase 4 auto-create (ad_name = ad_id pattern)
      //   These will get real metrics in Phase 4 of the current sync.
      const { count: zeroSpendCount } = await supabase.from("creatives")
        .delete({ count: "exact" })
        .eq("account_id", accountId)
        .lte("spend", 0)
        .is("impressions", null)  // Only delete truly empty rows (never had data)
        .not("tag_source", "in", '("manual","csv")');
      if (zeroSpendCount && zeroSpendCount > 0) {
        console.log(`  Cleaned up ${zeroSpendCount} zero-spend creatives`);
      }

      // Count remaining
      const { count: remaining } = await supabase.from("creatives")
        .select("*", { count: "exact", head: true }).eq("account_id", accountId);
      const creativesUpserted = remaining || 0;

      console.log(`Phase 3 complete: ${creativesUpserted} creatives remain`);
      await saveState(4, { creatives_upserted: creativesUpserted });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 4: Daily metric breakdowns (chunked, resumable, batch upsert)
    //   Upserts incrementally per page instead of accumulating in memory
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 4) {
      const { count: existingCount } = await supabase.from("creatives")
        .select("*", { count: "exact", head: true }).eq("account_id", accountId);
      const hasExistingAds = (existingCount || 0) > 0;

      // ── Phase 4: Rolling recent window (US-002) ───────────────────────
      // Daily metrics are keyed by (ad_id, date) — upserts are idempotent, so a
      // late-arriving conversion inside the recent window still corrects the
      // prior day it belongs to. Historical daily rows freeze once the
      // attribution window closes and are fetched once (US-004 backfill), so a
      // scheduled sync on an already-backfilled account re-pulls only a rolling
      // ~28d window instead of the full retention window. computeDailyWindowDays
      // widens the window if a sync was skipped, preserving the old
      // "no gaps between syncs" guarantee without the full-range cost.
      let dailyDays: number;
      let dailySinceDate: string;
      const CHUNK_DAYS = 15;
      const endDate = new Date();

      if (!state.daily_chunk_offset) {
        // Rolling optimization is only safe once history exists locally: an
        // already-backfilled account (daily_backfilled_since set) on a
        // scheduled/incremental (non-initial) sync. Initial syncs and
        // not-yet-backfilled accounts keep the full date_range_days window.
        const rollingEligible = !isInitialSync && !!account.daily_backfilled_since;
        dailyDays = computeDailyWindowDays({
          rollingEligible,
          dateRangeDays,
          lastDataSync,
          clickWindow,
        });
        const fullStart = new Date();
        fullStart.setDate(fullStart.getDate() - dailyDays);
        dailySinceDate = fullStart.toISOString().split("T")[0];
        console.log(
          `Phase 4 window: ${dailyDays} days ` +
          `(${rollingEligible ? `rolling recent, RECENT_WINDOW=${RECENT_WINDOW_DAYS}d` : "full range — initial/not-yet-backfilled"})`
        );
      } else {
        // Resuming — use saved values
        dailyDays = state.daily_days || dateRangeDays;
        dailySinceDate = state.daily_since_date || (() => {
          const d = new Date(); d.setDate(d.getDate() - dailyDays); return d.toISOString().split("T")[0];
        })();
      }
      // ────────────────────────────────────────────────────────────────────

      const fullStartDate = new Date(dailySinceDate + "T00:00:00Z");

      const chunkOffset = state.daily_chunk_offset || 0;
      const dailyCursor = state.daily_cursor || null;
      const totalChunks = Math.ceil(dailyDays / CHUNK_DAYS);

      console.log(`Phase 4: Daily breakdowns (${dailyDays} days, chunk ${chunkOffset + 1}/${totalChunks})...`);

      let currentChunk = chunkOffset;
      let paginationCursor = dailyCursor;

      while (currentChunk < totalChunks && !isTimedOut()) {
        const { data: sc } = await supabase.from("sync_logs").select("status").eq("id", syncLog.id).single();
        if (sc?.status === "cancelled") return;

        const chunkStart = new Date(fullStartDate);
        chunkStart.setDate(chunkStart.getDate() + currentChunk * CHUNK_DAYS);
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
        if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

        const chunkSince = chunkStart.toISOString().split("T")[0];
        const chunkUntil = chunkEnd.toISOString().split("T")[0];
        const chunkRange = JSON.stringify({ since: chunkSince, until: chunkUntil });

        console.log(`  Chunk ${currentChunk + 1}/${totalChunks}: ${chunkSince} → ${chunkUntil}`);

        // date_start is requested explicitly — Meta auto-includes it with time_increment=1
        // today, but row.date_start feeds the (ad_id, date) upsert key, so we must not
        // depend on undocumented behavior.
        const insightsFields = "ad_id,date_start,spend,purchase_roas,cost_per_action_type,ctr,clicks,impressions,cpm,cpc,frequency,actions,action_values,video_avg_time_watched_actions,video_thruplay_watched_actions,video_play_curve_actions";

        let nextUrl = paginationCursor || (
          `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
          `time_range=${encodeURIComponent(chunkRange)}&time_increment=1&level=ad` +
          `&fields=${insightsFields}` +
          `&${attributionSetting}` +
          `&limit=${insightsPageSize}&access_token=${encodeURIComponent(metaToken)}`
        );

        while (nextUrl && !isTimedOut()) {
          await heartbeat();
          const result = await metaFetch(nextUrl, ctx);
          if (result.error) {
            // metaFetch already pushed the full Meta error detail to ctx.apiErrors.
            // result.error is a boolean, so `.message` is undefined — record a phase marker instead.
            ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Phase 4 chunk ${currentChunk + 1}/${totalChunks} halted on API error (see preceding Meta API error)` });
            nextUrl = null;
            await saveState(4, { daily_chunk_offset: currentChunk, daily_cursor: null, daily_days: dailyDays, daily_since_date: dailySinceDate });
            break;
          }
          if (result.rateLimited && result.retriableUrl) {
            // Rate-limit pause mid-chunk: save the exact page URL so the next /continue
            // resumes this page. Without this, the chunk's remaining pages were silently
            // dropped and the outer loop advanced to the next chunk as if complete.
            console.log(`Phase 4 paused (rate-limited) mid-chunk ${currentChunk + 1}/${totalChunks}`);
            await saveState(4, { daily_chunk_offset: currentChunk, daily_cursor: result.retriableUrl, daily_days: dailyDays, daily_since_date: dailySinceDate });
            return;
          }
          if (result.data && result.data.length > 0) {
            // For large accounts (NDC has 18k+ creatives), loading all ad_ids into memory
            // is slow and the Set can't survive JSON serialization across resumes.
            // Instead: cross-check the batch of ad_ids from Meta against the DB directly.
            // This is a small IN query (≤500 ids) — fast and correct on any account size.
            const batchAdIds = result.data.map((row: any) => row.ad_id);
            const { data: existingAds } = await supabase
              .from("creatives")
              .select("ad_id")
              .eq("account_id", accountId)
              .in("ad_id", batchAdIds);
            const validAdIds = new Set<string>((existingAds || []).map((e: any) => e.ad_id));

            // FIX: Auto-create missing creatives that Meta reports metrics for
            // This catches ads that were missed during Phase 1 (filtered by campaign status, budget timeout, etc.)
            const missingAdIds = batchAdIds.filter((id: string) => !validAdIds.has(id));
            if (missingAdIds.length > 0) {
              const newCreatives = missingAdIds.map((adId: string) => ({
                ad_id: adId,
                account_id: accountId,
                ad_name: adId, // Placeholder — will be updated on next Phase 1
                platform: "meta",
                tag_source: "untagged",
                impressions: 0,
              }));
              const { error: insertErr } = await supabase
                .from("creatives")
                .upsert(newCreatives, { onConflict: "ad_id", ignoreDuplicates: true });
              if (insertErr) {
                console.error(`Auto-create creatives error: ${insertErr.message}`);
              } else {
                console.log(`    Auto-created ${missingAdIds.length} missing creatives from daily metrics`);
                // Add them to valid set so their daily rows get upserted
                for (const id of missingAdIds) validAdIds.add(id);
              }
            }

            const rows = result.data
              .filter((row: any) => {
                if (!validAdIds.has(row.ad_id)) return false;
                // date feeds the (ad_id, date) upsert key — a missing date_start would
                // silently corrupt daily attribution. Skip and record instead.
                if (!row.date_start) {
                  ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Phase 4: missing date_start for ad_id=${row.ad_id} — row skipped` });
                  return false;
                }
                return true;
              })
              .map((row: any) => {
                // US-003: persist the daily-grain play-curve + retention scalars
                // (US-001 columns) so the LOCAL snapshot rollup
                // (rollup_creatives_from_daily) can reconstruct the aggregate
                // retention curve from stored daily rows — no second Meta pull.
                // The parser's normalized `play_curve` number[] maps to the daily
                // jsonb column `video_play_curve_actions`.
                // Still stripped (not columns on creative_daily_metrics):
                // - result_count / cost_per_result: only on the creatives table.
                const { play_curve, result_count, cost_per_result, ...daily } =
                  parseInsightsRow(row, account?.optimization_goal);
                return {
                  ad_id: row.ad_id,
                  account_id: accountId,
                  date: row.date_start,
                  ...daily, // includes retention_p25/p50/p75/p100
                  video_play_curve_actions: play_curve,
                };
              });
            // Upsert in one call (up to 500 rows, matching Meta page size)
            if (rows.length > 0) {
              const { error } = await supabase.from("creative_daily_metrics").upsert(rows, { onConflict: "ad_id,date" });
              if (error) {
                console.error("Daily upsert error:", error.message);
                ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Daily upsert failed: ${error.message}` });
              }
            }
            console.log(`    Upserted ${rows.length} daily rows (${missingAdIds.length} auto-created)`);
          }
          nextUrl = result.next;
          if (nextUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
        }

        if (nextUrl && isTimedOut()) {
          console.log(`Phase 4 paused mid-chunk ${currentChunk + 1}`);
          await saveState(4, { daily_chunk_offset: currentChunk, daily_cursor: nextUrl, daily_days: dailyDays, daily_since_date: dailySinceDate });
          return;
        }

        paginationCursor = null;
        currentChunk++;
      }

      if (currentChunk >= totalChunks) {
        console.log("Phase 4 complete — moving to finalize");
        await saveState(5, { daily_chunk_offset: null, daily_cursor: null, daily_days: null, daily_since_date: null });
      } else {
        console.log(`Phase 4 paused after chunk ${currentChunk}`);
        await saveState(4, { daily_chunk_offset: currentChunk, daily_cursor: null, daily_days: dailyDays, daily_since_date: dailySinceDate });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 5: Finalize
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 5) {
      console.log("Phase 5: Finalizing...");

      // ── US-003: LOCAL rollup of the per-ad snapshot ──────────────────────
      // Replaces the old Phase-2 full-window Meta aggregate fetch. Now that
      // Phase 4 has written the daily rows for this run, recompute the
      // creatives snapshot (spend, roas, ctr, play_curve, retention_p*, …)
      // purely from creative_daily_metrics — zero extra Meta calls. The rollup
      // window matches the retention window we serve (up to RETENTION_DAYS,
      // never narrower than the configured date_range_days) so the snapshot
      // reflects the full promised history, not just the rolling recent window
      // Phase 4 re-pulled this run. Idempotent: re-running produces identical
      // totals. Non-fatal — a rollup failure must not abandon finalize.
      try {
        const rollupDays = Math.max(dateRangeDays, RETENTION_DAYS);
        const rollupFrom = new Date();
        rollupFrom.setDate(rollupFrom.getDate() - rollupDays);
        const rollupFromDate = rollupFrom.toISOString().split("T")[0];
        const rollupToDate = new Date().toISOString().split("T")[0];
        const { data: rolledCount, error: rollupErr } = await supabase.rpc(
          "rollup_creatives_from_daily",
          { p_account_id: accountId, p_from: rollupFromDate, p_to: rollupToDate },
        );
        if (rollupErr) {
          console.error("Local rollup RPC error:", rollupErr.message);
          ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Local snapshot rollup failed: ${rollupErr.message}` });
        } else {
          console.log(`  Local rollup: refreshed snapshot for ${rolledCount ?? 0} creatives (${rollupFromDate} → ${rollupToDate})`);
        }
      } catch (rollupCatch) {
        console.error("Local rollup error (non-fatal):", rollupCatch);
        ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Local snapshot rollup threw: ${String(rollupCatch)}` });
      }

      // ── Winner/concern Slack alert — runs AFTER the local rollup so it reads
      //    the freshly-recomputed snapshot (moved here from the old Phase 2). ──
      await runSnapshotAlerts(supabase, account, accountId);

      // ── Record last_data_sync — enables the rolling incremental window on the
      //    next run (moved here from the old Phase 2; the snapshot it gated is
      //    now produced by the rollup above). ──
      try {
        await supabase
          .from("ad_accounts")
          .update({ last_data_sync: new Date().toISOString() })
          .eq("id", accountId);
        console.log(`  Updated last_data_sync for ${account.name}`);
      } catch (syncTimestampErr) {
        console.error("Failed to update last_data_sync (non-fatal):", syncTimestampErr);
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Auto-tag untagged creatives via canonical parser + resolver (BATCHED) ──
      try {
        // Resolve the account's naming convention once; preload its name_mappings
        // into a Map keyed by unique_code. No manual layer in sync, so the locked
        // precedence reduces to: Coda(name_mappings) > parser > untagged.
        const convention = await resolveConvention(supabase, accountId);
        const { data: mappings } = await supabase
          .from("name_mappings")
          .select("*")
          .eq("account_id", accountId);
        const mappingByCode = new Map<string, Record<string, unknown>>();
        for (const m of (mappings || [])) {
          if (m.unique_code) mappingByCode.set(m.unique_code, m);
        }

        const { data: untagged } = await supabase
          .from("creatives")
          .select("ad_id, ad_name")
          .eq("account_id", accountId)
          .eq("tag_source", "untagged");

        // Batch: collect all updates, then update in chunks instead of one-by-one
        const tagUpdates: { ad_id: string; [k: string]: any }[] = [];
        for (const c of (untagged || [])) {
          const parsed = convention ? parseAdName(c.ad_name, convention) : null;
          const unique_code = parsed?.unique_code ?? (c.ad_name.split("_")[0] || c.ad_name);
          const { tags, tag_source } = resolveTags(
            parsedDisplayTags(parsed),
            mappingTags(mappingByCode.get(unique_code) ?? null),
            null,
          );
          if (tag_source === "untagged") continue;
          tagUpdates.push({
            ad_id: c.ad_id,
            tag_source,
            unique_code,
            ad_type: tags.ad_type,
            person: tags.person,
            style: tags.style,
            product: tags.product,
            hook: tags.hook,
            theme: tags.theme,
          });
        }
        // Batch update in chunks of 200 — check timeout between chunks
        let tagSuccessCount = 0;
        for (let i = 0; i < tagUpdates.length; i += 200) {
          if (isTimedOut()) {
            console.log(`  Auto-tag paused at ${i}/${tagUpdates.length} — budget exceeded`);
            break;
          }
          const chunk = tagUpdates.slice(i, i + 200);
          const results = await Promise.allSettled(chunk.map(row => {
            const { ad_id, ...fields } = row;
            return supabase.from("creatives").update(fields).eq("ad_id", ad_id);
          }));
          results.forEach((r, idx) => {
            if (r.status === "rejected") {
              ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Auto-tag failed for row ${i + idx}: ${r.reason}` });
            } else if (r.value?.error) {
              // PostgREST failures resolve (fulfilled) with { error } in the response —
              // they are NOT rejections. Without this check, failed tag writes were
              // counted as successes and the sync reported tags that never persisted.
              ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Auto-tag DB error for row ${i + idx}: ${r.value.error.message}` });
            } else {
              tagSuccessCount++;
            }
          });
        }
        if (tagUpdates.length > 0) console.log(`  Auto-tagged ${tagSuccessCount}/${tagUpdates.length} creatives from ad names`);
      } catch (autoErr) {
        console.error("Auto-tag error (non-fatal):", autoErr);
      }

      // Run both counts in parallel
      const [totalResult, untaggedResult] = await Promise.all([
        supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", accountId),
        supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", accountId).eq("tag_source", "untagged"),
      ]);

      await supabase.from("ad_accounts").update({
        creative_count: totalResult.count || 0, untagged_count: untaggedResult.count || 0,
        last_synced_at: new Date().toISOString(),
      }).eq("id", accountId);

      // Snapshot current ROAS → prior_roas for next sync's threshold comparison
      try {
        const { data: snapCount, error: snapErr } = await supabase.rpc("snapshot_prior_roas", { _account_id: accountId });
        if (snapErr) throw snapErr;
        console.log(`  Snapshotted prior_roas for ${snapCount} creatives`);
      } catch (priorErr) {
        console.error("prior_roas snapshot error (non-fatal):", priorErr);
      }

      // ── Record Creative Score snapshots (skip if running low on time) ──
      if (!isTimedOut()) {
        try {
          const { data: activeCreatives } = await supabase
            .from("creatives")
            .select("ad_id, roas, ctr, thumb_stop_rate, cpa, spend, ad_status")
            .eq("account_id", accountId)
            .gt("spend", 0)
            .gt("impressions", 0);

          if (activeCreatives && activeCreatives.length > 0) {
            const scaleThreshold = account.scale_threshold || 2.0;
            const ctrBenchmark = 3.0;
            const hookRateBenchmark = 25.0;

            const withCpa = activeCreatives.filter((c: any) => (Number(c.cpa) || 0) > 0);
            const avgCpa = withCpa.length > 0
              ? withCpa.reduce((s: number, c: any) => s + (Number(c.cpa) || 0), 0) / withCpa.length
              : 0;

            const scoreRows: any[] = [];
            for (const c of activeCreatives) {
              if (c.ad_status === "PAUSED") continue;
              const roas = Number(c.roas) || 0;
              const ctr = Number(c.ctr) || 0;
              const hookRate = Number(c.thumb_stop_rate) || 0;
              const cpa = Number(c.cpa) || 0;
              const roasComp = Math.round(Math.min(1, roas / scaleThreshold) * 35);
              const ctrComp = Math.round(Math.min(1, ctr / ctrBenchmark) * 20);
              const hookComp = Math.round(Math.min(1, hookRate / hookRateBenchmark) * 15);
              let cpaComp = 0;
              if (avgCpa > 0 && cpa > 0) {
                const ratio = cpa / avgCpa;
                if (ratio <= 1) cpaComp = 10;
                else if (ratio < 2) cpaComp = Math.round(10 * (1 - (ratio - 1)));
              }
              const momentumComp = 5;
              const fatigueComp = 0;
              const total = Math.max(0, Math.min(100, roasComp + ctrComp + hookComp + cpaComp + momentumComp + fatigueComp));
              scoreRows.push({
                ad_id: c.ad_id, account_id: accountId, score: total,
                roas_component: roasComp, ctr_component: ctrComp, hook_rate_component: hookComp,
                spend_efficiency_component: cpaComp, momentum_component: momentumComp, fatigue_component: fatigueComp,
              });
            }

            for (let i = 0; i < scoreRows.length; i += 500) {
              if (isTimedOut()) { console.log("  Score snapshots paused — budget exceeded"); break; }
              const chunk = scoreRows.slice(i, i + 500);
              const { error: scoreErr } = await supabase.from("score_history").insert(chunk);
              if (scoreErr) console.error("Score history insert error (non-fatal):", scoreErr.message);
            }
            console.log(`  Recorded score snapshots for ${scoreRows.length} creatives`);
          }
        } catch (scoreHistoryErr) {
          console.error("Score history error (non-fatal):", scoreHistoryErr);
        }
      } else {
        console.log("  Skipping score snapshots — budget exceeded");
      }

      // Get users linked to this account (for notifications AND audit drift alerts)
      // Hoisted above changelog block so it's in scope for the audit block too
      const { data: userLinks } = await supabase.from("user_accounts").select("user_id").eq("account_id", accountId);
      const userIds = (userLinks || []).map((l: any) => l.user_id);

      // ── Auto-log changelog + notifications (consolidated single query) ──
      try {
        const scaleThreshold = account.scale_threshold || 2.0;
        const killThreshold = account.kill_threshold || 1.0;

        // Single query for all creatives with prior_roas — used by changelog AND notifications
        const { data: allCreatives } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, roas, prior_roas, spend, ad_status")
          .eq("account_id", accountId)
          .gt("impressions", 0);

        const changelogEntries: any[] = [];
        const notifications: any[] = [];

        for (const c of (allCreatives || [])) {
          const currentRoas = Number(c.roas) || 0;
          const priorRoas = Number(c.prior_roas) || 0;
          const spend = Number(c.spend) || 0;

          // New creative with spend detected
          if (spend > 0 && c.prior_roas === null) {
            changelogEntries.push({
              account_id: accountId, ad_id: c.ad_id, event_type: "new_creative",
              description: `New creative detected: ${c.ad_name}`,
              metadata: { ad_name: c.ad_name, spend, roas: currentRoas },
            });
          }

          // ROAS changed by >20%
          if (priorRoas > 0 && currentRoas > 0) {
            const pctChange = ((currentRoas - priorRoas) / priorRoas) * 100;
            if (Math.abs(pctChange) > 20) {
              changelogEntries.push({
                account_id: accountId, ad_id: c.ad_id, event_type: "roas_change",
                description: `${c.ad_name} ROAS ${pctChange > 0 ? "increased" : "decreased"} by ${Math.abs(pctChange).toFixed(0)}%`,
                old_value: priorRoas, new_value: currentRoas,
                metadata: { pct_change: pctChange, ad_name: c.ad_name },
              });
            }
          }

          // Crossed scale threshold
          if (priorRoas > 0 && currentRoas >= scaleThreshold && priorRoas < scaleThreshold) {
            changelogEntries.push({
              account_id: accountId, ad_id: c.ad_id, event_type: "threshold_crossed",
              description: `${c.ad_name} crossed scale threshold (${scaleThreshold}x ROAS)`,
              old_value: priorRoas, new_value: currentRoas,
              metadata: { threshold: "scale", threshold_value: scaleThreshold },
            });
            // Winner notification
            for (const uid of userIds) {
              notifications.push({
                user_id: uid, account_id: accountId, type: "winner",
                title: `🏆 New winner: ${c.ad_name}`,
                body: `ROAS hit ${currentRoas.toFixed(1)}x, crossing the ${scaleThreshold}x scale threshold.`,
              });
            }
          }

          // Dropped below kill threshold
          if (priorRoas > 0 && currentRoas < killThreshold && priorRoas >= killThreshold && spend > 0) {
            changelogEntries.push({
              account_id: accountId, ad_id: c.ad_id, event_type: "threshold_crossed",
              description: `${c.ad_name} dropped below kill threshold (${killThreshold}x ROAS)`,
              old_value: priorRoas, new_value: currentRoas,
              metadata: { threshold: "kill", threshold_value: killThreshold },
            });
            // Concern notification
            for (const uid of userIds) {
              notifications.push({
                user_id: uid, account_id: accountId, type: "concern",
                title: `⚠️ Underperformer: ${c.ad_name}`,
                body: `ROAS dropped to ${currentRoas.toFixed(1)}x, below the ${killThreshold}x kill threshold.`,
              });
            }
          }
        }

        // Check paused creatives (zero spend with prior data)
        const { data: pausedCreatives } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, prior_roas")
          .eq("account_id", accountId)
          .eq("spend", 0)
          .not("prior_roas", "is", null)
          .gt("prior_roas", 0);

        for (const c of (pausedCreatives || [])) {
          changelogEntries.push({
            account_id: accountId, ad_id: c.ad_id, event_type: "creative_paused",
            description: `${c.ad_name} has no spend (was ${Number(c.prior_roas).toFixed(1)}x ROAS)`,
            metadata: { prior_roas: c.prior_roas },
          });
        }

        // Sync complete notification
        for (const uid of userIds) {
          notifications.push({
            user_id: uid, account_id: accountId, type: "sync",
            title: `Sync complete: ${account.name}`,
            body: `${totalResult.count || 0} creatives synced.`,
          });
        }

        // Insert ALL changelog entries in chunks — the old slice(0, 50) cap silently
        // dropped every event past 50, so active accounts missed most notifications.
        for (let i = 0; i < changelogEntries.length; i += 100) {
          const batch = changelogEntries.slice(i, i + 100);
          const { error: clErr } = await supabase.from("performance_changelog").insert(batch);
          if (clErr) console.error("Changelog insert error (non-fatal):", clErr.message);
        }
        if (changelogEntries.length > 0) console.log(`  Logged ${changelogEntries.length} changelog entries`);

        for (let i = 0; i < notifications.length; i += 100) {
          const batch = notifications.slice(i, i + 100);
          const { error: notifErr } = await supabase.from("notifications").insert(batch);
          if (notifErr) console.error("Notification insert error (non-fatal):", notifErr.message);
        }
        if (notifications.length > 0) console.log(`  Created ${notifications.length} notifications`);
      } catch (changelogNotifErr) {
        console.error("Changelog/notification error (non-fatal):", changelogNotifErr);
      }

      // ── Post-Sync Spend Audit ──────────────────────────────────────────
      // Compare local daily totals against Meta account-level spend
      let auditResult: any = null;
      if (!isTimedOut()) {
        try {
          // Use the metaToken parameter (already validated) — don't re-read from env
          if (metaToken) {
            const auditEnd = new Date().toISOString().split("T")[0];
            // Use the account's full date_range_days for audit (matches spend diagnostic)
            const auditDays = account.date_range_days || 180;
            const auditStartDate = new Date();
            auditStartDate.setDate(auditStartDate.getDate() - auditDays);
            const auditStart = auditStartDate.toISOString().split("T")[0];
            const auditTimeRange = JSON.stringify({ since: auditStart, until: auditEnd });

            // Fetch Meta account-level spend
            const auditUrl =
              `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
              `time_range=${encodeURIComponent(auditTimeRange)}` +
              `&fields=spend,impressions,purchases,purchase_roas` +
              `&${attributionSetting}` +
              `&access_token=${encodeURIComponent(metaToken)}`;

            const auditResp = await fetch(auditUrl);
            const auditJson = await auditResp.json();
            ctx.metaApiCalls++;

            if (auditJson.data && auditJson.data.length > 0 && !auditJson.error) {
              const metaSpend = parseFloat(auditJson.data[0].spend || "0");
              const metaImpressions = parseInt(auditJson.data[0].impressions || "0");

              // Sum local daily metrics (paginated)
              let localSpend = 0;
              let localImpressions = 0;
              let localAdIds = 0;
              let offset = 0;
              let auditComplete = true;
              const PAGE = 1000;
              while (true) {
                if (isTimedOut()) {
                  // Partial sums must not masquerade as a completed audit — they read
                  // as massive under-reporting and would fire false drift alerts.
                  console.warn("  Post-sync audit interrupted by budget — marking incomplete");
                  auditComplete = false;
                  break;
                }
                const { data: rows } = await supabase
                  .from("creative_daily_metrics")
                  .select("spend, impressions")
                  .eq("account_id", accountId)
                  .gte("date", auditStart)
                  .lte("date", auditEnd)
                  .range(offset, offset + PAGE - 1);
                if (!rows || rows.length === 0) break;
                for (const r of rows) {
                  localSpend += r.spend || 0;
                  localImpressions += r.impressions || 0;
                  localAdIds++;
                }
                if (rows.length < PAGE) break;
                offset += PAGE;
              }

              const spendDelta = localSpend - metaSpend;
              const spendDeltaPct = metaSpend > 0 ? (spendDelta / metaSpend) * 100 : 0;
              const driftExceeded = auditComplete && Math.abs(spendDeltaPct) >= 2;

              auditResult = {
                audit_complete: auditComplete,
                meta_spend: Math.round(metaSpend * 100) / 100,
                local_spend: Math.round(localSpend * 100) / 100,
                spend_delta: Math.round(spendDelta * 100) / 100,
                spend_delta_pct: Math.round(spendDeltaPct * 100) / 100,
                meta_impressions: metaImpressions,
                local_impressions: localImpressions,
                date_range: { since: auditStart, until: auditEnd },
                drift_exceeded: driftExceeded,
              };

              console.log(`  📊 Post-sync audit: Meta=$${metaSpend.toFixed(2)} Local=$${localSpend.toFixed(2)} Delta=${spendDeltaPct.toFixed(1)}% ${driftExceeded ? "⚠️ DRIFT" : "✅ OK"}`);

              // Send drift warning notification (inserted directly, not through batch)
              if (driftExceeded) {
                const direction = spendDelta < 0 ? "under-reporting" : "over-reporting";
                const driftNotifs = userIds.map((uid: string) => ({
                  user_id: uid, account_id: accountId, type: "concern",
                  title: `⚠️ Data drift detected: ${account.name}`,
                  body: `Local spend is ${direction} by ${Math.abs(spendDeltaPct).toFixed(1)}% vs Meta ($${Math.abs(spendDelta).toFixed(0)} gap). Run a full re-sync or check the Spend Diagnostic.`,
                }));
                if (driftNotifs.length > 0) {
                  await supabase.from("notifications").insert(driftNotifs);
                }
              }
            }
          }
        } catch (auditErr) {
          console.error("Post-sync audit error (non-fatal):", auditErr);
        }
      } else {
        console.log("  Skipping post-sync audit — budget exceeded");
      }

      // US-011 cutover: media caching is now event-driven. Phase 1 already ENQUEUED
      // only the ads this run newly inserted (US-008 → media_cache_queue), and the
      // in-stack drain-media-queue worker (US-010) discovers + caches exactly those,
      // short-circuiting any ad already cached to storage. The old blind fanout —
      // `enrich-thumbnails?scope=all`, which re-scanned the WHOLE account (every
      // creative, cached or not) on every sync — is RETIRED here: that path re-touched
      // already-cached media and wasted Meta discovery budget, the exact churn this
      // workstream removes. We just POKE the queue drain so newly-enqueued ads are
      // picked up promptly; the drain's own pg_cron + self-chain handle the rest. A
      // poke that finds an empty queue is a cheap no-op (claims 0 rows, chains
      // nothing). Awaited so the request leaves before the isolate is torn down.
      // enrich-thumbnails is kept ONLY for manual repair/force flows (scope=repair /
      // force / force-video) — it is no longer on any sync or cron path.
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/drain-media-queue`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: "{}",
        });
        console.log(`  Media queue drain poked for account ${accountId}`);
      } catch (enrichErr) {
        console.error("drain-media-queue poke error (non-fatal):", enrichErr);
        ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Media queue drain poke failed: ${String(enrichErr)}` });
      }

      const finalStatus = countRealErrors([...JSON.parse(syncLog.api_errors || "[]"), ...ctx.apiErrors]) > 0 ? "completed_with_errors" : "completed";
      // Save audit result to sync_state for visibility
      await saveState(5, { audit: auditResult }, finalStatus);
      console.log(`\n✅ Sync complete for ${account.name}: ${finalStatus}`);
      return;
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Phase ${phase} error:`, errMsg);
    ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: errMsg });
    try {
      await supabase.from("sync_logs").update({
        status: "failed",
        api_errors: JSON.stringify([...JSON.parse(syncLog.api_errors || "[]"), ...ctx.apiErrors]),
        completed_at: new Date().toISOString(),
        duration_ms: (syncLog.duration_ms || 0) + (Date.now() - startMs),
      }).eq("id", syncLog.id);
    } catch (saveErr) {
      // If this save is lost the sync is stranded: cleanup-stuck-syncs only rescues
      // `running` rows, so a missed `failed` write means nobody ever retries it.
      // One minimal retry covers transient DB blips.
      console.error("Failed to mark sync failed — retrying with minimal fields:", saveErr);
      try {
        await supabase.from("sync_logs").update({
          status: "failed",
          completed_at: new Date().toISOString(),
        }).eq("id", syncLog.id);
      } catch (_) {
        console.error("Failed to save error status (unrecoverable) — sync row may be stranded");
      }
    }
    await promoteNextQueued(supabase);
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

// SYNC_NO_SERVE lets tests import this module (for metaFetch) without binding a server.
const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/sync\/?/, "").replace(/\/$/, "");

  // Auth: validate user token or cron anon key
  // The Supabase gateway validates the JWT/apikey before the function runs.
  // For user-initiated actions (sync start, cancel, history), we additionally verify role.
  // Only /continue (self-invoked with service role key) bypasses additional auth checks.
  const isCronSafePath = path === "continue";
  if (!isCronSafePath) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const authToken = authHeader.replace("Bearer ", "");

    // Check if this is a cron/anon-key call: the Supabase gateway already validates the JWT,
    // so if the token decodes to role=anon, it's a valid cron call.
    // service_role is also a trusted automated caller — scheduled-sync triggers
    // POST /sync with the service-role key, and /continue already runs under it.
    // Without this, the automated sync path 401s (getUser() rejects a non-user JWT).
    // Also accept new-format publishable keys (sb_publishable_*) — same trust level as anon JWT.
    let isAnonKey = false;
    try {
      const payload = JSON.parse(atob(authToken.split(".")[1]));
      isAnonKey = payload.role === "anon" || payload.role === "service_role";
    } catch (_) { /* not a JWT */ }

    const isPublishableKey = authToken.startsWith("sb_publishable_");
    // New-format secret API key (sb_secret_*) — the service-role-equivalent.
    // This is what scheduled-sync / the pg_cron job actually forward, and it is
    // NOT a JWT (no .role claim), so the payload check above never matches it.
    // Trust it like service_role; without this the automated sync path 401s.
    const isSecretKey = authToken.startsWith("sb_secret_");

    if (!isAnonKey && !isPublishableKey && !isSecretKey) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
      if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      // Fetch ALL role rows (a user may hold multiple) — `.single()` throws on >1
      // rows, turning a legitimate multi-role staff user into a spurious 500.
      const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const roles = (roleRows || []).map((r: { role: string }) => r.role);
      if (!roles.includes("builder") && !roles.includes("employee")) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
  }

  try {
    // ─── GET /sync/history ─────────────────────────────────────────────
    if (req.method === "GET" && path.startsWith("history")) {
      const historyId = path.replace("history/", "").replace("history", "");
      if (historyId && historyId !== "") {
        const { data, error } = await supabase.from("sync_logs").select("*").eq("id", historyId).single();
        if (error) throw error;
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const accountId = url.searchParams.get("account_id");
      const limit = parseInt(url.searchParams.get("limit") || "20");
      let query = supabase.from("sync_logs").select("*").order("started_at", { ascending: false }).limit(limit);
      if (accountId) query = query.eq("account_id", accountId);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── POST /sync/cancel ─────────────────────────────────────────────
    if (req.method === "POST" && path === "cancel") {
      const { data: activeSyncs } = await supabase.from("sync_logs").select("id, started_at").in("status", ["running", "queued"]);
      if (!activeSyncs?.length) {
        return new Response(JSON.stringify({ message: "No running sync to cancel" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const now = new Date().toISOString();
      await supabase.from("sync_logs").update({
        status: "cancelled",
        api_errors: JSON.stringify([{ timestamp: now, message: "Cancelled by user" }]),
        completed_at: now,
      }).in("id", activeSyncs.map((s: any) => s.id));
      return new Response(JSON.stringify({ cancelled: activeSyncs.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── POST /sync/continue ───────────────────────────────────────────
    if (req.method === "POST" && path === "continue") {
      const body = await req.json().catch(() => ({}));
      const incomingClaimId: string | null = body.claim_id ?? null;

      const { data: runningSyncs } = await supabase.from("sync_logs")
        .select("*")
        .eq("status", "running")
        .order("started_at", { ascending: true });

      if (!runningSyncs?.length) {
        await promoteNextQueued(supabase);
        return new Response(JSON.stringify({ message: "No syncs to continue, promoted queued if any" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Enforce single-runner: if multiple are "running", demote all but the oldest back to queued
      if (runningSyncs.length > 1) {
        const extraIds = runningSyncs.slice(1).map((s: any) => s.id);
        await supabase.from("sync_logs")
          .update({ status: "queued" })
          .in("id", extraIds);
        console.log(`Demoted ${extraIds.length} extra running sync(s) back to queued: ${extraIds.join(", ")}`);
      }

      const syncLog = runningSyncs[0];

      let metaToken = Deno.env.get("META_ACCESS_TOKEN");
      if (!metaToken) {
        const { data: tokenRow } = await supabase.from("settings").select("value").eq("key", "meta_access_token").single();
        metaToken = tokenRow?.value || null;
      }
      if (!metaToken) {
        return new Response(JSON.stringify({ error: "No Meta token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // DB-level mutex: atomic claim via claim_sync_continue RPC.
      // Two concurrent callers both pass the status='running' check above; the RPC's WHERE
      // requires an exact claim_id match (chain continuation) or accepts a null claim
      // only when no active claim exists or last_activity went stale (>90s).
      // Postgres serializes concurrent UPDATEs on the same row, so only one caller wins.
      const newClaimId = crypto.randomUUID();
      const { data: claimResult, error: claimError } = await supabase.rpc("claim_sync_continue", {
        p_sync_id: syncLog.id,
        p_old_claim: incomingClaimId,
        p_new_claim: newClaimId,
      });

      if (claimError || !claimResult || claimResult.length === 0) {
        const reason = claimError ? `rpc_error: ${claimError.message}` : "claim_lost";
        console.log(`Sync ${syncLog.id} claim failed (${reason}) — concurrent caller won or stale continue`);
        return new Response(JSON.stringify({ skipped: syncLog.id, reason }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const claimed = claimResult[0];

      await runSyncPhase(supabase, claimed, metaToken);

      // Auto-continue: fire unconditionally so the next phase of the current sync (if still
      // running) OR the next promoted queued sync gets picked up immediately.
      await selfContinue(newClaimId);

      return new Response(JSON.stringify({ continued: syncLog.id, phase: syncLog.current_phase }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── POST /sync ────────────────────────────────────────────────────
    if (req.method === "POST" && !path) {
      const body = await req.json();
      const { account_id, sync_type = "manual", sync_scope = "full" } = body;
      // sync_scope controls which phases run:
      //   "full"     = phases 1-5 (default)
      //   "metadata" = phase 1 only (ads metadata)
      //   "insights" = phases 2-3 (aggregated insights + cleanup)
      //   "daily"    = phase 4 only (daily breakdowns)
      //   "lite"     = phases 1-3 (skip daily breakdowns)

      // Check if requested accounts are already running/queued (allow queuing new ones)
      const { data: activeSyncs } = await supabase.from("sync_logs").select("id, account_id, status").in("status", ["running", "queued"]);
      const activeAccountIds = new Set((activeSyncs || []).map((s: any) => s.account_id));

      let metaToken = Deno.env.get("META_ACCESS_TOKEN");
      if (!metaToken) {
        const { data: tokenRow } = await supabase.from("settings").select("value").eq("key", "meta_access_token").single();
        metaToken = tokenRow?.value || null;
      }
      if (!metaToken) return new Response(JSON.stringify({ error: "No Meta access token configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      let accounts: any[] = [];
      if (account_id && account_id !== "all") {
        const { data } = await supabase.from("ad_accounts").select("*").eq("id", account_id).single();
        if (data) accounts = [data];
      } else {
        const { data } = await supabase.from("ad_accounts").select("*").eq("is_active", true);
        accounts = data || [];
      }
      if (!accounts.length) return new Response(JSON.stringify({ error: "No accounts to sync" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const created: any[] = [];
      const insertErrors: Array<{ account_id: string; error: string }> = [];

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];

        // Skip accounts that already have an active sync
        if (activeAccountIds.has(account.id)) {
          console.log(`Skipping ${account.name} — already running/queued`);
          continue;
        }

        const dateRangeDays = sync_type === "initial" ? 90 : (account.date_range_days || 14);
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - dateRangeDays);

        // Always insert as "queued" — promotion happens after insert
        const { data: logEntry, error: logError } = await supabase.from("sync_logs").insert({
          account_id: account.id, sync_type,
          status: "queued",
          current_phase: 1,
          sync_state: { last_activity: new Date().toISOString(), sync_scope },
          date_range_start: startDate.toISOString().split("T")[0],
          date_range_end: endDate.toISOString().split("T")[0],
        }).select().single();

        if (logError) {
          console.error("Log create error:", logError);
          insertErrors.push({ account_id: account.id, error: logError.message });
          continue;
        }
        created.push({ id: logEntry.id, account_id: account.id, account_name: account.name });
      }

      if (!created.length) {
        // Distinguish a real failure (every insert errored — e.g. a check-constraint
        // violation) from the benign "all accounts already have an active sync" case.
        // Returning 200 for an insert failure made callers (scheduled-sync) treat a
        // dead sync as success and advance next_sync_at, silently freezing data.
        if (insertErrors.length) {
          return new Response(
            JSON.stringify({ error: "Failed to enqueue sync", insert_errors: insertErrors }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ message: "All requested accounts already syncing" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // After inserting, check if there's already a running sync.
      // If not, promote the oldest queued sync (which may be one we just created).
      const { data: currentRunning } = await supabase.from("sync_logs")
        .select("id")
        .eq("status", "running")
        .limit(1);

      if (!currentRunning?.length) {
        // No running sync — promote the oldest queued
        const { data: oldest } = await supabase.from("sync_logs")
          .select("*")
          .eq("status", "queued")
          .order("started_at", { ascending: true })
          .limit(1);

        if (oldest?.length) {
          const initialClaimId = crypto.randomUUID();
          // Atomically promote only if still queued (prevents race condition).
          // Seed claim_id so /continue callers must pass it for chain continuation.
          const { data: promoted, error: promoteErr } = await supabase.from("sync_logs")
            .update({ status: "running", sync_state: { ...oldest[0].sync_state, last_activity: new Date().toISOString(), claim_id: initialClaimId } })
            .eq("id", oldest[0].id)
            .eq("status", "queued")  // only if still queued
            .select()
            .single();

          if (promoted && !promoteErr) {
            console.log(`Promoted sync ${promoted.id} for ${promoted.account_id}`);
            // Run first phase inline
            await runSyncPhase(supabase, promoted, metaToken);
            // Auto-continue: if still running after first phase, self-invoke
            const { data: postCheck } = await supabase.from("sync_logs")
              .select("status").eq("id", promoted.id).single();
            if (postCheck?.status === "running") {
              await selfContinue(initialClaimId);
            }
          }
        }
      }

      return new Response(JSON.stringify({ started: created }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Sync error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

if (!Deno.env.get("SYNC_NO_SERVE")) serve(handler);
