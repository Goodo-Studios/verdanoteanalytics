import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SavedView {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  config: Record<string, any>;
  sort_order: number;
  is_shared: boolean;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  // Joined from profiles for shared views
  owner_name?: string;
}

export function useSavedViews() {
  const { user } = useAuth();
  return useQuery<SavedView[]>({
    queryKey: ["saved-views"],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("saved_views")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as unknown as SavedView[]) || [];
    },
    enabled: !!user,
  });
}

export function usePinnedViews() {
  const { user } = useAuth();
  return useQuery<SavedView[]>({
    queryKey: ["pinned-views"],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("saved_views")
        .select("*")
        .eq("pinned", true)
        .order("sort_order", { ascending: true })
        .limit(3);
      if (error) throw error;
      return (data as unknown as SavedView[]) || [];
    },
    enabled: !!user,
  });
}

export function useToggleShared() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_shared }: { id: string; is_shared: boolean }) => {
      const { error } = await supabase
        .from("saved_views")
        .update({ is_shared } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
    },
  });
}

export function useTogglePinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from("saved_views")
        .update({ pinned } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
      queryClient.invalidateQueries({ queryKey: ["pinned-views"] });
    },
  });
}
