// vault-save-creative — pure, testable save logic.
//
// save-ad-to-vault US-005. The vault-save-creative edge function (US-002) inlines
// several pure decisions: sentinel filtering of media URLs, shaping a frozen
// performance snapshot from a `creatives` row, and the dedupe-by-ad_id decision
// against the global library. Those are extracted here so they can be unit-tested
// under Vitest without Deno globals or any live network/DB. The edge function
// imports these helpers — behavior is identical, just relocated.
//
// This module is intentionally dependency-free (no Deno, no esm.sh, no Supabase
// client) so it imports cleanly into both `deno` and a Vitest/Node runtime.

// Sentinel placeholders the analytics side stores when a media URL is absent.
export const SENTINELS = new Set(["no-thumbnail", "no-video"]);

/** Returns the URL if it is a real, usable media URL — else null. */
export function cleanUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const v = u.trim();
  if (!v || SENTINELS.has(v)) return null;
  return v;
}

// Platform keys the vault UI knows how to label/color (see src/features/vault/
// types/vault.ts PLATFORM_LABELS). Anything outside this set renders as
// "Unknown", so a saved analytics creative must be normalized into one of these.
const VAULT_PLATFORM_KEYS = new Set([
  "tiktok",
  "instagram",
  "youtube",
  "twitter",
  "facebook_ad",
  "upload",
]);

/**
 * Normalize an analytics creative's platform into a vault platform key the UI can
 * label. Verdanote analytics creatives come from Meta ad accounts, so unknown or
 * missing values default to "facebook_ad" ("Meta Ad") rather than an unlabeled
 * "analytics_creative" that the card would render as "Unknown". Pure.
 */
export function normalizeVaultPlatform(platform: unknown): string {
  if (typeof platform === "string") {
    const p = platform.trim().toLowerCase();
    if (VAULT_PLATFORM_KEYS.has(p)) return p;
    if (p === "facebook" || p === "meta" || p === "fb" || p === "meta_ad") {
      return "facebook_ad";
    }
  }
  return "facebook_ad";
}

/**
 * Whether a fetched content-type is acceptable to store as the given media kind.
 * A page URL (e.g. a facebook.com ad page passed in place of a media URL) returns
 * `text/html`; storing that as `media.mp4` yields an unplayable vault item, so any
 * content that isn't the expected media type is rejected. `application/octet-stream`
 * is allowed because CDNs frequently serve media with that generic type. Pure.
 */
export function isMediaContentType(
  contentType: unknown,
  kind: "image" | "video",
): boolean {
  if (typeof contentType !== "string") return false;
  const ct = contentType.trim().toLowerCase();
  if (!ct) return false;
  if (ct.includes("application/octet-stream")) return true;
  return ct.startsWith(kind === "video" ? "video/" : "image/");
}

/** A media URL is "durable" when it points at our own public Supabase Storage —
 * those are always downloadable by copyMedia. Raw Meta CDN links, ad-page URLs,
 * nulls and blanks are NOT durable. Pure. */
export function isDurableStorageUrl(u: unknown): boolean {
  return typeof u === "string" && u.includes("/storage/v1/object/public/");
}

/**
 * Decide whether a save must first recover durable media URLs (via the
 * cache-creative-image edge function) before copying into the vault.
 *
 * Regression (US-004 bulk save → "Saved 0, 1 failed"): the analytics grid's bulk
 * save passes RAW `creatives` rows whose `video_url`/`thumbnail_url` are commonly
 * expired Meta CDN links, ad-page URLs, or never-fetched nulls — none of which
 * copyMedia can download, so every grid save failed. The single CreativeDetailModal
 * save dodged this only because the modal recovers media via cache-creative-image
 * before saving. The edge function now performs that recovery server-side so BOTH
 * paths work; this predicate gates it.
 *
 * Mirrors the modal's settle logic: recovery is needed unless BOTH the video and
 * the thumbnail are already settled — a durable storage URL or a confirmed-absent
 * sentinel. A null/blank/CDN URL is unsettled and triggers recovery. Pure.
 */
export function needsMediaRecovery(input: {
  video_url?: unknown;
  thumbnail_url?: unknown;
}): boolean {
  const settled = (u: unknown) =>
    isDurableStorageUrl(u) ||
    (typeof u === "string" && SENTINELS.has(u.trim()));
  return !(settled(input.video_url) && settled(input.thumbnail_url));
}

export interface MediaSources {
  /** The playable video URL to copy, or null. */
  videoSrc: string | null;
  /** The still-image URL to copy (full-res image preferred, else thumbnail), or null. */
  imageSrc: string | null;
}

/**
 * Select which source URLs a save should copy. `video_url` is the ONLY video
 * source — `full_res_url` is a full-resolution IMAGE (the analytics UI renders it
 * with an <img>, never a <video>), so it must never be copied as a video. The
 * still image prefers `full_res_url`, falling back to `thumbnail_url`. Sentinels
 * and blanks are filtered via cleanUrl. Pure + deterministic.
 *
 * Regression: a save previously copied `full_res_url ?? video_url` as the video.
 * When `full_res_url` was a facebook.com page URL, copyMedia stored ~151KB of HTML
 * as media.mp4 → an unplayable item that downstream transcription also rejected.
 */
export function selectMediaSources(input: {
  full_res_url?: unknown;
  video_url?: unknown;
  thumbnail_url?: unknown;
}): MediaSources {
  const video = cleanUrl(input.video_url);
  const fullRes = cleanUrl(input.full_res_url);
  const thumb = cleanUrl(input.thumbnail_url);
  // Prefer durable storage URLs regardless of which field they come from.
  // refresh-thumbnails can overwrite full_res_url with a fresh CDN URL even
  // when thumbnail_url is already a storage URL, making imageSrc = expiredCDN
  // → copyMedia 403 → 500. Pick: storage full_res > storage thumb > CDN full_res > CDN thumb.
  const storageFull = isDurableStorageUrl(fullRes) ? fullRes : null;
  const storageThumb = isDurableStorageUrl(thumb) ? thumb : null;
  return { videoSrc: video, imageSrc: storageFull ?? storageThumb ?? fullRes ?? thumb };
}

/** Pick a storage extension from a content-type, defaulting per media kind. */
export function extFor(contentType: string, kind: "image" | "video"): string {
  const ct = contentType.toLowerCase();
  if (kind === "video") {
    if (ct.includes("webm")) return "webm";
    if (ct.includes("quicktime") || ct.includes("mov")) return "mov";
    return "mp4";
  }
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

// Numeric performance metrics captured into the frozen snapshot from a creatives
// row. These mirror the US-001 perf-snapshot column intent (spend, roas, cpa,
// thumb_stop_rate, hold_rate, retention_pNN + a few other captured metrics).
const SNAPSHOT_NUMERIC_FIELDS = [
  "spend",
  "roas",
  "cpa",
  "cpc",
  "cpm",
  "ctr",
  "thumb_stop_rate",
  "hold_rate",
  "frequency",
  "impressions",
  "clicks",
  "purchases",
  "purchase_value",
  "video_avg_play_time",
  "video_views",
  "retention_p25",
  "retention_p50",
  "retention_p75",
  "retention_p100",
] as const;

/** A minimal view of a `creatives` row — only the fields the snapshot reads. */
export type CreativeSnapshotSource = Record<string, unknown> & {
  play_curve?: unknown;
};

/**
 * Shape a frozen performance snapshot from a `creatives` row. Only finite numeric
 * metrics are copied (null/undefined/NaN/non-number values are dropped, never
 * coerced to 0), plus the play_curve when present. Pure + deterministic.
 */
export function buildPerformanceSnapshot(
  row: CreativeSnapshotSource | null | undefined,
): Record<string, number | unknown> {
  const snapshot: Record<string, number | unknown> = {};
  if (!row) return snapshot;

  for (const field of SNAPSHOT_NUMERIC_FIELDS) {
    const value = row[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      snapshot[field] = value;
    }
  }

  // Retention play curve is captured verbatim when present (JSON value).
  if (row.play_curve != null) {
    snapshot.play_curve = row.play_curve;
  }

  return snapshot;
}

export interface RecoveryRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Build the function-to-function request that recovers durable media URLs via the
 * cache-creative-image edge function. The Authorization header MUST be the caller's
 * own bearer (a real user JWT forwarded from the incoming request) — NEVER the
 * SUPABASE_SERVICE_ROLE_KEY.
 *
 * Regression ("Saved 0, 1 failed" — vault save from analytics not working): after
 * Supabase's API-key migration, SUPABASE_SERVICE_ROLE_KEY is the opaque `sb_secret_`
 * format. supabase-js / PostgREST accept it (so the in-function `db` client works),
 * but cache-creative-image runs with verify_jwt=true and the Edge Function gateway
 * validates only real JWTs — it rejects the `sb_secret_` form with 401. So the
 * recovery call silently failed, no durable URL was ever applied, and every save
 * whose media URLs were unsettled (the bulk-save path always passes raw nulls/CDN
 * links) fell through to 422 "No usable creative media to copy". Forwarding the
 * caller's JWT clears the gateway (the same path the CreativeDetailModal already
 * uses successfully) and is immune to future service-key rotations. Pure.
 */
export function buildRecoveryRequest(input: {
  supabaseUrl: string;
  callerAuthHeader: string;
  ad_id: string;
  account_id: string;
}): RecoveryRequest {
  return {
    url: `${input.supabaseUrl}/functions/v1/cache-creative-image`,
    headers: {
      Authorization: input.callerAuthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ad_id: input.ad_id, account_id: input.account_id }),
  };
}

/** The result of looking up an existing global-library item by source_ad_id. */
export interface ExistingItem {
  id: string;
}

export interface DedupeDecision {
  /** When true, the ad is already saved — return existing item, do NOT insert. */
  alreadySaved: boolean;
  /** The existing item id when alreadySaved, else null. */
  itemId: string | null;
}

/**
 * Dedupe-by-ad_id decision against the GLOBAL library. Given the existing-item
 * lookup result, decide whether to short-circuit (already saved) or proceed with
 * an insert. Pure — the caller does the DB lookup and passes the row in.
 */
export function dedupeDecision(
  existing: ExistingItem | null | undefined,
): DedupeDecision {
  if (existing && existing.id) {
    return { alreadySaved: true, itemId: existing.id };
  }
  return { alreadySaved: false, itemId: null };
}
