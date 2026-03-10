import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useMutationWithToast } from "./useMutationWithToast";

export function useSync() {
  return useMutationWithToast({
    mutationFn: (params: { account_id?: string; sync_type?: string }) =>
      apiFetch("sync", "", { method: "POST", body: JSON.stringify(params) }),
    invalidateKeys: [["accounts"], ["creatives"], ["all-creatives"], ["daily-trends"], ["sync-history"]],
    successMessage: "Sync started",
    errorMessage: "Sync failed",
  });
}

export function useCancelSync() {
  return useMutationWithToast({
    mutationFn: () => apiFetch("sync", "cancel", { method: "POST" }),
    invalidateKeys: [["sync-history"]],
    successMessage: "Sync cancelled",
    errorMessage: "Failed to cancel sync",
  });
}

export function useSyncHistory(accountId?: string) {
  return useQuery({
    queryKey: ["sync-history", accountId],
    queryFn: () => apiFetch("sync", `history${accountId ? `?account_id=${accountId}` : ""}`),
    refetchInterval: (query) => {
      const logs = query.state.data as any[] | undefined;
      const hasActive = logs?.some((l: any) => l.status === "running" || l.status === "queued");
      if (!hasActive) return false;
      // Cap polling: stop after 30 minutes to prevent indefinite polling on stuck syncs
      const oldestActive = logs?.filter((l: any) => l.status === "running" || l.status === "queued")
        .map((l: any) => new Date(l.started_at).getTime())
        .sort((a: number, b: number) => a - b)[0];
      if (oldestActive && Date.now() - oldestActive > 30 * 60 * 1000) return false;
      return 2000;
    },
  });
}

export function useRefreshMedia() {
  return useMutationWithToast({
    mutationFn: (params?: { account_id?: string }) =>
      apiFetch("refresh-thumbnails", params?.account_id ? `?account_id=${params.account_id}` : ""),
    invalidateKeys: [["creatives"], ["all-creatives"]],
    successMessage: (data: any) =>
      `Media refreshed — ${data?.thumbnails?.cached ?? 0} thumbnails, ${data?.videos?.cached ?? 0} videos cached`,
    errorMessage: "Media refresh failed",
  });
}
