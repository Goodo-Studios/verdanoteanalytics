import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useMutationWithToast } from "./useMutationWithToast";
import { useAccountContext } from "@/contexts/AccountContext";

export function useCompetitors() {
  const { selectedAccountId } = useAccountContext();
  const qs = selectedAccountId && selectedAccountId !== "all" ? `?account_id=${selectedAccountId}` : "";
  return useQuery({
    queryKey: ["competitors", selectedAccountId],
    queryFn: () => apiFetch("competitor-ads", qs ? qs : ""),
  });
}

export function useCreateCompetitor() {
  return useMutationWithToast({
    mutationFn: (data: { account_id: string; brand_name: string; facebook_page_id?: string; facebook_page_name?: string; notes?: string }) =>
      apiFetch("competitor-ads", "", { method: "POST", body: JSON.stringify(data) }),
    invalidateKeys: [["competitors"]],
    successMessage: "Competitor added",
    errorMessage: "Failed to add competitor",
  });
}

export function useDeleteCompetitor() {
  return useMutationWithToast({
    mutationFn: (id: string) => apiFetch("competitor-ads", id, { method: "DELETE" }),
    invalidateKeys: [["competitors"]],
    successMessage: "Competitor removed",
    errorMessage: "Failed to remove competitor",
  });
}

export function useAdLibrary(pageId: string | null, searchTerms: string | null, enabled = true) {
  return useQuery({
    queryKey: ["ad-library", pageId, searchTerms],
    queryFn: () => {
      const params = new URLSearchParams();
      if (pageId) params.set("page_id", pageId);
      if (searchTerms) params.set("search_terms", searchTerms);
      return apiFetch("competitor-ads", `library?${params.toString()}`);
    },
    enabled: enabled && !!(pageId || searchTerms),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePageSearch(query: string) {
  return useQuery({
    queryKey: ["page-search", query],
    queryFn: () => apiFetch("competitor-ads", `page-search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 3,
    staleTime: 10 * 60 * 1000,
  });
}
