// Tag sources that represent user or curated work, which sync must never overwrite or
// delete (audit 5.11). "csv_match" is what the accounts name-mapping upload writes;
// "csv" is the legacy value; "manual" is a hand edit.
export const PROTECTED_TAG_SOURCES = ["manual", "csv", "csv_match"] as const;

/** The list in PostgREST `in` syntax, for `.not("tag_source", "in", ...)`. */
export function protectedTagSourcesInList(): string {
  return `(${PROTECTED_TAG_SOURCES.map((s) => `"${s}"`).join(",")})`;
}
