import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMutationWithToast } from "./useMutationWithToast";

export interface WhitelistingDeal {
  id: string;
  account_id: string;
  creator_id: string | null;
  creator_name: string;
  platform: string;
  status: string;
  access_granted_at: string | null;
  access_expires_at: string | null;
  notes: string | null;
  spend_to_date: number;
  created_at: string;
}

export function useWhitelistingDeals(accountId?: string) {
  return useQuery<WhitelistingDeal[]>({
    queryKey: ["whitelisting_deals", accountId],
    enabled: !!accountId && accountId !== "all",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whitelisting_deals" as any)
        .select("*")
        .eq("account_id", accountId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as WhitelistingDeal[];
    },
  });
}

export function useUpsertWhitelistingDeal() {
  return useMutationWithToast({
    mutationFn: async (deal: Partial<WhitelistingDeal> & { account_id: string; creator_name: string }) => {
      if (deal.id) {
        const { id, ...rest } = deal;
        const { data, error } = await supabase
          .from("whitelisting_deals" as any)
          .update(rest as any)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from("whitelisting_deals" as any)
          .insert(deal as any)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    invalidateKeys: [["whitelisting_deals"]],
    successMessage: "Deal saved",
    errorMessage: "Error saving deal",
  });
}

export function useDeleteWhitelistingDeal() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("whitelisting_deals" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["whitelisting_deals"]],
    successMessage: "Deal deleted",
    errorMessage: "Error deleting deal",
  });
}
