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
