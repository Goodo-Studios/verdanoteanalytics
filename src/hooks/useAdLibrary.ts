import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface SavedAd {
  id: string;
  account_id: string | null;
  source: string;
  brand_name: string | null;
  page_id: string | null;
  ad_archive_id: string | null;
  headline: string | null;
  body_text: string | null;
  cta_type: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  landing_page_url: string | null;
  platform: string | null;
  started_running: string | null;
  is_active: boolean | null;
  tags: string[];
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AdCollection {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  account_id: string | null;
  created_by: string;
  created_at: string;
  item_count?: number;
}

export function useSavedAds(filters?: { collection_id?: string; search?: string; tags?: string[] }) {
  return useQuery({
    queryKey: ["ad-library-saved-ads", filters],
    queryFn: async () => {
      let query = supabase
        .from("ad_library_saved_ads" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.search) {
        query = query.or(
          `brand_name.ilike.%${filters.search}%,headline.ilike.%${filters.search}%,body_text.ilike.%${filters.search}%`
        );
      }

      if (filters?.tags && filters.tags.length > 0) {
        query = query.overlaps("tags", filters.tags);
      }

      const { data, error } = await query;
      if (error) throw error;

      // If filtering by collection, get the IDs in that collection
      if (filters?.collection_id) {
        const { data: items } = await supabase
          .from("ad_library_collection_items" as any)
          .select("saved_ad_id")
          .eq("collection_id", filters.collection_id);
        const ids = new Set((items || []).map((i: any) => i.saved_ad_id));
        return (data as unknown as SavedAd[]).filter((ad) => ids.has(ad.id));
      }

      return data as unknown as SavedAd[];
    },
  });
}

export function useAdCollections() {
  return useQuery({
    queryKey: ["ad-library-collections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_library_collections" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Get counts
      const { data: items } = await supabase
        .from("ad_library_collection_items" as any)
        .select("collection_id");

      const countMap: Record<string, number> = {};
      (items || []).forEach((i: any) => {
        countMap[i.collection_id] = (countMap[i.collection_id] || 0) + 1;
      });

      return (data as unknown as AdCollection[]).map((c) => ({
        ...c,
        item_count: countMap[c.id] || 0,
      }));
    },
  });
}

export function useSaveAd() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (ad: Partial<SavedAd>) => {
      const { data, error } = await supabase
        .from("ad_library_saved_ads" as any)
        .insert({ ...ad, created_by: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success("Ad saved to library");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateSavedAd() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SavedAd> & { id: string }) => {
      const { error } = await supabase
        .from("ad_library_saved_ads" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success("Ad updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteSavedAd() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ad_library_saved_ads" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success("Ad removed from library");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (col: { name: string; description?: string; color?: string; account_id?: string }) => {
      const { data, error } = await supabase
        .from("ad_library_collections" as any)
        .insert({ ...col, created_by: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-collections"] });
      toast.success("Collection created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAddToCollection() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ collection_id, saved_ad_id }: { collection_id: string; saved_ad_id: string }) => {
      const { error } = await supabase
        .from("ad_library_collection_items" as any)
        .insert({ collection_id, saved_ad_id } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-collections"] });
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success("Added to collection");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemoveFromCollection() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ collection_id, saved_ad_id }: { collection_id: string; saved_ad_id: string }) => {
      const { error } = await supabase
        .from("ad_library_collection_items" as any)
        .delete()
        .eq("collection_id", collection_id)
        .eq("saved_ad_id", saved_ad_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-collections"] });
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
    },
  });
}
