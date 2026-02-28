import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ChangelogEntry {
  id: string;
  account_id: string;
  ad_id: string | null;
  change_type: string;
  severity: string;
  title: string;
  description: string | null;
  metric_name: string | null;
  old_value: number | null;
  new_value: number | null;
  pct_change: number | null;
  created_at: string;
  created_by: string | null;
}

export function useChangelog(accountId?: string, adId?: string) {
  return useQuery({
    queryKey: ["changelog", accountId || "all", adId || "all"],
    queryFn: async () => {
      let query = supabase
        .from("performance_changelog")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (accountId && accountId !== "all") query = query.eq("account_id", accountId);
      if (adId) query = query.eq("ad_id", adId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as ChangelogEntry[];
    },
    staleTime: 60_000,
  });
}

export function useAddChangelogEntry() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (entry: {
      account_id: string;
      ad_id?: string | null;
      title: string;
      description?: string;
      change_type?: string;
      severity?: string;
    }) => {
      const { error } = await supabase.from("performance_changelog").insert({
        account_id: entry.account_id,
        ad_id: entry.ad_id || null,
        change_type: entry.change_type || "manual",
        severity: entry.severity || "info",
        title: entry.title,
        description: entry.description || null,
        created_by: user?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
      toast.success("Changelog entry added");
    },
    onError: (e: any) => toast.error("Error adding entry", { description: e.message }),
  });
}

export function useDeleteChangelogEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("performance_changelog").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
    },
  });
}
