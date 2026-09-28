import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useMutationWithToast } from "./useMutationWithToast";
import type { Database } from "@/integrations/supabase/types";

export type SyncLog = Database["public"]["Tables"]["sync_logs"]["Row"];

interface RefreshMediaResponse {
  skipped?: boolean;
  thumbnails?: { cached?: number };
  videos?: { cached?: number };
}

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
    queryFn: () => apiFetch("sync", `history${accountId ? `?account_id=${accountId}` : ""}`) as Promise<SyncLog[]>,
    refetchInterval: (query) => {
      const logs = query.state.data;
      const hasActive = logs?.some((log) => log.status === "running" || log.status === "queued");
      if (!hasActive) return false;
      // Cap polling: stop after 30 minutes to prevent indefinite polling on stuck syncs
      const oldestActive = logs?.filter((log) => log.status === "running" || log.status === "queued")
        .map((log) => new Date(log.started_at).getTime())
        .sort((a: number, b: number) => a - b)[0];
      if (oldestActive && Date.now() - oldestActive > 30 * 60 * 1000) return false;
      return 2000;
    },
  });
}

export function useRefreshMedia() {
  return useMutationWithToast({
    mutationFn: (params?: { account_id?: string }) => {
      const qs = new URLSearchParams();
      if (params?.account_id) qs.set("account_id", params.account_id);
      qs.set("force", "true");
      return apiFetch("refresh-thumbnails", `?${qs.toString()}`);
    },
    invalidateKeys: [["creatives"], ["all-creatives"]],
    successMessage: (data: RefreshMediaResponse) =>
      data?.skipped
        ? "All media already cached — nothing to refresh"
        : `Media refreshed — ${data?.thumbnails?.cached ?? 0} thumbnails, ${data?.videos?.cached ?? 0} videos cached`,
    errorMessage: "Media refresh failed",
  });
}
