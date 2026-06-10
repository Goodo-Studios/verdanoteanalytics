import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/**
 * Upper bound on candidate creatives fetched to compute the client "What's
 * working" winners. The edge function returns creatives ordered by spend DESC,
 * and a winner must have spend > 0 (see winnerSelection.isWinner), so the
 * highest-spend page is the candidate set selectWinners ranks by KPI. 500 is
 * the edge function's max page size and is a generous superset of the 6 winners
 * the client surface ever displays.
 */
const CANDIDATE_LIMIT = 500;

/**
 * Fetches the winner-candidate creatives for the client "What's working"
 * surface (US-004) as a SINGLE bounded request.
 *
 * Why not useAllCreatives: that hook fetches the ENTIRE creatives table (a count
 * query plus every page in parallel, each triggering the edge function's
 * full-table aggregate loop) only to discard all but 6 winners. Against a real
 * prod dataset that exceeds the client surface's load budget and stalls the
 * winners section in its loading state (the US-009 E2E regression).
 *
 * Instead we ask the edge function for one spend-ranked page of delivering
 * creatives (delivery=had_delivery → spend > 0, already ordered spend DESC),
 * which is exactly the candidate set selectWinners filters and ranks.
 */
export function useWinnerCreatives(accountId?: string) {
  return useQuery<any[]>({
    queryKey: ["winner-creatives", accountId ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (accountId) params.set("account_id", accountId);
      params.set("delivery", "had_delivery"); // spend > 0 — winner prerequisite
      params.set("limit", String(CANDIDATE_LIMIT));
      params.set("offset", "0");
      const result = await apiFetch("creatives", `?${params.toString()}`);
      return Array.isArray(result) ? result : (result?.data ?? []);
    },
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    refetchOnWindowFocus: false,
    // Intentionally no keepPreviousData — on account switch, stale cross-account data must not render.
    enabled: !!accountId,
  });
}
