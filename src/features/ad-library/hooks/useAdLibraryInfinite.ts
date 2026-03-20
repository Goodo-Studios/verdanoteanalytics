import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AdLibrarySavedAd, AdLibraryTag } from "@/features/ad-library/types/ad-library";

const PAGE_SIZE = 20;

export interface AdLibraryQueryFilters {
  board_id?: string;
  search?: string;
  platform?: string | null;
  format?: string | null;
  tag_ids?: string[];
  sort?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export function useAdLibraryAds(filters: AdLibraryQueryFilters = {}) {
  return useInfiniteQuery<AdLibrarySavedAd[], Error>({
    queryKey: ["ad-library-ads-infinite", filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = (pageParam as number) * PAGE_SIZE;

      // If filtering by board, get ad IDs first
      let adIdsInBoard: string[] | null = null;
      if (filters.board_id) {
        const { data: boardAds } = await supabase
          .from("ad_library_board_ads" as any)
          .select("ad_id")
          .eq("board_id", filters.board_id)
          .order("position", { ascending: true });
        adIdsInBoard = (boardAds || []).map((ba: any) => ba.ad_id);
        if (adIdsInBoard.length === 0) return [];
      }

      // If filtering by tags, get ad IDs with those tags
      let adIdsWithTags: string[] | null = null;
      if (filters.tag_ids && filters.tag_ids.length > 0) {
        const { data: adTags } = await supabase
          .from("ad_library_ad_tags" as any)
          .select("ad_id")
          .in("tag_id", filters.tag_ids);
        adIdsWithTags = [...new Set((adTags || []).map((at: any) => at.ad_id))];
        if (adIdsWithTags.length === 0) return [];
      }

      // Build main query
      let query = supabase
        .from("ad_library_saved_ads" as any)
        .select("*");

      // Apply sort
      switch (filters.sort) {
        case "oldest":
          query = query.order("created_at", { ascending: true });
          break;
        case "advertiser_asc":
          query = query.order("advertiser_name", { ascending: true, nullsFirst: false });
          break;
        case "started_running":
          query = query.order("started_running", { ascending: false, nullsFirst: false });
          break;
        default:
          query = query.order("created_at", { ascending: false });
      }

      // Apply filters
      if (adIdsInBoard) {
        query = query.in("id", adIdsInBoard);
      }
      if (adIdsWithTags) {
        const idsToFilter = adIdsInBoard
          ? adIdsWithTags.filter((id) => adIdsInBoard!.includes(id))
          : adIdsWithTags;
        if (idsToFilter.length === 0) return [];
        query = query.in("id", idsToFilter);
      }

      if (filters.search) {
        query = query.or(
          `advertiser_name.ilike.%${filters.search}%,headline.ilike.%${filters.search}%,body_text.ilike.%${filters.search}%`
        );
      }
      if (filters.platform) {
        query = query.eq("platform", filters.platform);
      }
      if (filters.format) {
        query = query.eq("ad_format", filters.format);
      }
      if (filters.dateFrom) {
        query = query.gte("started_running", filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte("started_running", filters.dateTo);
      }

      // Pagination
      query = query.range(offset, offset + PAGE_SIZE - 1);

      const { data, error } = await query;
      if (error) throw error;

      // Join tags
      const adIds = (data || []).map((d: any) => d.id);
      let tagMap: Record<string, AdLibraryTag[]> = {};

      if (adIds.length > 0) {
        const { data: adTagRows } = await supabase
          .from("ad_library_ad_tags" as any)
          .select("ad_id, tag_id")
          .in("ad_id", adIds);

        if (adTagRows && adTagRows.length > 0) {
          const tagIds = [...new Set((adTagRows as any[]).map((at) => at.tag_id))];
          const { data: tags } = await supabase
            .from("ad_library_tags" as any)
            .select("*")
            .in("id", tagIds);

          const tagLookup: Record<string, AdLibraryTag> = {};
          (tags || []).forEach((t: any) => {
            tagLookup[t.id] = t as AdLibraryTag;
          });

          (adTagRows as any[]).forEach((at) => {
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
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length;
    },
  });
}
