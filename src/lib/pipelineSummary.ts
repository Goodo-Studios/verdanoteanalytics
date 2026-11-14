// Summary line at the top of the client Content Pipeline board.
//
// Derived only from the pipeline_tasks rows the board already loads and the client's own decisions.
// "Waiting on you" means cards in the Client Review column that the client has not answered yet. Once the
// client approves or asks for changes, the card is Goodo's to act on and no longer counts here (phase 5b).

export const CLIENT_REVIEW_STAGE = "Client Review";

export interface WaitingOnYou {
  /** Cards in the Client Review column that still wait for the client's answer. */
  count: number;
  /** Earliest due date (YYYY-MM-DD) among those cards, or null if none has one. */
  nextDueDate: string | null;
  /** Cards in the Client Review column the client has already answered. */
  answered: number;
}

export function waitingOnYou(
  tasks: { stage: string | null; due_date: string | null; clickup_task_id?: string | null }[] | null | undefined,
  /** Task ids with a current decision. Leave out when decisions could not be loaded: every card then counts. */
  answeredIds?: ReadonlySet<string>,
): WaitingOnYou {
  let count = 0;
  let answered = 0;
  let nextDueDate: string | null = null;
  for (const task of tasks ?? []) {
    if (task.stage !== CLIENT_REVIEW_STAGE) continue;
    if (task.clickup_task_id && answeredIds?.has(task.clickup_task_id)) {
      answered++;
      continue;
    }
    count++;
    const due = task.due_date?.slice(0, 10) || null;
    if (due && (nextDueDate === null || due < nextDueDate)) nextDueDate = due;
  }
  return { count, nextDueDate, answered };
}
