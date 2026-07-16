import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CreativeFrame } from "@/features/vault/types/vault";

/**
 * Fetch all creative_frames for an ad, ordered by frame_index ASC (render order),
 * with the joined media_assets row (public_url / content_type / byte_size) when the
 * frame's asset has been cached. US-004.
 *
 * `creative_frames` + `media_assets` aren't in the generated Verdanote types.ts, so
 * the supabase call is cast `as any` (same approach as the vault reads).
 */
export function useCreativeFrames(adId: string | null | undefined, enabled = true) {
  return useQuery<CreativeFrame[]>({
    queryKey: ["creative-frames", adId],
    enabled: !!adId && enabled,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("creative_frames")
        .select(
          `id, ad_id, frame_index, media_type, asset_id,
           media_assets(public_url, content_type, byte_size)`,
        )
        .eq("ad_id", adId)
        .order("frame_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CreativeFrame[];
    },
  });
}
