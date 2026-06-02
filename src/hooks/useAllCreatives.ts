import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

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
export function useAllCreatives(filters: Record<string, string> = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
  qs.set("all", "1");

  const filterKey = qs.toString();

  return useQuery<any[]>({
    queryKey: ["all-creatives", filterKey],
    queryFn: async () => {
      const result = await apiFetch("creatives", `?${qs.toString()}`);
      return Array.isArray(result) ? result : (result?.data ?? []);
    },
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}
