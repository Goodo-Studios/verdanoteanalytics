import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function useMediaRefreshLogs() {
  return useQuery({
    queryKey: ["media-refresh-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("media_refresh_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    refetchInterval: (query) => {
      const logs = query.state.data as any[] | undefined;
      const hasRunning = logs?.some((l: any) => l.status === "running");
      if (!hasRunning) return false;
      // Cap polling: stop after 30 minutes to prevent indefinite polling
      const oldestRunning = logs?.filter((l: any) => l.status === "running")
        .map((l: any) => new Date(l.started_at).getTime())
        .sort((a: number, b: number) => a - b)[0];
      if (oldestRunning && Date.now() - oldestRunning > 30 * 60 * 1000) return false;
      return 2000;
    },
  });
}

/** Returns true when any media refresh is currently running. Toasts on completion. */
export function useIsRefreshingMedia() {
  const { data: logs } = useMediaRefreshLogs();
  const wasRefreshing = useRef(false);

  const isRefreshing = (logs || []).some((l: any) => l.status === "running");

  useEffect(() => {
    if (wasRefreshing.current && !isRefreshing && logs?.length) {
      const latest = logs[0] as any;
      if (latest.status === "completed") {
        const thumbs = latest.thumbs_cached ?? 0;
        const videos = latest.videos_cached ?? 0;
        toast.success("Media refresh finished", {
          description: `${thumbs} thumbnails, ${videos} videos cached.`,
        });
      } else if (latest.status === "failed") {
        toast.error("Media refresh failed", {
          description: "Check logs for details.",
        });
      }
    }
    wasRefreshing.current = isRefreshing;
  }, [isRefreshing, logs]);

  return isRefreshing;
}
