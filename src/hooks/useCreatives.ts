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
    queryFn: () => apiFetch("creatives", qs ? `?${qs}` : ""),
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

