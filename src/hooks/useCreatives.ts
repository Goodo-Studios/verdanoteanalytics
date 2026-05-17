import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useMutationWithToast } from "./useMutationWithToast";

const PAGE_SIZE = 100;

export function useCreatives(filters: Record<string, string> = {}, page = 0) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  const qs = params.toString();
  return useQuery<{ data: any[]; total: number }>({
    queryKey: ["creatives", qs],
    queryFn: async () => {
      const result = await apiFetch("creatives", qs ? `?${qs}` : "");
      if (Array.isArray(result)) {
        // Legacy API response: bare array without a total count.
        // Using result.length as total would cap pagination to the first page,
        // so return a sentinel to let pagination continue until a short page is returned.
        console.warn(
          "[useCreatives] API returned bare array (legacy format) — total unknown, using sentinel 999999. " +
          "Update the API to return { data, total } to fix this warning."
        );
        return { data: result, total: 999999 };
      }
      return result;
    },
  });
}

export const CREATIVES_PAGE_SIZE = PAGE_SIZE;

export function useCreativeFilters() {
  return useQuery({ queryKey: ["creative-filters"], queryFn: () => apiFetch("creatives", "filters") });
}

export function useUpdateCreative() {
  return useMutationWithToast({
    mutationFn: ({ adId, updates }: { adId: string; updates: Record<string, any> }) =>
      apiFetch("creatives", adId, { method: "PUT", body: JSON.stringify(updates) }),
    invalidateKeys: [["creatives"], ["accounts"]],
    successMessage: "Tags updated",
    errorMessage: "Error updating tags",
  });
}

export function useBulkUntag() {
  return useMutationWithToast({
    mutationFn: (adIds: string[]) =>
      apiFetch("creatives", "bulk-untag", { method: "POST", body: JSON.stringify({ ad_ids: adIds }) }),
    invalidateKeys: [["creatives"], ["accounts"]],
    successMessage: "Creatives marked as untagged",
  });
}

export function useAutoTagPreview() {
  return useMutationWithToast({
    mutationFn: (accountId: string) =>
      apiFetch("creatives", "auto-tag", { method: "POST", body: JSON.stringify({ account_id: accountId, dry_run: true }) }),
    errorMessage: "Failed to preview auto-tags",
  });
}

export function useAutoTagApply() {
  return useMutationWithToast({
    mutationFn: (accountId: string) =>
      apiFetch("creatives", "auto-tag", { method: "POST", body: JSON.stringify({ account_id: accountId }) }),
    invalidateKeys: [["creatives"], ["accounts"]],
    successMessage: (data: any) => `Auto-tagged ${data.applied} creatives`,
    errorMessage: "Failed to apply auto-tags",
  });
}

export function useAnalyzeCreative() {
  return useMutationWithToast({
    mutationFn: (adId: string) =>
      apiFetch("analyze-creative", "", { method: "POST", body: JSON.stringify({ ad_id: adId }) }),
    invalidateKeys: [["creatives"]],
    successMessage: "AI analysis complete",
    errorMessage: "Analysis failed",
  });
}

export function useBulkAnalyze() {
  return useMutationWithToast({
    mutationFn: (limit?: number) =>
      apiFetch("analyze-creative", "", { method: "POST", body: JSON.stringify({ bulk: true, limit: limit || 20 }) }),
    invalidateKeys: [["creatives"]],
    successMessage: (data: any) => `Analyzed ${data.analyzed} creatives`,
    successDescription: (data: any) => data.errors > 0 ? `${data.errors} errors occurred` : undefined,
    errorMessage: "Bulk analysis failed",
  });
}
