import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type {
  AdLibraryFolder,
  AdLibraryBoard,
  AdLibrarySavedAd,
  AdLibraryTag,
} from "@/features/ad-library/types/ad-library";

// ---- Folders ----

export function useAdLibraryFolders() {
  return useQuery<AdLibraryFolder[]>({
    queryKey: ["ad-library-folders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_library_folders")
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
        .from("ad_library_folders")
        .insert({ ...folder, user_id: user!.id })
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
        .from("ad_library_boards")
        .select("*")
        .order("created_at", { ascending: false });
      if (folderId) query = query.eq("folder_id", folderId);
      const { data, error } = await query;
      if (error) throw error;

      // Get ad counts
      const { data: items } = await supabase
        .from("ad_library_board_ads")
        .select("board_id");
      const countMap: Record<string, number> = {};
      (items || []).forEach((i) => {
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
        .from("ad_library_boards")
        .insert({ ...board, user_id: user!.id })
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

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (boardId: string) => {
      // Remove board-ad assignments first
      await supabase
        .from("ad_library_board_ads")
        .delete()
        .eq("board_id", boardId);
      // Delete the board
      const { error } = await supabase
        .from("ad_library_boards")
        .delete()
        .eq("id", boardId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success("Board deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderId: string) => {
      // Get boards in folder
      const { data: folderBoards } = await supabase
        .from("ad_library_boards")
        .select("id")
        .eq("folder_id", folderId);
      const boardIds = (folderBoards || []).map((b) => b.id);
      if (boardIds.length > 0) {
        await supabase
          .from("ad_library_board_ads")
          .delete()
          .in("board_id", boardIds);
        await supabase
          .from("ad_library_boards")
          .delete()
          .in("id", boardIds);
      }
      const { error } = await supabase
        .from("ad_library_folders")
        .delete()
        .eq("id", folderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-folders"] });
      qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      toast.success("Folder deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useMoveBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, folderId }: { boardId: string; folderId: string | null }) => {
      const { error } = await supabase
        .from("ad_library_boards")
        .update({ folder_id: folderId })
        .eq("id", boardId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
      toast.success("Board moved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- Saved Ads ----

export function useSaveAd() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (ad: Partial<AdLibrarySavedAd> & { source_url: string }) => {
      const { data, error } = await supabase
        .from("ad_library_saved_ads")
        .insert({ ...ad, user_id: user!.id })
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
        .from("ad_library_saved_ads")
        .update(updates)
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
        .from("ad_library_saved_ads")
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
        .from("ad_library_board_ads")
        .insert({ board_id, ad_id });
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
        .from("ad_library_board_ads")
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
        .from("ad_library_tags")
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
        .from("ad_library_tags")
        .insert({ ...tag, user_id: user!.id })
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
          .from("ad_library_ad_tags")
          .delete()
          .eq("ad_id", ad_id)
          .eq("tag_id", tag_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("ad_library_ad_tags")
          .insert({ ad_id, tag_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
    },
  });
}
