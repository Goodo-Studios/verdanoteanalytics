import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BrainReviewRow } from "@/lib/today";

// my_brain_pages_to_review (migration 20261129080001, OS-016) is not in the generated types yet.
type Untyped = { rpc(name: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** The signed-in person's Brain pages that need review (owner match, more than 90 days). */
export function useBrainPagesToReview(userId: string | undefined) {
  return useQuery<BrainReviewRow[]>({
    queryKey: ["brain-to-review", userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as Untyped).rpc("my_brain_pages_to_review");
      if (error) throw new Error(error.message);
      return (data ?? []) as BrainReviewRow[];
    },
  });
}
