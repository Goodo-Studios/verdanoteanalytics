import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMutationWithToast } from "./useMutationWithToast";

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  filter_config: any[];
  account_id: string | null;
  created_by: string;
  is_shared: boolean;
  color: string;
  created_at: string;
}

export function useSegments() {
  return useQuery<Segment[]>({
    queryKey: ["segments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("segments")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Segment[];
    },
  });
}

export function useCreateSegment() {
  return useMutationWithToast({
    mutationFn: async (segment: {
      name: string;
      description?: string;
      filter_config: any[];
      account_id?: string | null;
      color?: string;
      is_shared?: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("segments")
        .insert({ ...segment, created_by: user.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    invalidateKeys: [["segments"]],
    successMessage: "Segment saved",
    errorMessage: "Failed to save segment",
  });
}

export function useUpdateSegment() {
  return useMutationWithToast({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; description?: string; filter_config?: any[]; color?: string; is_shared?: boolean }) => {
      const { data, error } = await supabase
        .from("segments")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    invalidateKeys: [["segments"]],
    successMessage: "Segment updated",
    errorMessage: "Failed to update segment",
  });
}

export function useDeleteSegment() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("segments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["segments"]],
    successMessage: "Segment deleted",
    errorMessage: "Failed to delete segment",
  });
}
