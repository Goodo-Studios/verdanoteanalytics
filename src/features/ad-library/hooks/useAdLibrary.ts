import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type {
  AdLibraryFolder,
  AdLibraryBoard,
  AdLibrarySavedAd,
  AdLibraryTag,
  AdLibraryBoardAd,
} from "@/features/ad-library/types/ad-library";

// ---- Folders ----

export function useAdLibraryFolders() {
  return useQuery<AdLibraryFolder[]>({
    queryKey: ["ad-library-folders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_library_folders" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as AdLibraryFolder[];
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (folder: { name: string; description?: string; color?: string }) => {
      const { data, error } = await supabase
        .from("ad_library_folders" as any)
        .insert({ ...folder, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as AdLibraryFolder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-folders"] });
      toast.success("Folder created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- Boards ----

export function useAdLibraryBoards(folderId?: string | null) {
  return useQuery<AdLibraryBoard[]>({
    queryKey: ["ad-library-boards", folderId],
    queryFn: async () => {
      let query = supabase
        .from("ad_library_boards" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (folderId) query = query.eq("folder_id", folderId);
      const { data, error } = await query;
      if (error) throw error;

      // Get ad counts
      const { data: items } = await supabase
        .from("ad_library_board_ads" as any)
        .select("board_id");
      const countMap: Record<string, number> = {};
      (items || []).forEach((i: any) => {
        countMap[i.board_id] = (countMap[i.board_id] || 0) + 1;
      });

      return (data as unknown as AdLibraryBoard[]).map((b) => ({
        ...b,
        ad_count: countMap[b.id] || 0,
      }));
    },
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (board: { name: string; description?: string; folder_id?: string }) => {
      const { data, error } = await supabase
        .from("ad_library_boards" as any)
        .insert({ ...board, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as AdLibraryBoard;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
      toast.success("Board created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- Saved Ads ----

export function useSavedAds(filters?: { board_id?: string; search?: string; tag_ids?: string[] }) {
  return useQuery<AdLibrarySavedAd[]>({
    queryKey: ["ad-library-saved-ads", filters],
    queryFn: async () => {
      // If filtering by board, get the ad IDs first
      let adIdsInBoard: string[] | null = null;
      if (filters?.board_id) {
        const { data: boardAds } = await supabase
          .from("ad_library_board_ads" as any)
          .select("ad_id")
          .eq("board_id", filters.board_id)
          .order("position", { ascending: true });
        adIdsInBoard = (boardAds || []).map((ba: any) => ba.ad_id);
        if (adIdsInBoard.length === 0) return [];
      }

      let query = supabase
        .from("ad_library_saved_ads" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (adIdsInBoard) {
        query = query.in("id", adIdsInBoard);
      }

      if (filters?.search) {
        query = query.or(
          `advertiser_name.ilike.%${filters.search}%,headline.ilike.%${filters.search}%,body_text.ilike.%${filters.search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      // Join tags
      const adIds = (data || []).map((d: any) => d.id);
      let tagMap: Record<string, AdLibraryTag[]> = {};

      if (adIds.length > 0) {
        const { data: adTags } = await supabase
          .from("ad_library_ad_tags" as any)
          .select("ad_id, tag_id")
          .in("ad_id", adIds);

        if (adTags && adTags.length > 0) {
          const tagIds = [...new Set((adTags as any[]).map((at) => at.tag_id))];
          const { data: tags } = await supabase
            .from("ad_library_tags" as any)
            .select("*")
            .in("id", tagIds);

          const tagLookup: Record<string, AdLibraryTag> = {};
          (tags || []).forEach((t: any) => { tagLookup[t.id] = t as AdLibraryTag; });

          (adTags as any[]).forEach((at) => {
            if (!tagMap[at.ad_id]) tagMap[at.ad_id] = [];
            if (tagLookup[at.tag_id]) tagMap[at.ad_id].push(tagLookup[at.tag_id]);
          });
        }
      }

      return (data as unknown as AdLibrarySavedAd[]).map((ad) => ({
        ...ad,
        tags: tagMap[ad.id] || [],
      }));
    },
  });
}

export function useSaveAd() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (ad: Partial<AdLibrarySavedAd> & { source_url: string }) => {
      const { data, error } = await supabase
        .from("ad_library_saved_ads" as any)
        .insert({ ...ad, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as AdLibrarySavedAd;
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
    mutationFn: async ({ id, ...updates }: Partial<AdLibrarySavedAd> & { id: string }) => {
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
      toast.success("Ad removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- Board-Ad Junction ----

export function useAddToBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ board_id, ad_id }: { board_id: string; ad_id: string }) => {
      const { error } = await supabase
        .from("ad_library_board_ads" as any)
        .insert({ board_id, ad_id } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success("Added to board");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemoveFromBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ board_id, ad_id }: { board_id: string; ad_id: string }) => {
      const { error } = await supabase
        .from("ad_library_board_ads" as any)
        .delete()
        .eq("board_id", board_id)
        .eq("ad_id", ad_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
    },
  });
}

// ---- Tags ----

export function useAdLibraryTags() {
  return useQuery<AdLibraryTag[]>({
    queryKey: ["ad-library-tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_library_tags" as any)
        .select("*")
        .order("name");
      if (error) throw error;
      return data as unknown as AdLibraryTag[];
    },
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (tag: { name: string; color?: string }) => {
      const { data, error } = await supabase
        .from("ad_library_tags" as any)
        .insert({ ...tag, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as AdLibraryTag;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-tags"] });
      toast.success("Tag created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleAdTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ad_id, tag_id, remove }: { ad_id: string; tag_id: string; remove?: boolean }) => {
      if (remove) {
        const { error } = await supabase
          .from("ad_library_ad_tags" as any)
          .delete()
          .eq("ad_id", ad_id)
          .eq("tag_id", tag_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("ad_library_ad_tags" as any)
          .insert({ ad_id, tag_id } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
    },
  });
}
