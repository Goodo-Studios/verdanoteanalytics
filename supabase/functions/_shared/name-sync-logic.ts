// Pure decision logic for keeping creatives' tags in step with their ad names.
//
//   1. Automatic re-parse on sync (needsAutoParse): an ad whose tag_source is
//      'parsed' or 'untagged' is (re-)parsed when its current ad_name differs from
//      the name it was last parsed from (creatives.parsed_ad_name). NULL
//      parsed_ad_name means "never run through the parser" (a new ad), so it is
//      parsed too. 'manual' is NEVER touched automatically; 'csv_match', 'ai' and
//      legacy values are left alone as well.
//   2. Explicit "Sync from name" (buildNameSyncChange / validateSyncFromNameBody):
//      the user asks for the name to win. All six tag columns are replaced with
//      what the name says (null where the name has no value), regardless of
//      tag_source — including 'manual'.
//
// PURE: no IO. The edge functions fetch rows + the convention and pass them in.

import type { NamingConvention } from "./naming-convention.ts";
import { parseAdName, type AdNameTags } from "./parse-ad-name.ts";
import { parsedDisplayTags } from "./ad-name-display.ts";

export const TAG_KEYS: ReadonlyArray<keyof AdNameTags> = [
  "ad_type",
  "person",
  "style",
  "product",
  "hook",
  "theme",
];

/** tag_source values the automatic sync is allowed to (re-)parse. */
const AUTO_PARSE_SOURCES = new Set(["parsed", "untagged"]);

export interface AutoParseRow {
  tag_source: string | null;
  ad_name: string | null;
  parsed_ad_name: string | null;
}

/**
 * Should the sync run this creative through the parser now?
 *   - only tag_source 'parsed' | 'untagged'
 *   - only when the name changed since the last parse (or it was never parsed)
 *   - exception: an 'untagged' row whose unique_code has a Coda name_mappings
 *     row is always retried (hasNameMapping), so a mapping that arrives after
 *     the ad was first seen still applies on the next sync, as it did before
 *     rename tracking existed.
 */
export function needsAutoParse(row: AutoParseRow, hasNameMapping = false): boolean {
  if (!row.tag_source || !AUTO_PARSE_SOURCES.has(row.tag_source)) return false;
  if (typeof row.ad_name !== "string" || row.ad_name === "") return false;
  if (row.tag_source === "untagged" && hasNameMapping) return true;
  return row.parsed_ad_name !== row.ad_name;
}

export function emptyTags(): AdNameTags {
  return { ad_type: null, person: null, style: null, product: null, hook: null, theme: null };
}

/** Pick the six tag columns off a creatives row, normalising undefined/"" to null. */
export function pickTags(row: Partial<Record<keyof AdNameTags, string | null>>): AdNameTags {
  const out = emptyTags();
  for (const k of TAG_KEYS) {
    const v = row[k];
    out[k] = typeof v === "string" && v.trim() !== "" ? v : null;
  }
  return out;
}

export function tagsEqual(a: AdNameTags, b: AdNameTags): boolean {
  return TAG_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

export interface NameSyncRow extends Partial<Record<keyof AdNameTags, string | null>> {
  ad_id: string;
  ad_name: string;
}

export interface NameSyncChange {
  id: string;
  ad_name: string;
  before: AdNameTags;
  after: AdNameTags;
  /** true iff any of the six tag values differs between before and after. */
  changed: boolean;
  /** unique_code from the name (first separator token) — written alongside the tags. */
  unique_code: string;
}

/**
 * What "Sync from name" would do to one creative. The name wins outright: no
 * name_mappings / manual / AI layer is consulted, and dimensions the name lacks
 * become null.
 */
export function buildNameSyncChange(
  row: NameSyncRow,
  convention: NamingConvention,
): NameSyncChange {
  const adName = row.ad_name ?? "";
  const parsed = parseAdName(adName, convention);
  const after = parsedDisplayTags(parsed) ?? emptyTags();
  const before = pickTags(row);
  return {
    id: row.ad_id,
    ad_name: adName,
    before,
    after,
    changed: !tagsEqual(before, after),
    unique_code: parsed.unique_code || adName,
  };
}

/** The creatives update a real "Sync from name" writes for one change. */
export function nameSyncUpdate(change: NameSyncChange): Record<string, string | null> {
  return {
    ...change.after,
    tag_source: "parsed",
    unique_code: change.unique_code,
    parsed_ad_name: change.ad_name,
  };
}

export const SYNC_FROM_NAME_MAX_IDS = 500;

export type SyncFromNameBody =
  | { ok: true; ids: string[]; dry_run: boolean }
  | { ok: false; error: string };

/** Validate the POST /creatives/sync-from-name body. De-duplicates ids. */
export function validateSyncFromNameBody(body: unknown): SyncFromNameBody {
  if (!body || typeof body !== "object") return { ok: false, error: "JSON body required" };
  const { ids, dry_run } = body as { ids?: unknown; dry_run?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: "ids must be a non-empty array" };
  }
  if (!ids.every((id) => typeof id === "string" && id.trim() !== "")) {
    return { ok: false, error: "ids must be non-empty strings" };
  }
  if (ids.length > SYNC_FROM_NAME_MAX_IDS) {
    return { ok: false, error: `At most ${SYNC_FROM_NAME_MAX_IDS} ids per call` };
  }
  const unique = [...new Set(ids as string[])];
  if (dry_run !== undefined && typeof dry_run !== "boolean") {
    return { ok: false, error: "dry_run must be a boolean" };
  }
  return { ok: true, ids: unique, dry_run: dry_run === true };
}
