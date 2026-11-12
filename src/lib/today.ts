// Today (OS-010): pure helpers for the War Room Today page. One next action, a short list after it,
// and today's progress (N of M done). The page is src/features/home/TodayPanel.tsx and its data
// hook is src/hooks/useToday.ts.
import { DONE_STATUS, isLateDue, phaseNumber, type MyTaskRow } from "@/lib/myWork";

export { DONE_STATUS };

/** How many items the short list shows under the next action. */
export const SHORT_LIST_MAX = 5;

/** Tasks that count toward today: open and due today or earlier. */
export function isForToday(t: MyTaskRow, today: string): boolean {
  return t.status !== DONE_STATUS && !!t.due_date && t.due_date.slice(0, 10) <= today;
}

/**
 * Order for "what to do next": stuck last, then late first (oldest due date first), then due today,
 * then the rest by due date (no date last), then by phase (later phases first, closer to done),
 * then title.
 */
export function nextActionOrder(a: MyTaskRow, b: MyTaskRow): number {
  const sa = a.is_stuck ? 1 : 0;
  const sb = b.is_stuck ? 1 : 0;
  if (sa !== sb) return sa - sb;
  const da = a.due_date?.slice(0, 10) ?? "9999-12-31";
  const db = b.due_date?.slice(0, 10) ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  const pa = phaseNumber(a.status_info?.stage);
  const pb = phaseNumber(b.status_info?.stage);
  if (pa !== pb) return pb - pa;
  return a.title.localeCompare(b.title);
}

/** The next action and the short list after it. Done and read-only tasks are left out. */
export function pickToday(rows: MyTaskRow[], hidden: ReadonlySet<string> = new Set()): { next: MyTaskRow | null; rest: MyTaskRow[] } {
  const open = rows.filter((t) => t.status !== DONE_STATUS && !t.read_only && !hidden.has(t.id)).sort(nextActionOrder);
  return { next: open[0] ?? null, rest: open.slice(1, 1 + SHORT_LIST_MAX) };
}

export interface TodayProgress {
  done: number;
  total: number;
  /** 0 to 100, whole number. 0 when there is nothing for today. */
  percent: number;
  label: string;
}

/**
 * N of M done today. M is today's open items (due today or late) plus the ones finished today, so
 * finishing an item moves N up and leaves M where it was. `hidden` holds items finished on this page
 * that the server list has not caught up with yet.
 */
export function todayProgress(open: MyTaskRow[], doneToday: number, today: string, hidden: ReadonlySet<string> = new Set()): TodayProgress {
  let left = 0;
  let justDone = 0;
  for (const t of open) {
    if (!isForToday(t, today)) continue;
    if (hidden.has(t.id)) justDone += 1;
    else left += 1;
  }
  const done = doneToday + justDone;
  const total = done + left;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent, label: `${done} of ${total} done today` };
}

/** Builder: late open tasks across every client, oldest due date first. */
export function lateAcrossClients(rows: MyTaskRow[], today: string): MyTaskRow[] {
  return rows
    .filter((t) => t.status !== DONE_STATUS && !t.read_only && isLateDue(t.due_date, today))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.title.localeCompare(b.title));
}

/** Builder: open tasks waiting on a client's approval (the Client Review stage). */
export function awaitingClientApproval(rows: MyTaskRow[]): MyTaskRow[] {
  return rows
    .filter((t) => t.status !== DONE_STATUS && !t.read_only && t.status_info?.stage === "Client Review")
    .sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31") || a.title.localeCompare(b.title));
}

/** Midnight at the start of `today` (local date, YYYY-MM-DD) as an ISO timestamp. */
export function startOfDayIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
}
