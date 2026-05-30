// US-003: Single precedence resolver for creative tags.
//
// Collapses the tag-source precedence logic that was previously duplicated and
// divergent across four taggers (creatives PUT-reset, creatives auto-tag POST,
// sync Phase 5 regex, src/lib/autoTagger.ts) into ONE deterministic resolver.
//
// PRECEDENCE (LOCKED by Matthew):  manual > Coda(name_mappings) > parser > untagged
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
//   else untagged.
//
// Legacy values 'csv' and 'inferred' are NEVER emitted by this resolver — only
// 'manual' | 'csv_match' | 'parsed' | 'untagged'. Pre-existing legacy rows are
// untouched (this module only governs values written by new code paths).
//
// PURE — no IO. Callers fetch the name_mappings row + the creative's manual
// values and the parsed tags, then pass them all in.

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

/** The four — and only four — tag_source values new code may write. */
export type TagSource = "manual" | "csv_match" | "parsed" | "untagged";

/**
 * A partial set of tag dimensions. Used for the manual-override and
 * name_mappings inputs, where any subset of dimensions may be present. Missing
 * or null values mean "this source does not supply this dimension".
 */
export type PartialTags = Partial<Record<keyof AdNameTags, string | null>>;

export interface ResolvedTags {
  tags: AdNameTags;
  tag_source: TagSource;
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
 */
export function resolveTags(
  parsed: AdNameTags | null | undefined,
  nameMappingRow: PartialTags | null | undefined,
  manual: PartialTags | null | undefined,
): ResolvedTags {
  const tags = emptyTags();

  let usedManual = false;
  let usedCsv = false;
  let usedParsed = false;

  for (const dim of TAG_DIMENSIONS) {
    const manualVal = value(manual, dim);
    if (manualVal !== null) {
      tags[dim] = manualVal;
      usedManual = true;
      continue;
    }

    const csvVal = value(nameMappingRow, dim);
    if (csvVal !== null) {
      tags[dim] = csvVal;
      usedCsv = true;
      continue;
    }

    const parsedVal = value(parsed, dim);
    if (parsedVal !== null) {
      tags[dim] = parsedVal;
      usedParsed = true;
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
        : "untagged";

  return { tags, tag_source };
}
