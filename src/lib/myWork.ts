// My work (OS-009): the open os_tasks rows where the signed-in person is strategist, producer or
// editor. Pure helpers only: the phase marker, late dates, due-date groups and the filters. The
// page (src/features/home/MyWorkPage.tsx) and its data hook (src/hooks/useMyWork.ts) use these.
import { addDaysIso } from "@/lib/homeData";

/** The five asset stages in workflow order (os_task_statuses.stage). 'Other' is not a phase. */
export const PHASES = ["Preparing Content", "Production", "Editing", "Client Review", "Ready to Launch"] as const;
export type Phase = (typeof PHASES)[number];

/**
 * Only the columns one row needs. No brief, description, hooks or QA list: those load in the side
 * panel when a row opens. Client name and stage come from the two foreign keys.
 */
export const MY_TASK_COLUMNS =
  "id, title, client_slug, status, due_date, is_stuck, read_only, strategist_id, producer_id, editor_id, client:clients(name), status_info:os_task_statuses(stage)";

/** The status that means done. Done tasks are not on the list. */
export const DONE_STATUS = "complete";

export interface MyTaskRow {
  id: string;
  title: string;
  client_slug: string | null;
  status: string;
  due_date: string | null;
  is_stuck?: boolean | null;
  read_only?: boolean | null;
  strategist_id?: string | null;
  producer_id?: string | null;
  editor_id?: string | null;
  client?: { name: string | null } | null;
  status_info?: { stage: string | null } | null;
}

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

export const DUE_GROUPS: Array<{ id: DueGroup; label: string }> = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "later", label: "Later" },
  { id: "none", label: "No date" },
];

/** 1 to 5 for the five stages, 0 for 'Other' or an unknown stage. */
export function phaseNumber(stage: string | null | undefined): number {
  const i = PHASES.indexOf((stage ?? "") as Phase);
  return i + 1;
}

/** The marker's accessible label, e.g. "Phase 3 of 5: Editing". */
export function phaseLabel(stage: string | null | undefined): string {
  const n = phaseNumber(stage);
  return n === 0 ? "No phase" : `Phase ${n} of 5: ${PHASES[n - 1]}`;
}

/** Due before today. A task with no date is never late. */
export function isLateDue(due: string | null | undefined, today: string): boolean {
  return !!due && due.slice(0, 10) < today;
}

/** Overdue, today, this week (the next six days after today), later, or no date. */
export function dueGroup(due: string | null | undefined, today: string): DueGroup {
  if (!due) return "none";
  const d = due.slice(0, 10);
  if (d < today) return "overdue";
  if (d === today) return "today";
  if (d <= addDaysIso(today, 6)) return "week";
  return "later";
}

export interface MyWorkFilters {
  client: string;
  /** "" for all, a stage name, or "Other". */
  phase: string;
}

export function filterMyTasks(rows: MyTaskRow[], f: MyWorkFilters): MyTaskRow[] {
  return rows.filter((t) => {
    if (f.client && (t.client_slug ?? "") !== f.client) return false;
    if (f.phase) {
      const stage = t.status_info?.stage ?? "Other";
      const inPhase = f.phase === "Other" ? phaseNumber(stage) === 0 : stage === f.phase;
      if (!inPhase) return false;
    }
    return true;
  });
}

/** Soonest first, no date last, then title. */
function byDue(a: MyTaskRow, b: MyTaskRow): number {
  const da = a.due_date ?? "9999-12-31";
  const db = b.due_date ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** The groups in order, each sorted, empty groups left out. One pass over the rows. */
export function groupMyTasks(rows: MyTaskRow[], today: string): Array<{ id: DueGroup; label: string; tasks: MyTaskRow[] }> {
  const buckets: Record<DueGroup, MyTaskRow[]> = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const t of rows) buckets[dueGroup(t.due_date, today)].push(t);
  return DUE_GROUPS.filter((g) => buckets[g.id].length > 0).map((g) => ({ ...g, tasks: buckets[g.id].sort(byDue) }));
}

/** Client filter options from the rows themselves, by name. */
export function clientOptions(rows: MyTaskRow[]): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const t of rows) {
    if (t.client_slug && !seen.has(t.client_slug)) seen.set(t.client_slug, t.client?.name || t.client_slug);
  }
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Which of the three roles the person holds on the task, e.g. "Editor". */
export function rolesOf(t: MyTaskRow, userId: string): string[] {
  const out: string[] = [];
  if (t.strategist_id === userId) out.push("Strategist");
  if (t.producer_id === userId) out.push("Producer");
  if (t.editor_id === userId) out.push("Editor");
  return out;
}
