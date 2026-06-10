// Sanitize a user-supplied search term before interpolating it into a
// PostgREST `.or(...)` filter string.
//
// PostgREST's filter grammar treats `,` as the clause separator inside or(),
// `(` / `)` as logic-tree nesting, and `"` as the quoted-literal delimiter.
// Interpolating raw user input (e.g. `ad_name.ilike.%${search}%`) lets a
// crafted search like `x%,spend.gte.0` inject extra filter clauses. Strip the
// structural characters (plus backslash, which escapes inside quoted
// literals) so the operand can only ever match text. Whitespace is collapsed
// so normal multi-word searches keep working.
export function sanitizeSearchTerm(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[,()"\\]/g, " ").replace(/\s+/g, " ").trim();
}
