// US-002: Single, data-driven ad-name parser.
//
// Replaces four divergent ad-name parsers with ONE canonical, positional-flexible
// parser that reads the convention + vocabulary store built in US-001. Eliminates
// the strict 7-segment allow-list bug where valid ads (e.g. names containing the
// "UGC" alias, or with !=7 segments) silently failed to parse.
//
// Design constraints (each maps to a US-002 acceptance criterion):
//   - PURE / deterministic: NO DB access here. The caller resolves the convention
//     (via resolveConvention) and passes it in, so this module is importable by
//     both Deno edge functions and Node consumers with no Deno-only globals.
//   - unique_code is ALWAYS adName.split(separator)[0] — preserves the join key
//     used by sync/index.ts (creatives) regardless of how the rest parses.
//   - Partial tagging: an unresolved segment leaves that tag null; it never fails
//     the whole ad. No `parsed:false`-style hard failure.
//   - Positional-flexible: more OR fewer than 7 segments still produce tags for
//     the segments that map. No length===7 gate.

import type { Dimension, NamingConvention } from "./naming-convention.ts";
import { buildVocabIndex } from "./naming-convention.ts";

/** The six TAG dimensions (everything except unique_code). */
export interface AdNameTags {
  ad_type: string | null;
  person: string | null;
  style: string | null;
  product: string | null;
  hook: string | null;
  theme: string | null;
}

export interface MatchedSegment {
  position: number;
  dimension: string;
  raw: string;
  canonical: string;
}

export interface UnknownSegment {
  position: number;
  raw: string;
  /** The dimension this segment was expected to fill, or null if no position defined it. */
  dimension: string | null;
}

export interface ParsedAdName {
  unique_code: string;
  tags: AdNameTags;
  matchedSegments: MatchedSegment[];
  unknownSegments: UnknownSegment[];
}

/** The tag dimensions, used to seed an all-null tags object. */
const TAG_DIMENSIONS: ReadonlyArray<keyof AdNameTags> = [
  "ad_type",
  "person",
  "style",
  "product",
  "hook",
  "theme",
];

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

function isTagDimension(dimension: Dimension): dimension is keyof AdNameTags {
  return (TAG_DIMENSIONS as ReadonlyArray<string>).includes(dimension);
}

/**
 * Parse an ad name into its unique_code + tag dimensions using a resolved
 * naming convention. Pure and deterministic — no IO.
 *
 * Mapping rules:
 *   - unique_code := adName.split(separator)[0] (always; may be "" for empty input).
 *   - For each convention segment at position i, take token[i]:
 *       * unique_code dimension is authoritative from token[0] (rule above).
 *       * a tag dimension token that resolves via the vocab index (canonical OR
 *         alias, case-insensitive) sets that tag to the canonical value and is
 *         pushed to matchedSegments.
 *       * a tag dimension token present but unresolved leaves the tag null and is
 *         pushed to unknownSegments (with the dimension it was expected to fill).
 *       * no token at a defined position => tag stays null, nothing pushed.
 *   - tokens beyond the last defined segment position go to unknownSegments with
 *     dimension:null.
 */
export function parseAdName(
  adName: string,
  convention: NamingConvention,
): ParsedAdName {
  const separator = convention.separator;
  const tokens = adName.split(separator);

  // Rule 1: unique_code is authoritatively the first split token, always.
  const unique_code = tokens[0] ?? "";

  const tags = emptyTags();
  const matchedSegments: MatchedSegment[] = [];
  const unknownSegments: UnknownSegment[] = [];

  // REUSE the US-001 case-insensitive vocab index — do not reimplement.
  const vocabIndex = buildVocabIndex(convention);

  // Map convention segments by position so we can flexibly look up the dimension
  // expected at each token position without assuming a fixed segment count.
  const dimensionByPosition = new Map<number, Dimension>();
  let maxDefinedPosition = -1;
  for (const segment of convention.segments) {
    dimensionByPosition.set(segment.position, segment.dimension);
    if (segment.position > maxDefinedPosition) {
      maxDefinedPosition = segment.position;
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const dimension = dimensionByPosition.get(i);

    // Token beyond any defined segment position -> unknown, dimension null.
    if (dimension === undefined) {
      unknownSegments.push({ position: i, raw, dimension: null });
      continue;
    }

    // unique_code is handled authoritatively from token[0]; do not also tag it.
    if (dimension === "unique_code") {
      continue;
    }

    // Tag dimension: resolve via the vocab index (canonical or alias, ci).
    if (isTagDimension(dimension)) {
      const dimMap = vocabIndex[dimension];
      const canonical = dimMap?.get(raw.toLowerCase());

      if (canonical !== undefined) {
        tags[dimension] = canonical;
        matchedSegments.push({ position: i, dimension, raw, canonical });
      } else {
        // Present but unresolved: partial tagging — leave null, record unknown.
        unknownSegments.push({ position: i, raw, dimension });
      }
    }
  }

  // Note: positions defined in the convention but with no corresponding token
  // (i.e. a name shorter than the convention) simply leave their tag null and
  // push nothing — no throw. maxDefinedPosition is retained for clarity/intent.
  void maxDefinedPosition;

  return { unique_code, tags, matchedSegments, unknownSegments };
}
