// US-009: Deterministic AI → app-vocab tag derivation (the 'ai' auto-tag layer).
//
// The analyze-creative pipeline now fills structured framework/analysis fields on
// public.creatives (hook_type, value_structure, framework_json.brand_name, media
// kind, …). This module TRANSLATES those already-extracted fields into the app's
// SIX real tag columns using a static, deterministic mapping — NO new LLM call.
//
// It is the missing "'ai' sits below parsed (US-009)" layer the resolve-tags
// header always referenced but never implemented. Precedence is enforced by
// resolve-tags.ts (manual > csv_match > parsed > ai > untagged), so anything a
// human, Coda mapping, or the ad-name parser already supplied always wins — the
// 'ai' layer only FILLS dimensions no higher source resolved.
//
// WHY A TRANSLATION LAYER (not a passthrough of creatives.tag_suggestions):
// analyze-creative's tag_suggestions emits RAW framework/vision values whose value
// space does NOT match the app tag vocab (lowercase enums like "bold_claim";
// ad_format stuffed into style; industry into theme). A naive copy would corrupt
// tags. This module maps ONLY the dimensions with a clean deterministic mapping,
// and leaves the rest null (never guesses).
//
// PER-COLUMN SOURCING (owner decision):
//   hook     ← hook_type enum, translated to HOOK_OPTIONS (exact table). High conf.
//   ad_type  ← media kind (isVideo → "Video" | "Static"). Deterministic. High conf.
//   product  ← framework_json.brand_name (free text). High conf; junk values dropped.
//   theme    ← value_structure (== "angle"), keyword-normalized to a clean token.
//              Semantic leap (structure → theme) → FLAGGED fuzzy for review.
//   style    ← NOT derivable from AI today (the style prompt extension is a later,
//              separate step). Comes from the AD NAME via parse-ad-name ('parsed').
//   person   ← NOT derivable from AI today. Comes from the AD NAME ('parsed').
//
// FUZZY FLAG: each derived field carries `fuzzy`. High-confidence maps
// (hook/ad_type/product) are fuzzy:false → auto-applied silently. The theme map is
// fuzzy:true → still auto-applied, but resolve-tags raises needs_review so the
// owner can filter to it later (review never blocks). See the migration that adds
// creatives.needs_tag_review.
//
// PURE + deterministic — no Deno / esm.sh / Supabase client — unit-tested under
// `deno test` exactly like analyze-creative-logic.ts and resolve-tags.ts.

import type { AdNameTags } from "./parse-ad-name.ts";
import {
  resolveTags,
  type PartialTags,
  type ResolvedTags,
} from "./resolve-tags.ts";

/** The six tag dimensions, stable order (mirrors resolve-tags / parse-ad-name). */
const DIMS: ReadonlyArray<keyof AdNameTags> = [
  "ad_type",
  "person",
  "style",
  "product",
  "hook",
  "theme",
];

/**
 * AI hook_type enum → app HOOK_OPTIONS. The analyze-creative prompts constrain
 * hook_type to exactly {bold_claim, pattern_interrupt, honest_admission, question,
 * other} (creative-analysis-prompts.ts). Only the four that have a clean app-vocab
 * counterpart are mapped; "other"/unknown → null (leave untagged, never guess).
 *
 * App HOOK_OPTIONS = Problem Callout | Confession | Question | Statement Bold |
 * Authority Intro | Before & After | Pattern Interrupt (src/lib/tagOptions.ts).
 */
export const HOOK_TYPE_TO_APP: Readonly<Record<string, string>> = {
  bold_claim: "Statement Bold",
  pattern_interrupt: "Pattern Interrupt",
  honest_admission: "Confession",
  question: "Question",
};

/**
 * value_structure (a one-sentence description of how the body is organized) →
 * a clean canonical THEME/angle token. Ordered: the FIRST rule whose trigger
 * appears (case-insensitive substring) wins. If nothing matches, theme is left
 * null rather than dumping a raw sentence into the free-text theme column (which
 * would pollute the distinct-value theme filter). Deterministic.
 */
const THEME_ANGLE_RULES: ReadonlyArray<{ canonical: string; triggers: string[] }> = [
  { canonical: "Before-After", triggers: ["before-after", "before/after", "before and after", "before after"] },
  { canonical: "Problem-Solution", triggers: ["problem-solution", "problem/solution", "problem then solution", "problem and solution"] },
  { canonical: "Testimonial", triggers: ["testimonial", "testimony"] },
  { canonical: "Demonstration", triggers: ["demonstration", "product demo", "demo", "how-to", "how to", "tutorial", "walkthrough"] },
  { canonical: "Comparison", triggers: ["comparison", "contrast", " versus ", " vs ", " vs.", "compare"] },
  { canonical: "Listicle", triggers: ["listicle", "list of", " list ", "a list", "numbered", "tips"] },
  { canonical: "Story", triggers: ["story", "narrative", "storytelling", "anecdote"] },
  { canonical: "Single Insight", triggers: ["single insight", "one insight", "single idea", "one idea", "single claim", "one claim"] },
];

/** Free-text values the model emits for "unknown" that must NOT become a tag. */
const JUNK_TEXT = new Set([
  "null",
  "n/a",
  "na",
  "none",
  "unknown",
  "unclear",
  "undefined",
  "",
]);

/** One derived tag dimension: its value plus whether it needs human review. */
export interface DerivedField {
  /** The app-vocab value, or null when this dimension is not AI-derivable. */
  value: string | null;
  /**
   * true = low-confidence / judgment-call mapping. The value is still applied
   * (auto-apply, not suggest-only) but resolve-tags raises needs_review so the
   * owner can filter to it. false = high-confidence, applied silently.
   */
  fuzzy: boolean;
}

/** The six dimensions as derived from the AI fields (person/style always null here). */
export interface DerivedAiTags {
  ad_type: DerivedField;
  person: DerivedField;
  style: DerivedField;
  product: DerivedField;
  hook: DerivedField;
  theme: DerivedField;
}

/** The AI/media inputs this module reads. All optional; missing → that dim null. */
export interface DeriveTagsInput {
  /** creatives.hook_type (raw AI enum). */
  hook_type?: string | null;
  /** creatives.value_structure (the "angle" sentence). */
  value_structure?: string | null;
  /** creatives.framework_json (jsonb) — brand_name is read for product. */
  framework_json?: Record<string, unknown> | null;
  /**
   * Media kind. true → "Video", false → "Static". undefined → ad_type left null.
   * Callers derive this from the media sentinels (see NO_VIDEO_SENTINEL), matching
   * the modal's isVideoAd logic and analyze-creative's hasVideo branch.
   */
  isVideo?: boolean;
}

const NONE: DerivedField = { value: null, fuzzy: false };

/** Trim a loose value to a non-junk string, or null. */
function cleanText(v: unknown): string | null {
  if (typeof v !== "string") {
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  }
  const t = v.trim();
  if (!t) return null;
  if (JUNK_TEXT.has(t.toLowerCase())) return null;
  return t;
}

/** hook_type enum → app hook. Present-but-unmapped (e.g. "other") → null. */
function deriveHook(hookType: string | null | undefined): DerivedField {
  const key = typeof hookType === "string" ? hookType.trim().toLowerCase() : "";
  const mapped = HOOK_TYPE_TO_APP[key];
  return mapped ? { value: mapped, fuzzy: false } : NONE;
}

/** media kind → ad_type. undefined isVideo leaves it null (not derivable). */
function deriveAdType(isVideo: boolean | undefined): DerivedField {
  if (isVideo === true) return { value: "Video", fuzzy: false };
  if (isVideo === false) return { value: "Static", fuzzy: false };
  return NONE;
}

/** framework_json.brand_name → product (free text). Junk values dropped. */
function deriveProduct(fj: Record<string, unknown> | null | undefined): DerivedField {
  const brand = cleanText(fj?.brand_name);
  return brand ? { value: brand, fuzzy: false } : NONE;
}

/**
 * value_structure → a clean canonical THEME token. Keyword-normalized; unmatched
 * structures leave theme null. Always fuzzy:true when it DOES resolve, because the
 * value_structure → theme/angle mapping is a semantic judgment worth reviewing.
 */
function deriveTheme(valueStructure: string | null | undefined): DerivedField {
  const s = cleanText(valueStructure);
  if (!s) return NONE;
  const hay = s.toLowerCase();
  for (const rule of THEME_ANGLE_RULES) {
    if (rule.triggers.some((t) => hay.includes(t))) {
      return { value: rule.canonical, fuzzy: true };
    }
  }
  return NONE;
}

/**
 * Derive the AI-layer tags from a creative's AI/media fields. Pure + deterministic.
 *
 * person and style are intentionally always null here — neither is deterministically
 * derivable from the current AI fields (the style/person prompt extension is a later,
 * separate step). They are supplied by the ad-name parser ('parsed' layer) instead.
 */
export function deriveAiTags(input: DeriveTagsInput): DerivedAiTags {
  return {
    ad_type: deriveAdType(input.isVideo),
    person: NONE,
    style: NONE,
    product: deriveProduct(input.framework_json),
    hook: deriveHook(input.hook_type),
    theme: deriveTheme(input.value_structure),
  };
}

/** DerivedAiTags → the PartialTags shape resolve-tags consumes for its ai layer. */
export function aiTagsToPartial(derived: DerivedAiTags): PartialTags {
  const out: PartialTags = {};
  for (const dim of DIMS) out[dim] = derived[dim].value;
  return out;
}

/** The dimensions whose derived AI value is fuzzy AND non-null (drive needs_review). */
export function fuzzyDimsOf(derived: DerivedAiTags): Array<keyof AdNameTags> {
  return DIMS.filter((d) => derived[d].value !== null && derived[d].fuzzy);
}

/**
 * End-to-end auto-tag resolution for ONE creative, combining the ad-name parser
 * output (the 'parsed' layer — the primary source for style/person) with the
 * deterministic AI layer, under the locked precedence (manual > csv_match > parsed
 * > ai > untagged). Returns the six resolved tags, the single tag_source, the
 * per-dimension provenance, and needs_review.
 *
 * Pure — the caller does the IO (parseAdName with a resolved convention, the
 * name_mappings lookup, the AI-field read) and passes the results in.
 */
export function computeAutoTags(params: {
  /** parseAdName(...).tags mapped to DISPLAY names (the 'parsed' layer), or null. */
  parsed: AdNameTags | null;
  /** The creative's AI/media fields (the 'ai' layer). */
  ai: DeriveTagsInput;
  /** name_mappings row for this ad (the 'csv_match' layer), or null. */
  nameMapping?: PartialTags | null;
  /** manual overrides (the 'manual' layer), or null. */
  manual?: PartialTags | null;
}): ResolvedTags {
  const derived = deriveAiTags(params.ai);
  return resolveTags(
    params.parsed ?? null,
    params.nameMapping ?? null,
    params.manual ?? null,
    aiTagsToPartial(derived),
    fuzzyDimsOf(derived),
  );
}
