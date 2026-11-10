// Rules for the client hub Work tab (the ClickUp content pipeline for one client, staff view).
export interface WorkTask {
  id: string;
  task_name: string | null;
  stage: string | null;
  due_date: string | null;
  content_type: string | null;
  updated_at: string | null;
}

export const WORK_COLUMNS = ["Preparing Content", "Production", "Editing", "Client Review", "Ready to Launch"] as const;

/** Cards per board column. A card with no stage starts in the first column; a stage the board does not know is left off. */
export function bucketWork(tasks: WorkTask[]): Record<string, WorkTask[]> {
  const buckets: Record<string, WorkTask[]> = {};
  for (const col of WORK_COLUMNS) buckets[col] = [];
  for (const t of tasks) {
    const stage = t.stage || WORK_COLUMNS[0];
    if (buckets[stage]) buckets[stage].push(t);
  }
  return buckets;
}

/** Soonest due date first; cards with no date last. */
export function sortByDue(tasks: WorkTask[]): WorkTask[] {
  return tasks.slice().sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}
