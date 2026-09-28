// Pure helpers for the creatives list filters (GET /creatives, /creatives/filters).

/**
 * ad_type values a filter value should match. "Static" is the canonical for
 * still images; rows written before 20260927100001 store "Image" or "Photo"
 * (no backfill), so a Static filter must match all three. Other values match
 * exactly. Returns [] for an empty filter.
 */
export function adTypeFilterValues(adType: string | null | undefined): string[] {
  if (!adType) return [];
  if (adType.trim().toLowerCase() === "static") return ["Static", "Image", "Photo"];
  return [adType];
}

/** Apply the ad_type filter to a PostgREST query builder (eq for one value, in for several). */
export function applyAdTypeFilter<Q extends { eq: (c: string, v: string) => unknown; in: (c: string, v: string[]) => unknown }>(
  q: Q,
  adType: string | null | undefined,
): Q {
  const values = adTypeFilterValues(adType);
  if (values.length === 0) return q;
  // PostgREST builders return the same builder type from eq/in.
  return (values.length === 1 ? q.eq("ad_type", values[0]) : q.in("ad_type", values)) as Q;
}

/** Distinct non-blank string values, sorted case-insensitively. */
export function distinctValues(values: ReadonlyArray<unknown>): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
