// Display forms for parsed ad-name tags.
//
// Stored tag columns (creatives.ad_type/person/style/product/hook/theme) hold
// DISPLAY forms ("UGC Native", "No Talent", "Tired By 3pm"), while ad-name
// tokens and vocab canonicals are CamelCase tokens ("UGCNative", "NoTalent",
// "TiredBy3pm"). This module is the single place that converts one to the other.
// It replaces the DISPLAY_NAMES maps that used to be copy-pasted into sync,
// creatives, backfill-retag and backfill-ai-tags.
//
// PURE: no IO, no Deno globals. Safe to import from Deno and Node.

import type { AdNameTags, ParsedAdName } from "./parse-ad-name.ts";

/**
 * Tokens whose display form is not what the CamelCase splitter produces.
 * Everything else ("UGCNative", "StudioClean", "NoTalent", "ProblemCallout", ...)
 * is handled by splitCamelCase.
 */
const DISPLAY_EXCEPTIONS: Record<string, string> = {
  BeforeAndAfter: "Before & After",
};

/**
 * ad_type canonical renames. "Static" is the canonical for still images; older
 * vocab (per-account overrides) still canonicalize to "Image"/"Photo". Mapping
 * here means every new write stores "Static" without editing those overrides.
 */
const AD_TYPE_DISPLAY: Record<string, string> = {
  image: "Static",
  photo: "Static",
  static: "Static",
  gif: "GIF",
};

/**
 * Split a CamelCase token into words, keeping acronym runs together.
 *
 *   "TiredBy3pm"      -> "Tired By 3pm"
 *   "WeightedBlanket" -> "Weighted Blanket"
 *   "UGCNative"       -> "UGC Native"
 *   "NoTalent"        -> "No Talent"
 *   "Top10Tips"       -> "Top 10 Tips"
 *   "Crème-safe"      -> "Crème-safe"   (non-ASCII letters are letters, not breaks)
 *
 * Idempotent: an already-spaced display form comes back unchanged.
 */
export function splitCamelCase(token: string): string {
  return token
    // lower -> Upper:  "ByTired" -> "By Tired"
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    // end of an acronym run before a capitalised word: "UGCNative" -> "UGC Native"
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    // lower -> digit: "By3pm" -> "By 3pm"  (Upper -> digit stays: "MP4", "V2")
    .replace(/(\p{Ll})(\p{Nd})/gu, "$1 $2")
    // digit -> capitalised word: "10Tips" -> "10 Tips"  ("3PM" stays)
    .replace(/(\p{Nd})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Display form of a single tag value (vocab canonical or free-text token). */
export function toDisplayName(val: string): string {
  return DISPLAY_EXCEPTIONS[val] ?? splitCamelCase(val);
}

/** Display form of a value for a specific dimension (ad_type has renames). */
export function toDimensionDisplay(dimension: keyof AdNameTags, val: string): string {
  if (dimension === "ad_type") {
    const renamed = AD_TYPE_DISPLAY[val.trim().toLowerCase()];
    if (renamed) return renamed;
  }
  return toDisplayName(val);
}

/**
 * Parser output (canonical vocab / raw free-text tokens) -> display-form tags,
 * ready for the resolver's parser layer or a direct write. null when there was
 * no parse (no convention configured).
 */
export function parsedDisplayTags(parsed: ParsedAdName | null): AdNameTags | null {
  if (!parsed) return null;
  const t = parsed.tags;
  const d = (dim: keyof AdNameTags): string | null => {
    const v = t[dim];
    return v ? toDimensionDisplay(dim, v) : null;
  };
  return {
    ad_type: d("ad_type"),
    person: d("person"),
    style: d("style"),
    product: d("product"),
    hook: d("hook"),
    theme: d("theme"),
  };
}
