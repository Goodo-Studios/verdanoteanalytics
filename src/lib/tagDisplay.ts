// Read-side display helpers for the six naming-convention tag columns.
//
// The Goodo ad naming convention (2026-09-27) makes "Static" the canonical
// ad_type. Older parsed rows can still store the legacy aliases "Image" or
// "Photo"; they are NOT backfilled, so the UI maps them to "Static" whenever it
// reads a creative. Every creatives read hook runs rows through
// withDisplayTags(), so tables, filters, grouping and exports all see "Static".

/** Legacy ad_type spellings that mean "Static" (compared case-insensitively). */
const STATIC_ALIASES = new Set(["static", "image", "photo"]);

/** Map a stored ad_type to its display value ("Image"/"Photo" -> "Static"). */
export function displayAdType(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return null;
  return STATIC_ALIASES.has(trimmed.toLowerCase()) ? "Static" : trimmed;
}

/** Return a copy of a creative row with display-mapped tag values. */
export function withDisplayTags<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const r = row as Record<string, unknown>;
  if (!("ad_type" in r)) return row;
  const mapped = displayAdType(r.ad_type as string | null | undefined);
  if (mapped === r.ad_type) return row;
  return { ...r, ad_type: mapped } as T;
}

/** Map every row of a list through withDisplayTags. */
export function withDisplayTagsAll<T>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).map(withDisplayTags);
}

/** The six tag columns, in the order the naming convention writes them. */
export const TAG_FIELD_ORDER = ["ad_type", "person", "style", "product", "hook", "theme"] as const;
export type TagField = (typeof TAG_FIELD_ORDER)[number];

/** User-facing labels. `style` is shown as "Creative Type". */
export const TAG_FIELD_LABELS: Record<TagField, string> = {
  ad_type: "Ad Type",
  person: "Person",
  style: "Creative Type",
  product: "Product",
  hook: "Hook",
  theme: "Theme",
};
