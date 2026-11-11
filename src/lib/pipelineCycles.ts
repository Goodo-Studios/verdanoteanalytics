// Pure rules for the client's work by cycle (phase 5). Kept out of the components so the grouping, the
// counts, the card titles and the landing rule can be tested alone.
//
// A cycle is the month named in the task ("November Asset 3"). The sync stores it as `cycle_month`
// (first day of that month, year worked out there). A row without it falls back to the month of its
// due date or delivery day, and a row with neither goes to "Other work". Tasks are not linked to an
// engagement in ClickUp, so the header dates come from an engagement only when exactly one of the
// client's engagements started in that month; otherwise the header shows no dates rather than guess.
import { format, parseISO } from "date-fns";

export const DELIVERED_STAGE = "Ready to Launch";
export const WAITING_STAGE = "Client Review";
const FIRST_STAGE = "Preparing Content";

export const BOARD_STAGES = ["Preparing Content", "Production", "Editing", "Client Review", "Ready to Launch"] as const;

export interface CycleTask {
  id: string;
  clickup_task_id?: string | null;
  task_name: string | null;
  stage: string | null;
  due_date: string | null;
  content_type: string | null;
  updated_at: string | null;
  cycle_month?: string | null;
  delivered_at?: string | null;
  asset_link?: string | null;
}

export interface CycleEngagement {
  start_date: string | null;
  day45_date: string | null;
  status: string | null;
}

export type CycleStatus = "current" | "upcoming" | "past" | "other";

export interface CycleGroup {
  /** First day of the month (YYYY-MM-01), or "other". */
  key: string;
  label: string;
  status: CycleStatus;
  tasks: CycleTask[];
  total: number;
  delivered: number;
  /** Tasks past delivery stages: not yet delivered. */
  inProgress: number;
  /** Tasks in Client Review, waiting on the client. */
  waiting: number;
  /** 0 to 100, whole number. */
  percent: number;
  dates: { start: string; end: string | null } | null;
  /** Open when the page first shows. The current cycle, and any earlier cycle still waiting on the client. */
  defaultOpen: boolean;
}

/** A card belongs on the board when its stage is one of the five columns (no stage counts as the first). */
export function isBoardTask(task: Pick<CycleTask, "stage">): boolean {
  return (BOARD_STAGES as readonly string[]).includes(task.stage || FIRST_STAGE);
}

export const stageOf = (task: Pick<CycleTask, "stage">): string => task.stage || FIRST_STAGE;

const monthStartOf = (iso: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[1]}-${m[2]}-01` : null;
};

/** The cycle key of a task: the stored cycle month, else the month of its due date, else of its delivery day. */
export function cycleKeyOf(task: Pick<CycleTask, "cycle_month" | "due_date" | "delivered_at">): string {
  return monthStartOf(task.cycle_month) ?? monthStartOf(task.due_date) ?? monthStartOf(task.delivered_at) ?? "other";
}

/** "November", or "November 2025" when the year is not the current one. */
export function cycleLabel(key: string, now: Date): string {
  if (key === "other") return "Other work";
  const d = parseISO(key);
  return d.getFullYear() === now.getFullYear() ? format(d, "MMMM") : format(d, "MMMM yyyy");
}

/**
 * Dates for a cycle header, from the client's engagements: the one engagement (not cancelled) that
 * started in that month. Two or none: no dates. A standard sprint has an end (day 45); others only a start.
 */
export function cycleDates(key: string, engagements: CycleEngagement[] | null | undefined): { start: string; end: string | null } | null {
  if (key === "other") return null;
  const matches = (engagements ?? []).filter((e) => e.status !== "cancelled" && monthStartOf(e.start_date) === key);
  if (matches.length !== 1) return null;
  const e = matches[0];
  return { start: e.start_date!.slice(0, 10), end: e.day45_date ? e.day45_date.slice(0, 10) : null };
}

/** "Oct 20 to Dec 3", or "Started Oct 20" when there is no end. */
export function formatCycleDates(dates: { start: string; end: string | null } | null): string | null {
  if (!dates) return null;
  const start = format(parseISO(dates.start), "MMM d");
  return dates.end ? `${start} to ${format(parseISO(dates.end), "MMM d")}` : `Started ${start}`;
}

const monthKeyOfDate = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

/**
 * Group a client's board cards into cycles. Order: the current cycle, cycles still to come (soonest
 * first), past cycles (newest first), then work with no cycle. The current cycle is the newest one
 * that is not in the future; when every cycle is in the future, the soonest. A cycle with no tasks
 * is never made up, so an empty cycle simply does not appear.
 */
export function groupByCycle(
  tasks: CycleTask[] | null | undefined,
  engagements: CycleEngagement[] | null | undefined = [],
  now: Date = new Date(),
  /** Task ids the client has already answered (approved or asked for changes): they no longer wait on the client. */
  answered: ReadonlySet<string> = new Set(),
): CycleGroup[] {
  const byKey = new Map<string, CycleTask[]>();
  for (const task of tasks ?? []) {
    if (!isBoardTask(task)) continue;
    const key = cycleKeyOf(task);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(task);
  }

  const dated = [...byKey.keys()].filter((k) => k !== "other").sort().reverse(); // newest first
  const nowKey = monthKeyOfDate(now);
  const notFuture = dated.filter((k) => k <= nowKey);
  let currentKey: string | null = notFuture[0] ?? dated[dated.length - 1] ?? null;
  if (currentKey === null && byKey.has("other")) currentKey = "other";

  const build = (key: string): CycleGroup => {
    const list = byKey.get(key)!;
    const delivered = list.filter((t) => stageOf(t) === DELIVERED_STAGE).length;
    const waiting = list.filter((t) => stageOf(t) === WAITING_STAGE && !(t.clickup_task_id && answered.has(t.clickup_task_id))).length;
    const status: CycleStatus = key === currentKey ? "current" : key === "other" ? "other" : key > nowKey ? "upcoming" : "past";
    return {
      key,
      label: cycleLabel(key, now),
      status,
      tasks: list,
      total: list.length,
      delivered,
      inProgress: list.length - delivered,
      waiting,
      percent: list.length === 0 ? 0 : Math.round((delivered / list.length) * 100),
      dates: cycleDates(key, engagements),
      defaultOpen: status === "current" || (status !== "upcoming" && waiting > 0),
    };
  };

  const upcoming = dated.filter((k) => k > nowKey && k !== currentKey).reverse(); // soonest first
  const past = dated.filter((k) => k <= nowKey && k !== currentKey); // already newest first
  const order = [
    ...(currentKey ? [currentKey] : []),
    ...upcoming,
    ...past,
    ...(byKey.has("other") && currentKey !== "other" ? ["other"] : []),
  ];
  return order.map(build);
}

/** "8 of 12 delivered". */
export function deliveredCountText(group: Pick<CycleGroup, "delivered" | "total">): string {
  return `${group.delivered} of ${group.total} delivered`;
}

// ------------------------------------------------------------------ card titles

const MONTH_WORDS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// "{Month} [year] Asset {N}", then the rest of the name.
const WITH_MONTH = new RegExp(`(?:^|[^a-z])(${MONTH_WORDS})\\.?(?:\\s+\\d{4})?\\s*[^\\sa-z0-9]?\\s*asset\\s*#?(\\d+)`, "i");
const BARE_ASSET = /(?:^|[^a-z])asset\s*#?(\d+)/i;
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface CardTitle {
  /** A readable name, never empty. */
  title: string;
  /** Small line above the title: "Asset 3 · UGC Video". Empty when there is nothing to say. */
  label: string;
}

/**
 * The name a client sees on a card. The "{Month} Asset {N}" prefix is stripped when something readable
 * follows it, and the asset number moves to the small label. When nothing follows, the title says
 * what it is ("November creative") instead of "Untitled task".
 */
export function cardTitle(task: Pick<CycleTask, "task_name" | "content_type" | "cycle_month">): CardTitle {
  const raw = (task.task_name ?? "").replace(/\s+/g, " ").trim();
  let assetNumber: string | null = null;
  let rest = raw;
  let monthName: string | null = null;

  const withMonth = WITH_MONTH.exec(raw);
  const bare = withMonth ? null : BARE_ASSET.exec(raw);
  if (withMonth) {
    assetNumber = withMonth[2];
    rest = raw.slice(withMonth.index + withMonth[0].length);
    const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(withMonth[1].slice(0, 3).toLowerCase());
    if (idx >= 0) monthName = FULL_MONTHS[idx];
  } else if (bare) {
    assetNumber = bare[1];
    rest = raw.slice(bare.index + bare[0].length);
  }

  // Drop the separator after the prefix ("- ", ": ", "| ") and any left at the end: anything that is not a letter or digit.
  const cleaned = rest.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "").trim();
  if (!monthName) {
    const m = /^(\d{4})-(\d{2})/.exec(task.cycle_month ?? "");
    if (m) monthName = FULL_MONTHS[Number(m[2]) - 1] ?? null;
  }

  const fallback = monthName ? `${monthName} creative` : "New creative";
  const title = withMonth || bare ? cleaned || fallback : raw || fallback;
  const label = [assetNumber ? `Asset ${assetNumber}` : null, task.content_type?.trim() || null].filter(Boolean).join(" · ");
  return { title, label };
}

/** "Delivered Nov 12", or null when the delivery day is not stored (never invented). */
export function deliveredLine(task: Pick<CycleTask, "delivered_at">): string | null {
  const d = (task.delivered_at ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `Delivered ${format(parseISO(d), "MMM d")}` : null;
}

// ------------------------------------------------------------------ landing

export type ClientLanding = "wait" | "pipeline" | "metrics";

/**
 * Where a client's first screen sends them. A client with ad accounts lands on the metrics page. A
 * client with no ad account but a link to a client (client_members) has nothing to show on metrics,
 * so it lands on the pipeline. While either answer is still loading it waits, so the empty metrics
 * page never flashes. A client with neither stays where it was.
 */
export function clientLanding(input: {
  isClient: boolean;
  accountsLoading: boolean;
  accountCount: number;
  linksLoading: boolean;
  linkCount: number;
}): ClientLanding {
  if (!input.isClient) return "metrics";
  if (input.accountsLoading) return "wait";
  if (input.accountCount > 0) return "metrics";
  if (input.linksLoading) return "wait";
  return input.linkCount > 0 ? "pipeline" : "metrics";
}
