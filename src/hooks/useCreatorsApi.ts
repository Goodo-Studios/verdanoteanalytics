import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMutationWithToast } from "./useMutationWithToast";

export interface Creator {
  id: string;
  account_id: string;
  name: string;
  handle: string | null;
  type: string;
  notes: string | null;
  created_at: string;
}

export function useCreators(accountId?: string) {
  return useQuery<Creator[]>({
    queryKey: ["creators", accountId],
    enabled: !!accountId && accountId !== "all",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creators" as any)
        .select("*")
        .eq("account_id", accountId!)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as Creator[];
    },
  });
}

export function useCreator(id?: string) {
  return useQuery<Creator>({
    queryKey: ["creator", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creators" as any)
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as Creator;
    },
  });
}

export function useUpsertCreator() {
  return useMutationWithToast({
    mutationFn: async (creator: Partial<Creator> & { account_id: string; name: string }) => {
      if (creator.id) {
        const { data, error } = await supabase
          .from("creators" as any)
          .update({ name: creator.name, handle: creator.handle, type: creator.type, notes: creator.notes } as any)
          .eq("id", creator.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from("creators" as any)
          .insert({ account_id: creator.account_id, name: creator.name, handle: creator.handle, type: creator.type, notes: creator.notes } as any)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    invalidateKeys: [["creators"]],
    successMessage: "Creator saved",
    errorMessage: "Error saving creator",
  });
}

export function useDeleteCreator() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("creators" as any).delete().eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["creators"]],
    successMessage: "Creator deleted",
    errorMessage: "Error deleting creator",
  });
}

export function useLinkCreativesToCreator() {
  return useMutationWithToast({
    mutationFn: async ({ creatorId, adIds }: { creatorId: string; adIds: string[] }) => {
      const { error } = await supabase
        .from("creatives")
        .update({ creator_id: creatorId } as any)
        .in("ad_id", adIds);
      if (error) throw error;
    },
    invalidateKeys: [["creators"], ["creatives"]],
    successMessage: "Creatives linked",
    errorMessage: "Error linking creatives",
  });
}

export function useCreativesByCreator(creatorId?: string) {
  return useQuery({
    queryKey: ["creatives-by-creator", creatorId],
    enabled: !!creatorId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("creatives")
        .select("*")
        .eq("creator_id", creatorId!)
        .order("spend", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}
