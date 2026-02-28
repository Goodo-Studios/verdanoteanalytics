import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

const PAGE_SIZE = 500; // Max allowed by the edge function

/**
 * Fetches ALL creatives for an account by auto-paginating through all pages.
 * Use this for analytics/reporting where you need the complete dataset.
 */
export function useAllCreatives(filters: Record<string, string> = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });

  const filterKey = qs.toString();

  return useQuery<any[]>({
    queryKey: ["all-creatives", filterKey],
    queryFn: async () => {
      const allData: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams(qs);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));

        const result = await apiFetch("creatives", `?${params.toString()}`);
        const data = Array.isArray(result) ? result : (result?.data || []);
        const total = Array.isArray(result) ? data.length : (result?.total || 0);

        allData.push(...data);

        // Stop if we got fewer than PAGE_SIZE or we've fetched everything
        if (data.length < PAGE_SIZE || allData.length >= total) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
        }
      }

      return allData;
    },
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
}
