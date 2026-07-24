// US-003: Single precedence resolver for creative tags.
//
// Collapses the tag-source precedence logic that was previously duplicated and
// divergent across four taggers (creatives PUT-reset, creatives auto-tag POST,
// sync Phase 5 regex, src/lib/autoTagger.ts) into ONE deterministic resolver.
//
// PRECEDENCE (LOCKED by Matthew):  manual > Coda(name_mappings) > parser > ai > untagged
//
//   - manual      : the human-curated override layer. In the current schema this
//                   is row-level — a creatives row whose tag_source = 'manual'
//                   holds the operator-set values directly in its six tag columns.
//                   `manual` is passed here as that {ad_type,...} shape (or null
//                   when the row is not manually tagged). The resolver also
//                   supports a per-dimension manual shape forward-compatibly: a
//                   dimension is "manual" iff manual[dim] is a non-null value.
//   - csv_match   : the Coda-curated name_mappings row for (account_id,
//                   unique_code) — the trusted override layer below manual.
//   - parsed      : the canonical parseAdName() output (ParsedAdName.tags).
//   - ai          : US-009. The deterministic AI-derived layer (see
//                   derive-creative-tags.ts) — hook/ad_type/product/theme mapped
//                   from the analyze-creative framework fields + media kind. It
//                   sits BELOW parsed (as the module header always intended), so
//                   AI only fills dimensions no manual/csv/parser value supplied.
//                   NEVER overwrites a human/Coda/ad-name tag.
//   - untagged    : nothing contributed any tag.
//
// Resolution is PER DIMENSION: each of the six dimensions independently takes the
// value from the highest-precedence source that supplies a non-null value for it.
//
// tag_source is a SINGLE column, so it is set to the HIGHEST-precedence source
// that contributed ANY tag to the final result:
//   manual  if any dimension's resolved value came from `manual`,
//   else csv_match  if any came from name_mappings,
//   else parsed     if any came from the parser,
//   else ai         if any came from the AI layer,
//   else untagged.
// (So a row where the ad-name parser filled style + AI filled hook is 'parsed' —
// the per-dimension provenance is exposed separately via `sources`.)
//
// Legacy values 'csv' and 'inferred' are NEVER emitted by this resolver — only
// 'manual' | 'csv_match' | 'parsed' | 'ai' | 'untagged'. Pre-existing legacy rows
// are untouched (this module only governs values written by new code paths).
//
// REVIEW FLAG: the caller may mark some AI-derived dimensions "fuzzy" (low
// confidence / judgment-call). `needs_review` is true iff the winning value for
// ANY dimension came from the AI layer AND that dimension was flagged fuzzy. Tags
// are still auto-applied; the flag only lets the owner filter to them later.
//
// PURE — no IO. Callers fetch the name_mappings row + the creative's manual
// values, the parsed tags, and the AI-derived tags, then pass them all in.

import type { AdNameTags } from "./parse-ad-name.ts";

/** The six tag dimensions, in stable order. */
const TAG_DIMENSIONS: ReadonlyArray<keyof AdNameTags> = [
  "ad_type",
  "person",
  "style",
  "product",
  "hook",
  "theme",
];

/** The five — and only five — tag_source values new code may write. */
export type TagSource = "manual" | "csv_match" | "parsed" | "ai" | "untagged";

/**
 * A partial set of tag dimensions. Used for the manual-override and
 * name_mappings inputs, where any subset of dimensions may be present. Missing
 * or null values mean "this source does not supply this dimension".
 */
export type PartialTags = Partial<Record<keyof AdNameTags, string | null>>;

export interface ResolvedTags {
  tags: AdNameTags;
  tag_source: TagSource;
  /**
   * Per-dimension provenance: which layer supplied each dimension's final value,
   * or null when nothing did. Lets callers see (e.g.) that style came from the
   * ad name ('parsed') while hook came from the AI layer ('ai'), even though the
   * single tag_source column can only report the highest contributor.
   */
  sources: Record<keyof AdNameTags, TagSource | null>;
  /**
   * true iff any dimension whose final value came from the AI layer was flagged
   * fuzzy by the caller. Drives creatives.needs_tag_review. Never blocks writes.
   */
  needs_review: boolean;
}

function emptyTags(): AdNameTags {
  return {
    ad_type: null,
    person: null,
    style: null,
    product: null,
    hook: null,
    theme: null,
  };
}

/** A non-empty string is a real contribution; null/undefined/"" is not. */
function value(source: PartialTags | null | undefined, dim: keyof AdNameTags): string | null {
  if (!source) return null;
  const v = source[dim];
  if (v === null || v === undefined) return null;
  // Treat empty / whitespace-only strings as "no value" so they never win a
  // dimension or flip tag_source to a higher precedence than actually applied.
  return v.trim() === "" ? null : v;
}

/**
 * Resolve the final tags + single tag_source for one creative.
 *
 * @param parsed          ParsedAdName.tags from the canonical parseAdName().
 *                        Pass an all-null AdNameTags when there was no convention
 *                        / nothing parsed.
 * @param nameMappingRow  The name_mappings row for this ad's (account_id,
 *                        unique_code), or null when none exists. Only its six tag
 *                        columns are read.
 * @param manual          The manual-override values (row-level when the creative's
 *                        tag_source is 'manual'; per-dimension otherwise), or null
 *                        when there is no manual override.
 * @param ai              US-009. The deterministic AI-derived tags (see
 *                        derive-creative-tags.ts), or null. Lowest real layer —
 *                        only fills dimensions manual/csv/parser left null.
 * @param aiFuzzyDims     The subset of AI dimensions the caller flagged as
 *                        fuzzy/low-confidence. If any of these ends up as the
 *                        winning (AI-sourced) value, needs_review is raised.
 */
export function resolveTags(
  parsed: AdNameTags | null | undefined,
  nameMappingRow: PartialTags | null | undefined,
  manual: PartialTags | null | undefined,
  ai?: PartialTags | null | undefined,
  aiFuzzyDims?: ReadonlyArray<keyof AdNameTags> | null | undefined,
): ResolvedTags {
  const tags = emptyTags();
  const sources: Record<keyof AdNameTags, TagSource | null> = {
    ad_type: null,
    person: null,
    style: null,
    product: null,
    hook: null,
    theme: null,
  };
  const fuzzy = new Set<keyof AdNameTags>(aiFuzzyDims ?? []);

  let usedManual = false;
  let usedCsv = false;
  let usedParsed = false;
  let usedAi = false;
  let needs_review = false;

  for (const dim of TAG_DIMENSIONS) {
    const manualVal = value(manual, dim);
    if (manualVal !== null) {
      tags[dim] = manualVal;
      sources[dim] = "manual";
      usedManual = true;
      continue;
    }

    const csvVal = value(nameMappingRow, dim);
    if (csvVal !== null) {
      tags[dim] = csvVal;
      sources[dim] = "csv_match";
      usedCsv = true;
      continue;
    }

    const parsedVal = value(parsed, dim);
    if (parsedVal !== null) {
      tags[dim] = parsedVal;
      sources[dim] = "parsed";
      usedParsed = true;
      continue;
    }

    const aiVal = value(ai, dim);
    if (aiVal !== null) {
      tags[dim] = aiVal;
      sources[dim] = "ai";
      usedAi = true;
      if (fuzzy.has(dim)) needs_review = true;
      continue;
    }

    // No source supplied this dimension — leave null.
  }

  // tag_source = highest-precedence source that contributed ANY dimension.
  const tag_source: TagSource = usedManual
    ? "manual"
    : usedCsv
      ? "csv_match"
      : usedParsed
        ? "parsed"
        : usedAi
          ? "ai"
          : "untagged";

  return { tags, tag_source, sources, needs_review };
}

// ─────────────────────────────────────────────────────────────────────────────
// US-004: Theme/Persona free-text → governed angle_id reference conversion.
//
// The Creative Matrix's column axis is a single combined Theme/Persona dimension
// that resolves to a REFERENCE into public.angle_clusters (creatives.angle_id),
// not the legacy free-text `theme` column. angle_clusters is the account's
// governed Theme/Persona list (US-001/US-002).
//
// This is the "migration path" the story requires: existing rows carry a
// free-text `theme` string; converting an account means mapping each theme to an
// angle_id when a governed entry matches, and FLAGGING (never dropping) it for
// human review when none does. The original free-text value is always preserved
// on the resolution so the caller can keep it in-place — the conversion is
// additive (fills angle_id), never destructive.
//
// PURE — no IO. The caller fetches the account's angle_clusters rows and passes
// them in; nothing here touches the DB or the six-dimension tag precedence above
// (angle_id is a separate matrix axis, so the locked
// manual > csv_match > parsed > ai > untagged order is unaffected).
// ─────────────────────────────────────────────────────────────────────────────

/** One governed Theme/Persona entry from the account's angle_clusters list. */
export interface AngleRef {
  id: string;
  /** Display label of the Theme/Persona (angle_clusters.label). */
  label: string;
}

/**
 * Normalize a Theme/Persona string for match: lower-cased, whitespace collapsed
 * to single spaces, trimmed. Returns "" for missing/blank input. Used to compare
 * a free-text `theme` against governed labels case- and spacing-insensitively.
 */
export function normalizeThemeKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Build a normalized-label → angle_id index from an account's angle list.
 * Earlier entries win on a duplicate normalized label (stable, deterministic),
 * so a curated list that happens to contain two casings maps to the first.
 */
export function buildAngleIndex(
  angles: ReadonlyArray<AngleRef> | null | undefined,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const a of angles ?? []) {
    if (!a || typeof a.id !== "string" || a.id.length === 0) continue;
    const key = normalizeThemeKey(a.label);
    if (key.length === 0) continue;
    if (!index.has(key)) index.set(key, a.id);
  }
  return index;
}

export interface AngleResolution {
  /** The governed reference, or null when nothing matched (or there was no theme). */
  angle_id: string | null;
  /**
   * The original free-text theme, PRESERVED verbatim (never dropped). null only
   * when the input theme was itself missing/blank.
   */
  theme: string | null;
  /** true iff a governed entry matched the free-text theme. */
  matched: boolean;
  /**
   * true iff there WAS a non-blank free-text theme but no governed entry matched
   * it — the row needs human review to either add the Theme/Persona to the list
   * or pick an existing one. Never true for a blank/absent theme (that is simply
   * untagged, not a review case).
   */
  needs_review: boolean;
}

/**
 * Resolve one free-text theme value to a governed angle_id against an account's
 * angle list. Never drops the free-text value.
 *
 * @param themeValue  The creative's existing free-text `theme` (or null).
 * @param angles      The account's governed Theme/Persona list (angle_clusters).
 *                    Callers should pass the LIVE (non-archived) entries.
 *
 * Outcomes:
 *   - no/blank theme                 → { angle_id:null, theme:null,  matched:false, needs_review:false }
 *   - theme matches a governed label → { angle_id:<id>, theme:<orig>, matched:true,  needs_review:false }
 *   - theme present, no match        → { angle_id:null, theme:<orig>, matched:false, needs_review:true }
 */
export function resolveAngleReference(
  themeValue: string | null | undefined,
  angles: ReadonlyArray<AngleRef> | null | undefined,
): AngleResolution {
  return resolveAngleReferenceWithIndex(themeValue, buildAngleIndex(angles));
}

/**
 * Index-taking variant of {@link resolveAngleReference} for batch conversions:
 * build the index once with {@link buildAngleIndex}, then resolve many rows
 * against it without rebuilding the map each time.
 */
export function resolveAngleReferenceWithIndex(
  themeValue: string | null | undefined,
  angleIndex: Map<string, string>,
): AngleResolution {
  const original = typeof themeValue === "string" && themeValue.trim() !== ""
    ? themeValue
    : null;

  if (original === null) {
    // Nothing to convert — untagged Theme/Persona, not a review case.
    return { angle_id: null, theme: null, matched: false, needs_review: false };
  }

  const id = angleIndex.get(normalizeThemeKey(original)) ?? null;
  if (id !== null) {
    return { angle_id: id, theme: original, matched: true, needs_review: false };
  }

  // Present but unmatched — preserve the free text and flag for review.
  return { angle_id: null, theme: original, matched: false, needs_review: true };
}
