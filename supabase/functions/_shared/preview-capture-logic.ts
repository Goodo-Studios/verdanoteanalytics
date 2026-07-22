// =============================================================================
// preview-capture-logic — PURE, I/O-free decision + parse helpers for the FREE
// preview-extraction capture mechanism (Apify → preview pivot).
// =============================================================================
// Everything the preview-capture edge function decides that does NOT touch the
// network, Deno, or Supabase lives here so it can be unit-tested with fixtures
// (deno test) shaped from the proven spike/yield/static-coverage evidence.
// index.ts is then a thin shell: gate → Tier A (video plugin) → Tier B (previews
// edge → iframe) → download+store → update rows, delegating every branch here.
//
// Locked facts (companies/verdanote/projects/apify-creative-capture/
// preview-extraction-{spike,yield}.md + static-coverage-check.md — do not deviate):
//   * TIER A (video only, FREE, zero Meta quota): the public Facebook video plugin
//     plugins/video.php?href=<url-enc https://www.facebook.com/video.php?v=<vid>>
//     yields directly-downloadable hd_src/sd_src fbcdn .mp4 URLs (~56% hit). A
//     "Video Unavailable" stub is NOT terminal — fall through to Tier B.
//   * TIER B (video misses + ALL statics, metered): Graph /{ad_id}/previews →
//     preview_iframe.php URL → fetch with Referer: https://business.facebook.com/
//     PLUS Sec-Fetch-Dest:iframe / Sec-Fetch-Mode:navigate / Sec-Fetch-Site:
//     same-origin (Referer alone now 400s) → parse fbcdn media (video
//     videoHdUrl/videoSdUrl; image HIGHEST-res scontent/fbcdn; carousel frames).
//   * fbcdn URLs are short-lived → the caller downloads bytes SERVER-SIDE
//     immediately, in the same job/egress region.
//   * Meta quota is app-wide (policy verdanote-meta-rate-limit-is-app-wide). Tier A
//     costs no Meta quota. Tier B parses x-app-usage / x-business-use-case-usage on
//     EVERY Graph response and pauses >75% / stops >90%, with a >=15s floor between
//     Graph calls, unconditionally. Capture is FREE — there is NO budget ledger.
// =============================================================================

// -- Retry cap: at most 3 attempts, then terminal 'failed'. --------------------
export const CAPTURE_MAX_ATTEMPTS = 3;

// Storage-ownership marker — the TS mirror of the SQL predicate
// `%/storage/v1/object/public/%` used for "already covered". Kept as a local
// constant so this module stays dependency-free and unit-testable without the Deno
// fetch runtime; the two predicates are intentionally identical.
export const STORAGE_URL_MARKER = "/storage/v1/object/public/";

/** True when a url is a permanent Supabase-Storage (owned) url, not a CDN link. */
export function isStorageOwnedUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes(STORAGE_URL_MARKER);
}

// =============================================================================
// 1. Skip gates
// =============================================================================

export interface CreativeMediaCurrent {
  video_url: string | null | undefined;
  full_res_url: string | null | undefined;
  thumbnail_url?: string | null | undefined;
  image_quality?: string | null | undefined;
}

/** Already-covered gate: storage-owned video OR full-res static present → skip
 *  'already_covered' unless force. */
export function alreadyCovered(current: CreativeMediaCurrent): boolean {
  return isStorageOwnedUrl(current.video_url) || isStorageOwnedUrl(current.full_res_url);
}

/** Media intent — the ad genuinely carries capturable media: a video (meta_video_ids)
 *  OR statics (meta_image_hashes → an image / carousel ad). The free preview surface
 *  can only capture those two; a pure text/no-media ad has no capture path. */
export function hasVideoIntent(
  creative: { meta_video_ids?: unknown },
): boolean {
  return Array.isArray(creative.meta_video_ids) && creative.meta_video_ids.length > 0;
}
export function isImageAd(
  creative: { meta_image_hashes?: unknown },
): boolean {
  return Array.isArray(creative.meta_image_hashes) && creative.meta_image_hashes.length > 0;
}

/** Returns 'no_media_intent' when the ad has neither video ids nor image hashes
 *  (no preview-capturable media), else null (proceed). NO archive-id gate — the
 *  preview surface is ad-scoped by construction (keys on ad_id). */
export function mediaIntentSkipReason(
  creative: { meta_video_ids?: unknown; meta_image_hashes?: unknown },
): "no_media_intent" | null {
  if (hasVideoIntent(creative) || isImageAd(creative)) return null;
  return "no_media_intent";
}

// =============================================================================
// 2. Tier A — public Facebook video plugin (FREE, zero Meta quota)
// =============================================================================

/**
 * Build THE Tier-A public video-plugin URL for a Meta video id (spike shape):
 *   https://www.facebook.com/plugins/video.php?href=<url-enc
 *     https://www.facebook.com/video.php?v=<vid>>&show_text=false
 * Plain fetch (desktop UA, no cookies) — NOT a Graph call, so $0 / zero quota.
 */
export function buildVideoPluginUrl(videoId: string): string {
  const href = `https://www.facebook.com/video.php?v=${encodeURIComponent(String(videoId))}`;
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`;
}

/** True when a url's host ends in .fbcdn.net (Meta's only media host). */
export function isFbcdnHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}

/** Unescape the JSON-embedded form fbcdn urls arrive in inside plugin/iframe HTML
 *  (`https:\/\/…` and `%` for %, plus `&amp;`). */
function unescapeHtmlJson(s: string): string {
  return s.replace(/\\\//g, "/").replace(/\\u0025/gi, "%").replace(/&amp;/g, "&");
}

/**
 * Rank fbcdn .mp4 candidates out of plugin/iframe HTML: explicit hd_src first, then
 * sd_src, then any generic fbcdn .mp4 — deduped, fbcdn-host-only. Mirrors the proven
 * harness extract_fbcdn_mp4 ordering exactly.
 */
export function rankVideoCandidates(html: string): string[] {
  if (!html) return [];
  const unesc = unescapeHtmlJson(html);
  const grab = (re: RegExp, src: string): string[] =>
    [...src.matchAll(re)].map((m) => unescapeHtmlJson(m[1]));
  // hd_src / sd_src carry the JSON-escaped form, so match on the RAW html.
  const hd = grab(/"hd_src(?:_no_ratelimit)?":"(https:[^"]+?\.mp4[^"]*)"/g, html);
  const sd = grab(/"sd_src(?:_no_ratelimit)?":"(https:[^"]+?\.mp4[^"]*)"/g, html);
  const generic = [...unesc.matchAll(/(https:\/\/[^"'\\\s]*\.fbcdn\.net\/[^"'\\\s]*\.mp4[^"'\\\s]*)/g)]
    .map((m) => m[1]);
  const ranked: string[] = [];
  const seen = new Set<string>();
  for (const group of [hd, sd, generic]) {
    for (const u of group) {
      if (isFbcdnHost(u) && !seen.has(u)) {
        seen.add(u);
        ranked.push(u);
      }
    }
  }
  return ranked;
}

export interface PluginVideoParse {
  /** Best downloadable video url (hd → sd → generic), or null. */
  url: string | null;
  /** Ranked candidates (best first) for fallback download on the first's expiry. */
  candidates: string[];
  /** The public plugin returned a "Video Unavailable" stub — NOT terminal; the
   *  previews-edge (Tier B) surface renders these exact ads. */
  unavailable: boolean;
}

/** Parse a Tier-A plugin response body for a downloadable fbcdn .mp4. */
export function parsePluginVideo(html: string): PluginVideoParse {
  const candidates = rankVideoCandidates(html);
  const unavailable =
    /Video Unavailable/i.test(html) || /"isPlayable":\s*false/i.test(html);
  return { url: candidates[0] ?? null, candidates, unavailable };
}

// =============================================================================
// 3. Tier B — previews edge → preview_iframe.php (metered)
// =============================================================================

// The app's format order — MOBILE_FEED_STANDARD resolved ~100% of Tier-B ads on the
// first try in the yield/static runs; keep the full ladder for safety.
export const PREVIEW_FORMATS = [
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "FACEBOOK_STORY_MOBILE",
] as const;

export const META_API_VERSION = "v22.0";

// Mandatory iframe fetch headers. Referer ALONE now returns HTTP 400 — the
// Sec-Fetch-* triad is load-bearing (yield run finding; drift-alarmed in health).
export const IFRAME_HEADERS: Record<string, string> = {
  Referer: "https://business.facebook.com/",
  "Sec-Fetch-Dest": "iframe",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
};

// Unconditional floor between Graph calls (shared app-wide quota).
export const GRAPH_MIN_INTERVAL_MS = 15_000;

/**
 * Build the Graph /{ad_id}/previews URL for a format. The access token is passed in
 * by the caller (read server-side from env/settings exactly as ad-preview does) and
 * is NEVER printed. Pure string construction.
 */
export function buildPreviewsUrl(
  adId: string,
  format: string,
  token: string,
  apiVersion: string = META_API_VERSION,
): string {
  return `https://graph.facebook.com/${apiVersion}/${adId}/previews?ad_format=${format}&access_token=${token}`;
}

/**
 * Extract the preview_iframe.php URL from a Graph /previews response's data[0].body
 * (or the whole JSON string). Decodes HTML entities. Returns the url or null.
 */
export function extractIframeUrl(graphBody: string): string | null {
  if (!graphBody) return null;
  const m = graphBody.match(/https?:\/\/[^"'\s\\]*preview_iframe\.php[^"'\s\\]*/);
  if (!m) return null;
  return m[0].replace(/&amp;/g, "&").replace(/&#0?37;/g, "%").replace(/&#37;/g, "%");
}

// -- fbcdn image ranking (statics + carousel frames) --------------------------
// Chrome/logo exclusions (rsrc.php scaffolding, emoji, safe_image proxy, spacers).
const IMAGE_EXCLUDE = /rsrc\.php|\/emoji|safe_image|spacer|blank\.gif/i;

/** Extract a resolution hint (max dimension) from fbcdn size tokens
 *  (s960x960 / p320x320 / stp=…941x1254…). 0 when none present. */
export function imageSizeHint(url: string): number {
  let best = 0;
  for (const m of url.matchAll(/[sp](\d{2,4})x(\d{2,4})/g)) {
    best = Math.max(best, Number(m[1]), Number(m[2]));
  }
  for (const m of url.matchAll(/stp=[^&]*?(\d{3,4})x(\d{3,4})/g)) {
    best = Math.max(best, Number(m[1]), Number(m[2]));
  }
  return best;
}

/** Stable media id for dedup: the numeric media stem, else the path leaf. */
export function imageId(url: string): string {
  let m = url.match(/\/([0-9]{6,})_([0-9]{6,})_[0-9]+_[a-z]/);
  if (m) return m[2];
  m = url.match(/\/(\d{8,})_/);
  if (m) return m[1];
  try {
    const p = new URL(url).pathname;
    return (p.split("/").pop() ?? "").split(".")[0].slice(0, 40);
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * Rank distinct fbcdn IMAGE urls out of iframe HTML, highest-resolution first, one
 * url per distinct media id (so a carousel yields one url per card). Prefers the
 * high-signal sources (og:image / original_image_url / image.uri) as the tiebreak,
 * excludes UI chrome. Mirrors the static-coverage harness extract_images.
 */
export function rankImageCandidates(html: string): string[] {
  if (!html) return [];
  const unesc = unescapeHtmlJson(html);
  type Cand = { url: string; priority: number; size: number };
  const cands: Cand[] = [];
  const add = (raw: string, priority: number) => {
    const u = unescapeHtmlJson(raw);
    if (u.startsWith("http") && isFbcdnHost(u) && !IMAGE_EXCLUDE.test(u)) {
      cands.push({ url: u, priority, size: imageSizeHint(u) });
    }
  };
  const grab = (re: RegExp, priority: number) => {
    for (const m of unesc.matchAll(re)) add(m[1], priority);
  };
  grab(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/g, 0);
  grab(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/g, 0);
  grab(/"original_image_url":"([^"]+)"/g, 0);
  grab(/"image":\{"uri":"([^"]+)"/g, 0);
  grab(/"(?:uri|src|playable_url|image_src)":"(https:[^"]+?\.(?:jpg|jpeg|png|webp)[^"]*)"/g, 1);
  grab(/<img[^>]+src="([^"]+)"/g, 1);
  grab(/(https:\/\/[^"'\\\s)]+fbcdn\.net\/[^"'\\\s)]+\.(?:jpg|jpeg|png|webp)[^"'\\\s)]*)/g, 1);

  // Group by media id; per id keep the highest size hint, best priority.
  const byId = new Map<string, Cand>();
  for (const c of cands) {
    const id = imageId(c.url);
    const cur = byId.get(id);
    if (!cur || c.size > cur.size || (c.size === cur.size && c.priority < cur.priority)) {
      byId.set(id, c);
    }
  }
  // Distinct urls, ordered by resolution hint desc (largest / headline first).
  return [...byId.values()]
    .sort((a, b) => b.size - a.size || a.priority - b.priority)
    .map((c) => c.url);
}

export interface IframeMediaParse {
  /** Best video url (hd → sd → generic fbcdn .mp4), or null. */
  video: string | null;
  videoCandidates: string[];
  /** Distinct image urls, highest-res first, one per media id (carousel = many). */
  images: string[];
  /** Iframe surfaced a login/checkpoint wall and no media (never seen in batch runs). */
  loginWall: boolean;
}

/** Parse a Tier-B iframe response body for video + image media. */
export function parseIframeMedia(html: string): IframeMediaParse {
  const videoCandidates = rankVideoCandidates(html);
  const images = rankImageCandidates(html);
  const loginWall =
    images.length === 0 &&
    videoCandidates.length === 0 &&
    /log in|\/checkpoint\/\?|complete a security check/i.test(html);
  return { video: videoCandidates[0] ?? null, videoCandidates, images, loginWall };
}

// =============================================================================
// 4. Meta-quota circuit breaker (capture is FREE — no budget ledger)
// =============================================================================

// Pause Tier B at >75%, stop at >90% (yield-run thresholds). Applied to the MAX of
// every usage dimension parsed from x-app-usage and x-business-use-case-usage.
export const QUOTA_PAUSE_PCT = 75;
export const QUOTA_STOP_PCT = 90;

export type QuotaAction = "ok" | "pause" | "stop";

/**
 * Walk a Graph usage header JSON (x-app-usage is an object; x-business-use-case-usage
 * is { account: [ {…} ] }) and return the MAX percentage-ish value across the usage
 * dimensions (call_count / total_cputime / total_time / *usage* / *pct*). Returns 0
 * for a missing/unparseable header (fail-open: no data → not over budget).
 */
export function parseUsageHeader(raw: string | null | undefined): number {
  if (!raw) return 0;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return 0;
  }
  let max = 0;
  const walk = (o: unknown): void => {
    if (o && typeof o === "object") {
      if (Array.isArray(o)) {
        for (const x of o) walk(x);
        return;
      }
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (
          typeof v === "number" &&
          (/usage/i.test(k) || /pct/i.test(k) ||
            k === "call_count" || k === "total_cputime" || k === "total_time")
        ) {
          if (v > max) max = v;
        } else {
          walk(v);
        }
      }
    }
  };
  walk(j);
  return max;
}

/** Peak usage across the two Graph usage headers on a single response. */
export function parseGraphUsage(headers: {
  appUsage?: string | null;
  businessUseCase?: string | null;
}): number {
  return Math.max(
    parseUsageHeader(headers.appUsage),
    parseUsageHeader(headers.businessUseCase),
  );
}

/**
 * Whether the metered Tier B (Graph /previews → iframe) should run for this ad.
 * Tier B is needed when a video still needs fetching OR statics are uncovered — BUT
 * when the drain is in `tierAOnly` mode (a prior ad this run tripped the Meta-quota
 * breaker), Tier B is skipped so the run spends ZERO further shared Meta quota. The
 * FREE Tier A (public video plugin, zero quota) always runs regardless — a quota
 * pause degrades to "Tier A only", never to "capture nothing".
 */
export function shouldAttemptTierB(input: {
  needVideoB: boolean;
  needStaticsB: boolean;
  tierAOnly: boolean;
}): boolean {
  if (input.tierAOnly) return false;
  return input.needVideoB || input.needStaticsB;
}

/** Circuit-breaker decision from a peak usage percentage. >90 → stop; >75 → pause. */
export function quotaDecision(
  peakUsagePct: number,
  pausePct = QUOTA_PAUSE_PCT,
  stopPct = QUOTA_STOP_PCT,
): QuotaAction {
  if (peakUsagePct > stopPct) return "stop";
  if (peakUsagePct > pausePct) return "pause";
  return "ok";
}

// =============================================================================
// 5. Retry / backoff (bounded, exponential)
// =============================================================================

export const CAPTURE_BACKOFF_BASE_MS = 30 * 60 * 1000; // 30 min

/** Minimum wait (ms) before the next attempt, given attempts already made.
 *  attempts<=0 → 0 (never tried → run now); else base * 2^(n-1). */
export function captureBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return CAPTURE_BACKOFF_BASE_MS * 2 ** (attempts - 1);
}

export type RetryAction = "run" | "backoff" | "terminal";
export interface RetryDecisionInput {
  attempts: number;
  lastAttemptAt: string | number | Date | null | undefined;
  now: number;
  maxAttempts?: number;
  force?: boolean;
}
export interface RetryDecision {
  action: RetryAction;
  /** Epoch ms the row becomes eligible again (only for action === 'backoff'). */
  nextEligibleAt?: number;
}

/**
 * Decide whether to run capture for a creative given its attempt bookkeeping:
 *   attempts >= max      → 'terminal' (caller marks capture_status='failed')
 *   within backoff window → 'backoff'  (skip this drain tick, no attempt burned)
 *   otherwise             → 'run'
 * force bypasses BOTH the cap and the window (operator recapture).
 */
export function retryDecision(input: RetryDecisionInput): RetryDecision {
  const { attempts, lastAttemptAt, now, force } = input;
  const max = input.maxAttempts ?? CAPTURE_MAX_ATTEMPTS;
  if (force) return { action: "run" };
  if (attempts >= max) return { action: "terminal" };
  if (attempts > 0 && lastAttemptAt != null) {
    const last = new Date(lastAttemptAt).getTime();
    if (!Number.isNaN(last)) {
      const eligibleAt = last + captureBackoffMs(attempts);
      if (now < eligibleAt) return { action: "backoff", nextEligibleAt: eligibleAt };
    }
  }
  return { action: "run" };
}

// =============================================================================
// 6. Creative media-update planner (sentinel-safe)
// =============================================================================

export interface CapturedAsset {
  publicUrl: string; // always a storage-owned url produced by our download+store
  assetId?: string | null;
}
export interface CapturedMedia {
  video?: CapturedAsset | null;
  image?: CapturedAsset | null;
}

/**
 * Compute the creatives media update:
 *   * NEVER overwrite a column that already holds a storage-owned url (the API tier
 *     or an earlier capture already landed real media there).
 *   * The only values written are real storage urls we just produced, so a sentinel
 *     is never written over a real url (sentinel-safe by construction).
 * Returns only the columns to change (empty object → nothing to write).
 */
export function planCreativeMediaUpdate(
  current: CreativeMediaCurrent,
  captured: CapturedMedia,
): Record<string, string | null> {
  const updates: Record<string, string | null> = {};

  if (captured.video?.publicUrl && !isStorageOwnedUrl(current.video_url)) {
    updates.video_url = captured.video.publicUrl;
    if (captured.video.assetId) updates.video_asset_id = captured.video.assetId;
  }

  if (captured.image?.publicUrl && !isStorageOwnedUrl(current.full_res_url)) {
    updates.thumbnail_url = captured.image.publicUrl;
    updates.full_res_url = captured.image.publicUrl;
    updates.image_quality = "full_res";
    if (captured.image.assetId) updates.thumb_asset_id = captured.image.assetId;
  }

  return updates;
}

// =============================================================================
// 7. Final capture status
// =============================================================================

export type CaptureStatus = "captured" | "failed" | "pending";
export interface FinalStatusInput {
  /** Any real media landed to owned storage this run. */
  landedAny: boolean;
  /** Attempt count AFTER incrementing for this run. */
  attempts: number;
  maxAttempts?: number;
}
export interface FinalStatus {
  status: CaptureStatus;
  terminal: boolean;
}

/**
 * Map a run outcome to the lifecycle status written to creatives.capture_status:
 *   landed media          → 'captured' (terminal success)
 *   no media, attempts<max → 'pending'  (eligible for a bounded retry)
 *   no media, attempts>=max → 'failed'   (terminal)
 */
export function finalCaptureStatus(input: FinalStatusInput): FinalStatus {
  const max = input.maxAttempts ?? CAPTURE_MAX_ATTEMPTS;
  if (input.landedAny) return { status: "captured", terminal: true };
  if (input.attempts >= max) return { status: "failed", terminal: true };
  return { status: "pending", terminal: false };
}
