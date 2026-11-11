// What a card needs to let a client answer it. Provided by the Content Pipeline only for a signed-in client; the
// read-only views and the staff pages leave it empty, so no buttons render there.
import { createContext } from "react";
import type { ClientDecision, DecisionKind } from "@/lib/clientDecisions";

export interface DecisionContextValue {
  decisions: ClientDecision[];
  onDecide: (input: { taskId: string; decision: DecisionKind; note?: string }) => Promise<unknown>;
}

/** Null where the client cannot answer cards. */
export const DecisionContext = createContext<DecisionContextValue | null>(null);

