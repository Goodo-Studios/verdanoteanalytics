// Client approvals and change requests (phase 5b). A client login reads its own clients' decisions through
// the row rules and records one through the client-decision function, which checks the caller again.
// Staff read the decisions of every client (the Home "Client feedback" block, the Work page, the hub Work tab).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api";
import { CLIENT_DECISION_COLUMNS } from "@/lib/pageQueries";
import type { ClientDecision, DecisionKind } from "@/lib/clientDecisions";
import { useStaffHomeAccess } from "@/hooks/useHomeData";

type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & { eq(column: string, value: string): Query };
type Untyped = { from(table: string): { select(columns: string): Query } };
const db = () => supabase as unknown as Untyped;

async function loadDecisions(slug?: string): Promise<ClientDecision[]> {
  const q = db().from("client_task_decisions").select(CLIENT_DECISION_COLUMNS);
  const { data, error } = await (slug ? q.eq("client_slug", slug) : q);
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientDecision[];
}

/** The signed-in client's own decisions, history included. Only for a real client login (`own`). */
export function useOwnDecisions(own: boolean) {
  return useQuery<ClientDecision[]>({
    queryKey: ["client-decisions", "own"],
    enabled: own,
    refetchInterval: 5 * 60 * 1000,
    queryFn: () => loadDecisions(),
  });
}

/** Every client's decisions, or one client's, for staff. Off for a client login and for a staff client preview. */
export function useStaffDecisions(clientSlug?: string) {
  const { enabled } = useStaffHomeAccess();
  return useQuery<ClientDecision[]>({
    queryKey: ["client-decisions", "staff", clientSlug ?? "all"],
    enabled,
    refetchInterval: 5 * 60 * 1000,
    queryFn: () => loadDecisions(clientSlug),
  });
}

export interface DecideInput {
  taskId: string;
  decision: DecisionKind;
  note?: string;
}

/** Send a decision. Resolves with the function's answer; rejects with its plain-language message. */
export async function sendDecision(input: DecideInput): Promise<{ status: "recorded" | "unchanged" }> {
  return apiFetch("client-decision", "", { method: "POST", body: JSON.stringify(input) });
}

export function useRecordDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendDecision,
    onSuccess: () => {
      // The board refreshes: the decision, the "waiting on you" counts and the cards.
      for (const key of [["client-decisions"], ["pipeline-tasks"], ["pipeline-delivered"], ["client-work"], ["home"]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
