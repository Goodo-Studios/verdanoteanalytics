import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMutationWithToast } from "./useMutationWithToast";
import { useAuth } from "@/contexts/AuthContext";

export interface Hook {
  id: string;
  account_id: string | null;
  category: string;
  hook_text: string;
  source_ad_id: string | null;
  avg_hook_rate: number | null;
  usage_count: number;
  created_by: string | null;
  tags: string[];
  created_at: string;
}

export function useHooks(accountId?: string) {
  return useQuery<Hook[]>({
    queryKey: ["hooks", accountId],
    queryFn: async () => {
      let q = supabase.from("hooks").select("*").order("created_at", { ascending: false });
      if (accountId && accountId !== "all") {
        q = q.or(`account_id.eq.${accountId},account_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

export function useCreateHook() {
  return useMutationWithToast({
    mutationFn: async (hook: { account_id?: string | null; category: string; hook_text: string; source_ad_id?: string | null; tags?: string[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("hooks").insert({
        ...hook,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    invalidateKeys: [["hooks"]],
    successMessage: "Hook saved",
    errorMessage: "Error saving hook",
  });
}

export function useDeleteHook() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hooks").delete().eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["hooks"]],
    successMessage: "Hook deleted",
    errorMessage: "Error deleting hook",
  });
}

export function useIncrementHookUsage() {
  const qc = useQueryClient();
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { data: hook, error: fetchErr } = await supabase.from("hooks").select("usage_count").eq("id", id).single();
      if (fetchErr) throw fetchErr;
      const { error } = await supabase.from("hooks").update({ usage_count: ((hook as any)?.usage_count || 0) + 1 } as any).eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["hooks"]],
    successMessage: "Hook used",
    errorMessage: "Error tracking usage",
  });
}

export function useImportHooksFromCreatives() {
  return useMutationWithToast({
    mutationFn: async (accountId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      // Fetch top 20 creatives by hook rate
      const { data: creatives, error } = await supabase
        .from("creatives")
        .select("ad_id, ad_name, hook, thumb_stop_rate")
        .eq("account_id", accountId)
        .not("thumb_stop_rate", "is", null)
        .order("thumb_stop_rate", { ascending: false })
        .limit(20);
      if (error) throw error;
      if (!creatives || creatives.length === 0) throw new Error("No creatives with hook rate data found");

      // Map hook tag to category
      const hookToCategory: Record<string, string> = {
        "Problem Callout": "problem",
        "Confession": "story",
        "Question": "question",
        "Statement Bold": "statement",
        "Authority Intro": "social_proof",
        "Before & After": "curiosity",
        "Pattern Interrupt": "contrarian",
      };

      const rows = creatives.map((c: any) => ({
        account_id: accountId,
        category: hookToCategory[c.hook] || "statement",
        hook_text: c.ad_name,
        source_ad_id: c.ad_id,
        avg_hook_rate: c.thumb_stop_rate,
        created_by: user?.id,
      }));

      const { error: insertErr } = await supabase.from("hooks").insert(rows as any);
      if (insertErr) throw insertErr;
      return rows.length;
    },
    invalidateKeys: [["hooks"]],
    successMessage: "Hooks imported from top creatives",
    errorMessage: "Error importing hooks",
  });
}
