import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { withDisplayTagsAll } from "@/lib/tagDisplay";

/**
 * Fetches ALL creatives for an account in a SINGLE request.
 * Use this for analytics/reporting where you need the complete dataset.
 *
 * The `creatives` edge function honors `?all=1` by returning the full filtered
 * set in one response (it pages past the 1000-row PostgREST cap server-side).
 *
 * Why one request (replaces the old count + N-parallel-pages strategy):
 *  - The previous count query hit the whole `creatives` table (not the
 *    date-filtered set), so it over-computed the page count and fired phantom
 *    page requests.
 *  - Each page request re-ran the edge function's full daily-metrics
 *    aggregation and just returned a different slice — O(pages) duplicated work
 *    per account switch. One request = one aggregation.
 */
/** The query behind useAllCreatives, shared with useLoadAllCreatives so both use one cache entry. */
export function allCreativesQuery(filters: Record<string, string> = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
  qs.set("all", "1");
  const filterKey = qs.toString();
  return {
    queryKey: ["all-creatives", filterKey],
    queryFn: async (): Promise<any[]> => {
      const result = await apiFetch("creatives", `?${filterKey}`);
      // Legacy ad_type "Image"/"Photo" display as "Static" (read-side only).
      return withDisplayTagsAll(Array.isArray(result) ? result : (result?.data ?? []));
    },
    // 2 hours: this payload only changes when a Meta sync completes (~2h
    // cadence), so refetching more often than the sync interval just re-runs
    // the expensive full-set aggregation for identical data.
    staleTime: 2 * 60 * 60 * 1000,
  };
}

/**
 * `enabled: false` defers the request (audit 7.5): screens that need the full set only after a
 * user action (a tab, an export button) must not run the slow ?all=1 path on render.
 */
export function useAllCreatives(filters: Record<string, string> = {}, opts: { enabled?: boolean } = {}) {
  return useQuery<any[]>({
    ...allCreativesQuery(filters),
    enabled: opts.enabled ?? true,
    refetchOnWindowFocus: false,
    // Intentionally no keepPreviousData — on account switch, stale cross-account data must not render.
  });
}

/**
 * Load the full set on demand, for example when an export button is clicked (audit 7.5). Uses
 * the same cache entry as useAllCreatives, so a recent load is reused.
 */
export function useLoadAllCreatives() {
  const qc = useQueryClient();
  return useCallback((filters: Record<string, string> = {}) => qc.fetchQuery(allCreativesQuery(filters)), [qc]);
}
