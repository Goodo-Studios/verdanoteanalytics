import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// OS-026: the Brain playbook section for a task's content type. brain_playbook_for_content_type
// (migration 20261204080001) uses the builder-kept map first, then a Playbooks heading or title
// equal to the content type. Not in the generated types yet, hence the small untyped shape.
type Untyped = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const db = () => supabase as unknown as Untyped;

export interface PlaybookLink {
  section: string;
  slug: string;
  title: string;
  anchor: string | null;
  heading: string | null;
}

export function useBrainPlaybook(contentType: string | null | undefined) {
  const type = (contentType ?? "").trim();
  return useQuery<PlaybookLink | null>({
    queryKey: ["brain-playbook", type.toLowerCase()],
    enabled: type.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db().rpc("brain_playbook_for_content_type", { p_content_type: type });
      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? (data as PlaybookLink[]) : [];
      return rows[0] ?? null;
    },
  });
}
