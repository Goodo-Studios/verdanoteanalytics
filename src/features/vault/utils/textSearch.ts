// Plain-text search for the Vault library. The semantic search (vault-search) ranks by meaning
// and only knows what was embedded; this covers the literal words: the title, the brand, the
// script, the hooks and the other metadata the Vault holds. The page shows both, text matches first.

/** Columns on inspiration_items searched for the typed words. */
export const VAULT_ITEM_SEARCH_COLUMNS = [
  "title",
  "brand_name",
  "creator_handle",
  "ad_body_text",
  "industry",
  "ad_format",
  "target_audience",
  "platform",
  "source_url",
  "script_analysis",
  "visual_analysis",
] as const;

/** Columns on inspiration_frameworks searched for the typed words. */
export const VAULT_FRAMEWORK_SEARCH_COLUMNS = [
  "hook_verbal",
  "hook_text",
  "hook_visual",
  "hook_formula",
  "hook_type",
  "copywriting_framework",
] as const;

/** Shortest search that runs a text query. */
export const VAULT_TEXT_SEARCH_MIN_LENGTH = 2;

/** Most items a text search returns. */
export const VAULT_TEXT_SEARCH_LIMIT = 100;

/**
 * The search term as a safe `ilike` pattern for a PostgREST `or=` filter. `%` and `_` would act as
 * wildcards and `,` `(` `)` `"` would break the filter syntax, so each is neutralised.
 */
export function ilikePattern(term: string): string {
  const cleaned = term
    .trim()
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/[,()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `%${cleaned}%`;
}

/** A PostgREST `or=` expression matching the term in any of the columns. */
export function buildIlikeOr(term: string, columns: readonly string[]): string {
  const pattern = ilikePattern(term);
  return columns.map((c) => `${c}.ilike.${pattern}`).join(",");
}

/** Item ids in first-seen order across several id lists, with no repeats. */
export function mergeIds(...lists: (string[] | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const id of list ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * Text matches first, then semantic matches the text search did not already return. Either list
 * can be empty or missing, so a failed semantic search still shows the text matches.
 */
export function mergeSearchResults<T extends { id: string }>(
  textItems: T[] | null | undefined,
  semanticItems: T[] | null | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...(textItems ?? []), ...(semanticItems ?? [])]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
