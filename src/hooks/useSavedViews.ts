import { useQuery } from "@tanstack/react-query";
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
  owner_name?: string;
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
