import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMutationWithToast } from "./useMutationWithToast";

// ── Types ──
interface Moodboard {
  id: string;
  account_id: string | null;
  name: string;
  description: string | null;
  created_by: string;
  is_shared: boolean;
  share_token: string;
  created_at: string;
  item_count?: number;
  preview_thumbnails?: string[];
}

interface MoodboardItem {
  id: string;
  moodboard_id: string;
  type: string;
  ad_id: string | null;
  competitor_ad_id: string | null;
  url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  position: number;
  created_at: string;
  creative?: any;
}

// ── Moodboards list ──
export function useMoodboards(accountId?: string | null) {
  return useQuery<Moodboard[]>({
    queryKey: ["moodboards", accountId],
    queryFn: async () => {
      let q = supabase.from("moodboards").select("*").order("created_at", { ascending: false });
      if (accountId && accountId !== "all") q = q.eq("account_id", accountId);
      const { data, error } = await q;
      if (error) throw error;

      // Get item counts + preview thumbnails
      const boards = data as any[];
      const ids = boards.map((b) => b.id);
      if (ids.length === 0) return [];

      const { data: items } = await supabase
        .from("moodboard_items")
        .select("moodboard_id, thumbnail_url, position")
        .in("moodboard_id", ids)
        .order("position", { ascending: true });

      const itemsByBoard = new Map<string, any[]>();
      (items || []).forEach((item: any) => {
        if (!itemsByBoard.has(item.moodboard_id)) itemsByBoard.set(item.moodboard_id, []);
        itemsByBoard.get(item.moodboard_id)!.push(item);
      });

      return boards.map((b) => {
        const boardItems = itemsByBoard.get(b.id) || [];
        return {
          ...b,
          item_count: boardItems.length,
          preview_thumbnails: boardItems
            .filter((i: any) => i.thumbnail_url)
            .slice(0, 4)
            .map((i: any) => i.thumbnail_url),
        };
      });
    },
  });
}

// ── Single moodboard ──
export function useMoodboard(id: string | undefined) {
  return useQuery<Moodboard | null>({
    queryKey: ["moodboard", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase.from("moodboards").select("*").eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });
}

// ── Public moodboard by share token ──
export function usePublicMoodboard(token: string | undefined) {
  return useQuery<Moodboard | null>({
    queryKey: ["public-moodboard", token],
    queryFn: async () => {
      if (!token) return null;
      const { data, error } = await supabase
        .from("moodboards")
        .select("*")
        .eq("share_token", token)
        .eq("is_shared", true)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!token,
  });
}

// ── Moodboard items ──
export function useMoodboardItems(moodboardId: string | undefined) {
  return useQuery<MoodboardItem[]>({
    queryKey: ["moodboard-items", moodboardId],
    queryFn: async () => {
      if (!moodboardId) return [];
      const { data, error } = await supabase
        .from("moodboard_items")
        .select("*")
        .eq("moodboard_id", moodboardId)
        .order("position", { ascending: true });
      if (error) throw error;

      // Enrich creative items with thumbnail data
      const creativeIds = (data || []).filter((i: any) => i.type === "creative" && i.ad_id).map((i: any) => i.ad_id);
      let creativesMap = new Map<string, any>();
      if (creativeIds.length > 0) {
        const { data: creatives } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, thumbnail_url, roas, spend, ad_type")
          .in("ad_id", creativeIds);
        (creatives || []).forEach((c: any) => creativesMap.set(c.ad_id, c));
      }

      return (data || []).map((item: any) => ({
        ...item,
        creative: item.ad_id ? creativesMap.get(item.ad_id) : undefined,
        thumbnail_url: item.thumbnail_url || creativesMap.get(item.ad_id)?.thumbnail_url || null,
      }));
    },
    enabled: !!moodboardId,
  });
}

// ── Public moodboard items ──
export function usePublicMoodboardItems(moodboardId: string | undefined) {
  return useQuery<MoodboardItem[]>({
    queryKey: ["public-moodboard-items", moodboardId],
    queryFn: async () => {
      if (!moodboardId) return [];
      const { data, error } = await supabase
        .from("moodboard_items")
        .select("*")
        .eq("moodboard_id", moodboardId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!moodboardId,
  });
}

// ── Mutations ──
export function useCreateMoodboard() {
  return useMutationWithToast({
    mutationFn: async (data: { name: string; account_id?: string; description?: string; created_by: string }) => {
      const { data: result, error } = await supabase.from("moodboards").insert(data as any).select().single();
      if (error) throw error;
      return result;
    },
    invalidateKeys: [["moodboards"]],
    successMessage: "Mood board created",
    errorMessage: "Failed to create mood board",
  });
}

export function useUpdateMoodboard() {
  return useMutationWithToast({
    mutationFn: async (data: { id: string; name?: string; description?: string; is_shared?: boolean }) => {
      const { id, ...updates } = data;
      const { error } = await supabase.from("moodboards").update(updates as any).eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["moodboards"], ["moodboard"]],
    successMessage: "Mood board updated",
    errorMessage: "Failed to update mood board",
  });
}

export function useDeleteMoodboard() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("moodboards").delete().eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["moodboards"]],
    successMessage: "Mood board deleted",
    errorMessage: "Failed to delete mood board",
  });
}

export function useAddMoodboardItem() {
  return useMutationWithToast({
    mutationFn: async (data: {
      moodboard_id: string;
      type: string;
      ad_id?: string;
      competitor_ad_id?: string;
      url?: string;
      thumbnail_url?: string;
      caption?: string;
      position?: number;
    }) => {
      const { data: result, error } = await supabase.from("moodboard_items").insert(data as any).select().single();
      if (error) throw error;
      return result;
    },
    invalidateKeys: [["moodboard-items"], ["moodboards"]],
    successMessage: "Item added to mood board",
    errorMessage: "Failed to add item",
  });
}

export function useUpdateMoodboardItem() {
  return useMutationWithToast({
    mutationFn: async (data: { id: string; caption?: string; position?: number }) => {
      const { id, ...updates } = data;
      const { error } = await supabase.from("moodboard_items").update(updates as any).eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["moodboard-items"]],
  });
}

export function useRemoveMoodboardItem() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("moodboard_items").delete().eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["moodboard-items"], ["moodboards"]],
    successMessage: "Item removed",
    errorMessage: "Failed to remove item",
  });
}

// ── Reorder items ──
export function useReorderMoodboardItems() {
  return useMutationWithToast({
    mutationFn: async (items: { id: string; position: number }[]) => {
      for (const item of items) {
        await supabase.from("moodboard_items").update({ position: item.position } as any).eq("id", item.id);
      }
    },
    invalidateKeys: [["moodboard-items"]],
  });
}

// ── Simple list for "Save to Mood Board" picker ──
export function useMoodboardList() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["moodboard-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("moodboards").select("id, name").order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}
