import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api";

const PAGE_SIZE = 500; // Max allowed by the edge function

/**
 * Fetches ALL creatives for an account by fetching all pages in parallel.
 * Use this for analytics/reporting where you need the complete dataset.
 *
 * Strategy (H-12 fix):
 *  1. Prefetch the total count via a Supabase head query (1 round trip).
 *  2. Calculate how many pages are needed.
 *  3. Dispatch all page fetches simultaneously with Promise.all.
 *  4. Concatenate results in offset order.
 *
 * This reduces wall-clock time from O(N pages) serial to O(1 count + 1 page fetch).
 */
export function useAllCreatives(filters: Record<string, string> = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });

  const filterKey = qs.toString();

  return useQuery<any[]>({
    queryKey: ["all-creatives", filterKey],
    queryFn: async () => {
      // Step 1: get total count with a lightweight head query.
      // Apply account_id filter if present so count matches the filtered set.
      let countQuery = supabase
        .from("creatives")
        .select("*", { count: "exact", head: true });

      const accountId = qs.get("account_id");
      if (accountId) {
        countQuery = countQuery.eq("account_id", accountId);
      }

      const { count, error: countError } = await countQuery;
      if (countError) {
        throw new Error(`[useAllCreatives] count query failed: ${countError.message}`);
      }

      const total = count ?? 0;
      if (total === 0) return [];

      // Step 2: calculate pages needed.
      const pageCount = Math.ceil(total / PAGE_SIZE);

      // Step 3: create all page-fetch promises at once.
      const fetchPage = (offset: number): Promise<any[]> => {
        const params = new URLSearchParams(qs);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        return apiFetch("creatives", `?${params.toString()}`).then((result: any) =>
          Array.isArray(result) ? result : (result?.data ?? [])
        );
      };

      const promises = Array.from({ length: pageCount }, (_, i) =>
        fetchPage(i * PAGE_SIZE)
      );

      // Step 4: await all pages in parallel, then flatten in order.
      const pages = await Promise.all(promises);
      return pages.flat();
    },
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}
