/**
 * Auto-tagger: infers tags from ad_name using pattern matching.
 * Returns only fields that were detected (partial object).
 */

export interface InferredTags {
  ad_type?: string;
  hook?: string;
  theme?: string; // "angle" stored in theme field
}

const FORMAT_PATTERNS: [RegExp, string][] = [
  [/\bugc\b/i, "UGC"],
  [/\bgfx\b|graphic/i, "Graphic"],
  [/\bstatic\b|\bimg\b|\bimage\b/i, "Static Image"],
  [/\bvid\b|\bvideo\b/i, "Video"],
  [/carousel/i, "Carousel"],
  [/\bdpa\b/i, "DPA"],
];

const HOOK_PATTERNS: [RegExp, string][] = [
  [/testimonial|review/i, "Testimonial"],
  [/unboxing/i, "Unboxing"],
  [/comparison|\bvs\b|competitor/i, "Competitor Comparison"],
  [/problem|pain/i, "Problem/Solution"],
  [/educational|\bedu\b|how\s*to/i, "Educational"],
  [/founder|behind/i, "Founder Story"],
];

const ANGLE_PATTERNS: [RegExp, string][] = [
  [/sale|discount|%|\boff\b/i, "Offer/Discount"],
  [/\bfree\b/i, "Free Gift/Trial"],
  [/too expensive|objection/i, "Objection Handling"],
  [/social proof|reviews/i, "Social Proof"],
  [/benefit|results/i, "Benefits"],
];

export function inferTags(adName: string): InferredTags {
  if (!adName) return {};
  const tags: InferredTags = {};

  // Format
  for (const [re, val] of FORMAT_PATTERNS) {
    if (re.test(adName)) { tags.ad_type = val; break; }
  }

  // Hook
  for (const [re, val] of HOOK_PATTERNS) {
    if (re.test(adName)) { tags.hook = val; break; }
  }
  // Fallback: if name contains "ugc" and no hook detected, set Social Proof
  if (!tags.hook && /\bugc\b/i.test(adName)) {
    tags.hook = "Social Proof";
  }

  // Angle → stored as theme
  for (const [re, val] of ANGLE_PATTERNS) {
    if (re.test(adName)) { tags.theme = val; break; }
  }

  return tags;
}

/** Returns true if at least one tag was inferred */
export function hasInferredTags(tags: InferredTags): boolean {
  return !!(tags.ad_type || tags.hook || tags.theme);
}
