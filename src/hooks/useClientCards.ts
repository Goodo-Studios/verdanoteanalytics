// Client pages (OS-019). A client login reads its own tasks through os_client_task_cards(), which
// returns only allow-listed fields, and answers a task in Client Review through os_client_decide().
// Comments use the existing client thread (list_task_comments / post_task_comment), which never
// returns internal comments to a client.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toClientCards, type ClientCard, type ClientDecisionKind } from "@/lib/clientPages";

type Result = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
type Untyped = { rpc(fn: string, args?: Record<string, unknown>): Result };
const db = () => supabase as unknown as Untyped;

export const CLIENT_CARDS_KEY = ["client-cards"] as const;

/** The signed-in client's task cards. */
export function useClientCards(enabled = true) {
  return useQuery<ClientCard[]>({
    queryKey: CLIENT_CARDS_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db().rpc("os_client_task_cards");
      if (error) throw new Error(error.message);
      return toClientCards(data);
    },
  });
}

export interface ClientComment {
  id: number;
  body: string;
  created_at: string;
  mine: boolean;
}

/** The client thread of one task. Only comments in the client thread are kept. */
export function useClientComments(taskId: string | null, userId: string | null) {
  return useQuery<ClientComment[]>({
    queryKey: ["client-comments", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await db().rpc("list_task_comments", { p_task_id: taskId });
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as Array<{ id: number; thread: string; body: string; created_at: string; author_user_id: string | null }>;
      return rows
        .filter((r) => r.thread === "client")
        .map((r) => ({ id: r.id, body: r.body, created_at: r.created_at, mine: !!userId && r.author_user_id === userId }));
    },
  });
}

export function usePostClientComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await db().rpc("post_task_comment", { p_task_id: taskId, p_thread: "client", p_body: body, p_mentions: [] });
      if (error) throw new Error("Your comment could not be sent. Please try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-comments", taskId] }),
  });
}

/** Plain-language message for a refused decision. */
export function decideErrorMessage(code: string | undefined): string {
  switch (code) {
    case "P0409":
      return "This is no longer waiting for your review.";
    case "P0429":
      return "Too many answers on this one. Please try again in a few minutes.";
    case "22023":
      return "Please tell us what to change.";
    default:
      return "We could not send your answer. Please try again.";
  }
}

export function useClientDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { taskId: string; decision: ClientDecisionKind; note?: string }) => {
      const { data, error } = await db().rpc("os_client_decide", {
        p_task_id: input.taskId,
        p_decision: input.decision,
        p_note: input.note ?? null,
      });
      if (error) throw new Error(decideErrorMessage(error.code));
      return data as { status: string; task_status: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_CARDS_KEY }),
  });
}
