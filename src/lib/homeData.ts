// Rules for the staff Home blocks and the cross-client Work page. Pure functions over rows the
// pages already read (pipeline_tasks, handoff_packets, support_requests, operating_budget_alerts),
// so each rule can be tested alone. Nothing here reads or writes data.
import { parseISO, format } from "date-fns";
import { hubPath } from "@/lib/clientHub";

/** A ClickUp card, as the Home blocks and the Work page read it. */
export interface HomeTask {
  id: string;
  clickup_task_id: string | null;
  client_slug: string;
  task_name: string | null;
  stage: string | null;
  due_date: string | null;
  synced_at: string | null;
}

export interface HomeHandoff {
  id: string;
  client_slug: string;
  receiving_role: string;
  receiver_id: string;
  due_date: string;
  status: string;
}

export interface HomeSupport {
  id: string;
  client_slug: string;
  subject: string;
  status: string;
  next_update_target: string;
  accountable_user_id: string;
  backup_user_id: string | null;
}

export interface HomeBudgetAlert {
  id: string;
  level: "warning" | "limit";
  period_month: string;
}

/** Stages Goodo owns. A card past its date in one of these is late work. */
export const GOODO_STAGES = ["Preparing Content", "Production", "Editing"] as const;
export const CLIENT_REVIEW = "Client Review";
export const DONE_STAGE = "Ready to Launch";
export const ALL_STAGES = [...GOODO_STAGES, CLIENT_REVIEW, DONE_STAGE] as const;

/** Hours after the last ClickUp sync before the board counts as stale. Same rule as
 *  supabase/functions/_shared/integration-health.ts (CLICKUP_FRESHNESS_HOURS); the sync runs every 4 hours. */
export const CLICKUP_FRESHNESS_HOURS = 8;
/** The most rows a block shows. */
export const BLOCK_ROWS = 5;

const DAY = 86_400_000;

/** A date as YYYY-MM-DD in the browser's time zone. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const todayIso = (now: Date = new Date()): string => isoDay(now);

export function addDaysIso(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

/** First day of the month, YYYY-MM-DD. */
export function monthStartIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/** "Nov 12". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "No date";
  try {
    return format(parseISO(iso.slice(0, 10)), "MMM d");
  } catch {
    return "No date";
  }
}

const stageOf = (t: Pick<HomeTask, "stage">) => t.stage || GOODO_STAGES[0];
const dueOf = (t: Pick<HomeTask, "due_date">) => (t.due_date ? t.due_date.slice(0, 10) : null);

/** Soonest due date first; cards with no date last; then by name so the order is steady. */
export function byDue<T extends Pick<HomeTask, "due_date" | "task_name">>(tasks: T[]): T[] {
  return tasks.slice().sort((a, b) => {
    const ad = dueOf(a);
    const bd = dueOf(b);
    if (ad && bd && ad !== bd) return ad.localeCompare(bd);
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return (a.task_name ?? "").localeCompare(b.task_name ?? "");
  });
}

/** Late: dated before today and not already launched. */
export function isLate(t: HomeTask, today: string = todayIso()): boolean {
  const due = dueOf(t);
  return !!due && due < today && stageOf(t) !== DONE_STAGE;
}

/** Due from today up to seven days ahead (inclusive of day 7), not already launched. */
export function isDueThisWeek(t: HomeTask, today: string = todayIso()): boolean {
  const due = dueOf(t);
  return !!due && due >= today && due <= addDaysIso(today, 7) && stageOf(t) !== DONE_STAGE;
}

export const dueThisWeek = (tasks: HomeTask[], today?: string) => byDue(tasks.filter((t) => isDueThisWeek(t, today)));
export const waitingOnClient = (tasks: HomeTask[]) => byDue(tasks.filter((t) => stageOf(t) === CLIENT_REVIEW));
/** Late cards in stages Goodo owns. */
export const lateGoodoWork = (tasks: HomeTask[], today?: string) =>
  byDue(tasks.filter((t) => (GOODO_STAGES as readonly string[]).includes(stageOf(t)) && isLate(t, today)));

export type WorkView = "week" | "overdue" | "all";

export interface WorkFilters {
  view: WorkView;
  client: string;
  stage: string;
  query: string;
}

export function filterWork(tasks: HomeTask[], f: WorkFilters, today: string = todayIso()): HomeTask[] {
  const q = f.query.trim().toLowerCase();
  const rows = tasks.filter((t) => {
    if (f.view === "week" && !isDueThisWeek(t, today)) return false;
    if (f.view === "overdue" && !isLate(t, today)) return false;
    if (f.client && t.client_slug !== f.client) return false;
    if (f.stage && stageOf(t) !== f.stage) return false;
    if (q && !(t.task_name ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
  return byDue(rows);
}

/** Address of the card in ClickUp. The board stores the ClickUp task id, not a URL, so the address is built from it. */
export function clickupTaskUrl(t: Pick<HomeTask, "clickup_task_id">): string | null {
  return t.clickup_task_id ? `https://app.clickup.com/t/${encodeURIComponent(t.clickup_task_id)}` : null;
}

// ------------------------------------------------------------------ clients needing attention

export interface AttentionRow {
  key: string;
  /** Client name, or the name of the thing that needs a look (ClickUp sync, Operating costs). */
  name: string;
  /** One plain sentence. */
  reason: string;
  /** Role-relative address of the page that explains it. */
  to: string;
  /** Late work or an overdue update: the only rows drawn in red. */
  late: boolean;
}

export interface AttentionInput {
  tasks: HomeTask[];
  support: HomeSupport[];
  budgetAlerts: HomeBudgetAlert[];
  clientNames: Record<string, string>;
  now?: Date;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Hours between a timestamp and now, or null when it is not a date. */
function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / (DAY / 24) : null;
}

/** The newest synced_at of the given cards, or null. */
function newestSync(tasks: HomeTask[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const t of tasks) {
    const ms = t.synced_at ? Date.parse(t.synced_at) : NaN;
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = t.synced_at;
    }
  }
  return best;
}

/**
 * One calm list for the builder. Per client, one line with the main reason (late work first, then an
 * overdue support update, then a stale ClickUp sync) and a count of any others. A stale sync across the
 * whole board is one line of its own, not one line per client. Budget alerts are about the business,
 * not a client, so they are a line of their own too.
 */
export function clientsNeedingAttention(input: AttentionInput): AttentionRow[] {
  const now = input.now ?? new Date();
  const today = todayIso(now);
  const name = (slug: string) => input.clientNames[slug] ?? "A client";
  const reasons = new Map<string, Array<{ text: string; to: string; late: boolean; rank: number }>>();
  const add = (slug: string, r: { text: string; to: string; late: boolean; rank: number }) => {
    const list = reasons.get(slug) ?? [];
    list.push(r);
    reasons.set(slug, list);
  };

  // Late work in stages Goodo owns.
  const lateBy = new Map<string, HomeTask[]>();
  for (const t of lateGoodoWork(input.tasks, today)) lateBy.set(t.client_slug, [...(lateBy.get(t.client_slug) ?? []), t]);
  for (const [slug, list] of lateBy) {
    const oldest = dueOf(list[0]);
    add(slug, { text: `${plural(list.length, "task is", "tasks are")} late, the oldest was due ${shortDate(oldest)}.`, to: hubPath(slug, "work"), late: true, rank: 0 });
  }

  // Support updates that were promised and not given.
  const overdueBy = new Map<string, number>();
  for (const r of input.support) if (r.status === "open" && r.next_update_target < today) overdueBy.set(r.client_slug, (overdueBy.get(r.client_slug) ?? 0) + 1);
  for (const [slug, n] of overdueBy) {
    add(slug, { text: `${plural(n, "support update is", "support updates are")} overdue.`, to: `/admin/support?client=${encodeURIComponent(slug)}`, late: true, rank: 1 });
  }

  // ClickUp sync: one line when the whole board is behind; per client only when that client has fallen behind alone.
  const extras: AttentionRow[] = [];
  const newestAll = newestSync(input.tasks);
  const boardHours = hoursSince(newestAll, now);
  if (boardHours !== null && boardHours > CLICKUP_FRESHNESS_HOURS) {
    extras.push({
      key: "clickup-sync",
      name: "ClickUp sync",
      reason: `The board last synced ${Math.round(boardHours)} hours ago, so dates here may be out of date.`,
      to: "/admin/integration-health",
      late: false,
    });
  } else if (boardHours !== null) {
    const bySlug = new Map<string, HomeTask[]>();
    for (const t of input.tasks) bySlug.set(t.client_slug, [...(bySlug.get(t.client_slug) ?? []), t]);
    for (const [slug, list] of bySlug) {
      const h = hoursSince(newestSync(list), now);
      if (h !== null && h > CLICKUP_FRESHNESS_HOURS) {
        add(slug, { text: `Its ClickUp cards last synced ${Math.round(h)} hours ago.`, to: hubPath(slug, "work"), late: false, rank: 2 });
      }
    }
  }

  const rows: AttentionRow[] = [];
  for (const [slug, list] of reasons) {
    list.sort((a, b) => a.rank - b.rank);
    const main = list[0];
    const more = list.length - 1;
    rows.push({
      key: `client-${slug}`,
      name: name(slug),
      reason: more > 0 ? `${main.text} ${plural(more, "other thing", "other things")} to check.` : main.text,
      to: main.to,
      late: main.late,
    });
  }
  // Late first, then by name, so the order does not jump between visits.
  rows.sort((a, b) => Number(b.late) - Number(a.late) || a.name.localeCompare(b.name));

  // Budget: a crossing recorded this month.
  const month = monthStartIso(now);
  const thisMonth = input.budgetAlerts.filter((a) => a.period_month.slice(0, 10) === month);
  if (thisMonth.length > 0) {
    const over = thisMonth.some((a) => a.level === "limit");
    extras.push({
      key: "budget",
      name: "Operating costs",
      reason: over ? "Spend passed the monthly limit." : "Spend passed the warning amount this month.",
      to: "/admin/operating-costs",
      late: false,
    });
  }
  return [...rows, ...extras];
}
