import type { QueryClient } from "@tanstack/react-query";

/**
 * Every query that shows a creative's tags. A tag change of any kind (inline edit,
 * bulk tag, auto-tag, Sync from name, Theme/Persona) refreshes all of them, so no
 * screen keeps showing old tags. ["all-creatives"] is cached for 2 hours, so missing
 * it left stale tags on screen for a long time (audit 5.6).
 */
export const TAG_CHANGE_QUERY_KEYS: string[][] = [
  ["creatives"],
  ["all-creatives"],
  ["creative-library"],
  ["creative-filters"],
  ["creative-distinct-hooks"],
  ["accounts"],
];

/** Refresh every screen that shows tags after a tag change. */
export function refreshAfterTagChange(queryClient: QueryClient): Promise<void> {
  return Promise.all(
    TAG_CHANGE_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  ).then(() => undefined);
}
