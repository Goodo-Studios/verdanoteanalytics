// Summary line at the top of the client Content Pipeline board.
//
// Derived only from the pipeline_tasks rows the board already loads. No new
// data is read or stored. "Waiting on you" means cards in the Client Review
// column: work sent to the client that Goodo is waiting on.

export const CLIENT_REVIEW_STAGE = "Client Review";

export interface WaitingOnYou {
  /** Cards in the Client Review column. */
  count: number;
  /** Earliest due date (YYYY-MM-DD) among those cards, or null if none has one. */
  nextDueDate: string | null;
}

export function waitingOnYou(
  tasks: { stage: string | null; due_date: string | null }[] | null | undefined,
): WaitingOnYou {
  let count = 0;
  let nextDueDate: string | null = null;
  for (const task of tasks ?? []) {
    if (task.stage !== CLIENT_REVIEW_STAGE) continue;
    count++;
    const due = task.due_date?.slice(0, 10) || null;
    if (due && (nextDueDate === null || due < nextDueDate)) nextDueDate = due;
  }
  return { count, nextDueDate };
}
