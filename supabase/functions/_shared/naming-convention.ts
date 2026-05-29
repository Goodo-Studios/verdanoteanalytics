import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// US-001: Thin TypeScript resolver for the server-side naming convention store.
//
// Mirrors the jsonb shape returned by public.get_convention(p_account_id) defined
// in supabase/migrations/20260529000002_naming_convention_store.sql.
// Consumed by the US-002 positional-flexible ad-name parser.

/** One of the seven tag dimensions used by the convention. */
export type Dimension =
  | "unique_code"
  | "ad_type"
  | "person"
  | "style"
  | "product"
  | "hook"
  | "theme";

/** An ordered segment of the convention (position 0 is conventionally unique_code). */
export interface Segment {
  position: number;
  dimension: Dimension;
  required: boolean;
}

/** A controlled-vocabulary entry: a canonical value plus its accepted aliases. */
export interface VocabEntry {
  dimension: Dimension;
  canonical: string;
  aliases: string[];
}

/** Resolved convention as returned by public.get_convention. */
export interface NamingConvention {
  id: string;
  /** null => the global default convention; non-null => a per-account override. */
  account_id: string | null;
  scope: "global" | "override";
  /** Segment separator, e.g. "_". */
  separator: string;
  segments: Segment[];
  vocab: VocabEntry[];
}

/**
 * Resolve the naming convention for an account via the SECURITY DEFINER STABLE
 * Postgres function public.get_convention. Returns the per-account override if
 * one exists, otherwise the global default, or null when nothing is configured.
 *
 * Throws on rpc error: the convention is a hard dependency for the parser, so a
 * failed lookup must surface rather than be silently treated as "unconfigured".
 */
export async function resolveConvention(
  supabase: SupabaseClient,
  accountId: string | null
): Promise<NamingConvention | null> {
  const { data, error } = await supabase.rpc("get_convention", {
    p_account_id: accountId,
  });

  if (error) {
    throw new Error(`Failed to resolve naming convention: ${error.message}`);
  }

  // rpc returns SQL NULL (=> null) when no convention is configured.
  if (!data) return null;

  return data as NamingConvention;
}

/**
 * Build a case-insensitive alias -> canonical lookup map per dimension.
 *
 * Pure (no IO). Keyed by dimension; each value is a Map from a lowercased alias
 * OR lowercased canonical to the canonical value. Canonicals map to themselves.
 *
 * Real-world case it must handle: style alias "UGC" -> canonical "UGCNative", so
 * buildVocabIndex(c)["style"].get("ugc") === "UGCNative".
 */
export function buildVocabIndex(
  convention: NamingConvention
): Record<string, Map<string, string>> {
  const index: Record<string, Map<string, string>> = {};

  for (const entry of convention.vocab) {
    let dimMap = index[entry.dimension];
    if (!dimMap) {
      dimMap = new Map<string, string>();
      index[entry.dimension] = dimMap;
    }

    // Canonical maps to itself (lowercased key).
    dimMap.set(entry.canonical.toLowerCase(), entry.canonical);

    // Every alias (lowercased) maps to the canonical.
    for (const alias of entry.aliases) {
      dimMap.set(alias.toLowerCase(), entry.canonical);
    }
  }

  return index;
}
