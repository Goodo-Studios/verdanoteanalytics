// Old dashboard pages in Verdanote (consolidation step 5a): Overview, Client
// Detail, Creator pipeline and Follow-ups. Rows come from the dashboard tables
// copied by migration 20261101000001 (clients, deliverables, creator_assignments,
// dashboard_creators, app_users; staff-only row rules) and from the client model
// of PR 143 (client_ad_accounts, engagements, pipeline_tasks). The rules here
// are ports of the old dashboard's src/lib helpers; the database stays the
// authority for every write.

export interface DashboardClient {
  slug: string;
  name: string;
  status: string;
  active: boolean;
  does_creators: boolean;
  does_production: boolean;
  origin: string;
  service_type: string | null;
  strategist: string | null;
  pct_complete: number | null;
  contract_start: string | null;
  contract_end: string | null;
  last_synced: string | null;
  scope: string | null;
  notes: string | null;
}

/** One Content Pipeline card (pipeline_tasks, fed from ClickUp by sync-clickup-tasks). */
export interface BoardCard {
  client_slug: string;
  stage: string | null;
  due_date: string | null;
}

export interface ActiveEngagement {
  client_slug: string;
  cycle_number: number;
  start_date: string | null;
  day30_date: string | null;
  day45_date: string | null;
}

// --------------------------------------------------------------- client origin
//
// clients.origin is 'manual' (added by hand) or 'coda'. 'coda' is a legacy name
// from before ClickUp replaced Coda: it marks a client whose details the HQ
// sync keeps in step with its knowledge file. Anything that is not 'manual'
// counts as synced, so an unknown value errs towards a warning, not silence.

export function isSyncedClient(origin: string | null | undefined): boolean {
  return origin !== "manual";
}

export const SYNCED_DETAILS_NOTE =
  "Kept in step with this client's knowledge file by the HQ sync. Service type, strategist, contract dates and status are changed in the knowledge file.";
export const MANUAL_PROGRESS_NOTE = "Added by hand. No sync updates this client, so progress is only what is entered here.";

// --------------------------------------------------------------- time

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return Infinity;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return Infinity;
  return (now.getTime() - ms) / DAY_MS;
}

/** No update from the sync in 21 days. */
export function isStale(lastSynced: string | null | undefined, now: Date): boolean {
  return daysSince(lastSynced, now) > 21;
}

/** Under half done and no update in 14 days. */
export function isAtRisk(pct: number | null | undefined, lastSynced: string | null | undefined, now: Date): boolean {
  const value = typeof pct === "number" ? pct : 0;
  return value < 50 && daysSince(lastSynced, now) > 14;
}

export function formatAgo(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (Number.isNaN(diff)) return "never";
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return then.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** A date-only value ("2026-11-10") shown without a time-zone shift. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "Not set";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return "Not set";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function todayValue(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

/** Day number within a 45-day cycle, 1 on the start date. Null before it starts. */
export function cycleDay(startDate: string | null, now: Date): number | null {
  if (!startDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate);
  if (!m) return null;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Math.floor((today - start) / DAY_MS) + 1;
  return day >= 1 ? day : null;
}

// --------------------------------------------------------------- Overview

/**
 * The Overview scores the creators line: every number on it comes from the UGC
 * cycle (deliverables, progress, sync age). A production-only client has none
 * of that and would show as a permanent 0 percent, stale card.
 */
export function creatorClients(clients: DashboardClient[]): DashboardClient[] {
  return clients.filter((c) => c.active && c.does_creators);
}

export interface OverviewCounts {
  total: number;
  atRisk: number;
  stale: number;
}

/**
 * A hand-made client is left out of both warning tiles: nothing updates its
 * last_synced, so it would sit in Stale forever. Stale wins over At risk.
 */
export function overviewCounts(clients: DashboardClient[], now: Date): OverviewCounts {
  let atRisk = 0;
  let stale = 0;
  for (const c of clients) {
    if (!isSyncedClient(c.origin)) continue;
    if (isStale(c.last_synced, now)) stale += 1;
    else if (isAtRisk(c.pct_complete, c.last_synced, now)) atRisk += 1;
  }
  return { total: clients.length, atRisk, stale };
}

export type ClientHealth = "stale" | "at_risk" | "ok" | "manual";

export function clientHealth(c: DashboardClient, now: Date): ClientHealth {
  if (!isSyncedClient(c.origin)) return "manual";
  if (isStale(c.last_synced, now)) return "stale";
  if (isAtRisk(c.pct_complete, c.last_synced, now)) return "at_risk";
  return "ok";
}

/** Lowest completion first; no number sorts first, then by name. */
export function sortByProgress(clients: DashboardClient[]): DashboardClient[] {
  return [...clients].sort((a, b) => {
    const pa = typeof a.pct_complete === "number" ? a.pct_complete : -1;
    const pb = typeof b.pct_complete === "number" ? b.pct_complete : -1;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
  });
}

// --------------------------------------------------------------- Content Pipeline board

export const BOARD_COLUMNS = ["Preparing Content", "Production", "Editing", "Client Review", "Ready to Launch"] as const;

export interface BoardSummary {
  total: number;
  byColumn: Record<string, number>;
  waitingOnClient: number;
}

export function boardSummary(cards: BoardCard[]): BoardSummary {
  const byColumn: Record<string, number> = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, 0]));
  let total = 0;
  for (const card of cards) {
    if (!card.stage || !(card.stage in byColumn)) continue;
    byColumn[card.stage] += 1;
    total += 1;
  }
  return { total, byColumn, waitingOnClient: byColumn["Client Review"] };
}

export function groupBySlug<T extends { client_slug: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.client_slug);
    if (list) list.push(r);
    else out.set(r.client_slug, [r]);
  }
  return out;
}

export function errorText(code: string | undefined, fallback: string): string {
  if (code === "42501") return "You do not have permission to do that.";
  if (code === "P0002") return "That client no longer exists.";
  return fallback;
}

// --------------------------------------------------------------- creator stages
//
// creator_assignments.stage, in board order (old dashboard src/lib/pipeline.ts
// after migration 065). declined and passed are the terminal stages.

export const STAGES = [
  { value: "sourced", label: "Sourced" },
  { value: "outreach_sent", label: "Outreach Sent" },
  { value: "interested", label: "Interested" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "client_approved", label: "Client Approved" },
  { value: "details_collected", label: "Details Collected" },
  { value: "contract_sent", label: "Contract Sent" },
  { value: "contract_signed", label: "Contract Signed" },
  { value: "product_shipped", label: "Product Shipped" },
  { value: "brief_sent", label: "Brief Sent" },
  { value: "product_delivered", label: "Product Delivered" },
  { value: "shooting", label: "Shooting" },
  { value: "footage_delivered", label: "Footage Delivered" },
  { value: "invoice_received", label: "Invoice Received" },
  { value: "payment_logged", label: "Payment Logged" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
  { value: "passed", label: "Passed" },
] as const;

export type Stage = (typeof STAGES)[number]["value"];
export const TERMINAL_STAGES: readonly string[] = ["declined", "passed"];

export function stageLabel(stage: string): string {
  return STAGES.find((s) => s.value === stage)?.label ?? stage;
}

export function stageIndex(stage: string): number {
  const i = STAGES.findIndex((s) => s.value === stage);
  return i === -1 ? STAGES.length : i;
}

// --------------------------------------------------------------- Client Detail

export interface Deliverable {
  id: string;
  month: string;
  type: string;
  status: string;
}

export const DELIVERABLE_TYPES = ["cycle_brief", "production", "delivery", "report", "performance"] as const;
export const DELIVERABLE_LABEL: Record<string, string> = {
  cycle_brief: "Cycle brief",
  production: "Production",
  delivery: "Delivery",
  report: "Report",
  performance: "Performance",
};
export const DELIVERABLE_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  complete: "Complete",
};

export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Months that have deliverables plus the current one, newest first. */
export function monthOptions(deliverables: Deliverable[], current: string): string[] {
  return [...new Set([current, ...deliverables.map((d) => d.month)])].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
}

export function formatMonth(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Deliverables of one month in the fixed type order. */
export function deliverablesFor(deliverables: Deliverable[], month: string): Deliverable[] {
  const order = (t: string) => {
    const i = (DELIVERABLE_TYPES as readonly string[]).indexOf(t);
    return i === -1 ? DELIVERABLE_TYPES.length : i;
  };
  return deliverables.filter((d) => d.month === month).sort((a, b) => order(a.type) - order(b.type));
}

export const CLIENT_STATUSES = ["active", "draft", "ending / transitioning", "inactive / completed"] as const;

/** Count of creator assignments per stage, in board order, empty stages left out. */
export function stageCounts(assignments: { stage: string }[]): { stage: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of assignments) counts.set(a.stage, (counts.get(a.stage) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => stageIndex(a[0]) - stageIndex(b[0]))
    .map(([stage, count]) => ({ stage, label: stageLabel(stage), count }));
}

export function serviceLines(c: Pick<DashboardClient, "does_creators" | "does_production">): string[] {
  return [c.does_creators ? "Creators" : null, c.does_production ? "Production" : null].filter((x): x is string => x !== null);
}

// --------------------------------------------------------------- Creator pipeline
//
// The old dashboard's Pipeline page: creators assigned to a brand
// (creator_assignments), moved through the stages. Not the Content Pipeline
// (/pipeline), which shows ClickUp asset tasks.

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

export interface Assignment {
  id: string;
  creator_id: string;
  client_slug: string;
  stage: string;
  owner_id: string | null;
  next_follow_up_at: string | null;
  next_follow_up_source: string | null;
  tracking_number: string | null;
  product_delivered_at: string | null;
  delivery_notes: string | null;
  brief_name: string | null;
  notes: string | null;
  dashboard_creators: { name: string; scale: number | null; do_not_use_again: boolean } | null;
}

export interface CreatorOption {
  id: string;
  name: string;
  scale: number | null;
  do_not_use_again: boolean;
}

export const ALL_BRANDS = "all";
export const ACTIVE_STAGES: readonly string[] = STAGES.map((s) => s.value as string).filter((v) => !TERMINAL_STAGES.includes(v));
/** What the all-brands board opens on: the production stretch. */
export const PRODUCTION_STAGES: readonly string[] = ["product_shipped", "brief_sent", "product_delivered", "shooting", "footage_delivered", "invoice_received"];
/** Stages where shipping and delivery details matter. */
export const DELIVERY_STAGES: readonly string[] = ["product_shipped", "brief_sent", "product_delivered"];

export type StageScope = "production" | "all";

/** One brand: every stage, terminal ones last. All brands: production or all active stages. */
export function boardColumns(brand: string, scope: StageScope): readonly string[] {
  if (brand !== ALL_BRANDS) return STAGES.map((s) => s.value as string);
  return scope === "all" ? ACTIVE_STAGES : PRODUCTION_STAGES;
}

export function creatorName(a: Pick<Assignment, "dashboard_creators">): string {
  return a.dashboard_creators?.name ?? "Unknown creator";
}

export function groupByStage(rows: Assignment[], columns: readonly string[]): Map<string, Assignment[]> {
  const out = new Map<string, Assignment[]>(columns.map((c) => [c, []]));
  for (const r of rows) out.get(r.stage)?.push(r);
  for (const list of out.values()) list.sort((a, b) => creatorName(a).localeCompare(creatorName(b)));
  return out;
}

export function searchAssignments(rows: Assignment[], query: string, brandNames: Map<string, string>): Assignment[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [creatorName(r), brandNames.get(r.client_slug) ?? r.client_slug, stageLabel(r.stage), r.brief_name ?? ""].some((v) => v.toLowerCase().includes(q)),
  );
}

/** Creators that can be added to a brand: not on it already and not marked do-not-use. */
export function addableCreators(creators: CreatorOption[], onBrand: Assignment[], query: string): CreatorOption[] {
  const taken = new Set(onBrand.map((a) => a.creator_id));
  const q = query.trim().toLowerCase();
  return creators.filter((c) => !taken.has(c.id) && !c.do_not_use_again && (!q || c.name.toLowerCase().includes(q)));
}

export function ownerName(users: AppUser[], id: string | null): string {
  if (!id) return "No owner";
  return users.find((u) => u.id === id)?.name ?? "Unknown owner";
}

/** Owners a card can be given: active people, plus the current owner even if deactivated. */
export function ownerOptions(users: AppUser[], currentId: string | null): AppUser[] {
  return users.filter((u) => u.active || u.id === currentId).sort((a, b) => a.name.localeCompare(b.name));
}

/** The staff member's own app_users row, matched by the Verdanote login email. */
export function currentAppUser(users: AppUser[], email: string | null | undefined): AppUser | null {
  if (!email) return null;
  const e = email.toLowerCase();
  return users.find((u) => u.email.toLowerCase() === e) ?? null;
}

// --------------------------------------------------------------- Follow-ups
//
// The old dashboard's chase queue: creator assignments whose next follow-up is
// today or earlier, in a stage that still needs chasing. Same terminal list as
// the old src/lib/followUps.ts.

export const FOLLOW_UP_TERMINAL_STAGES: readonly string[] = ["footage_delivered", "declined", "passed"];

export function isFollowUpTerminal(stage: string): boolean {
  return FOLLOW_UP_TERMINAL_STAGES.includes(stage);
}

const utcDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export function daysOverdue(date: string, today: string): number {
  return Math.round((utcDay(today) - utcDay(date)) / 86_400_000);
}

export function formatOverdue(n: number): string {
  if (n <= 0) return "Due today";
  return `${n} day${n === 1 ? "" : "s"} overdue`;
}

/** today plus 1 or 3 days, as YYYY-MM-DD in UTC. */
export function snoozeDate(today: string, days: 1 | 3): string {
  return todayValue(new Date(utcDay(today) + days * 86_400_000));
}

type FollowUpRow = Pick<Assignment, "stage" | "next_follow_up_at" | "owner_id" | "dashboard_creators">;

export function groupFollowUps<T extends FollowUpRow>(rows: T[], today: string): { overdue: T[]; dueToday: T[]; upcoming: T[] } {
  const live = rows.filter((r) => r.next_follow_up_at && !isFollowUpTerminal(r.stage));
  const byDate = (a: T, b: T) => (a.next_follow_up_at as string).localeCompare(b.next_follow_up_at as string) || creatorName(a).localeCompare(creatorName(b));
  return {
    overdue: live.filter((r) => (r.next_follow_up_at as string) < today).sort(byDate),
    dueToday: live.filter((r) => r.next_follow_up_at === today).sort(byDate),
    upcoming: live.filter((r) => (r.next_follow_up_at as string) > today).sort(byDate),
  };
}

export function filterByOwner<T extends { owner_id: string | null }>(rows: T[], owner: string): T[] {
  return owner === "all" ? rows : rows.filter((r) => r.owner_id === owner);
}

/**
 * Whose follow-ups a person sees. A builder starts on their own and may switch
 * to anyone or all; an employee sees only their own. A login with no matching
 * app_users row cannot be scoped, so it sees all with the picker shown (the
 * old dashboard did the same).
 */
export function ownerScope(me: AppUser | null, isBuilder: boolean, override: string | null): { owner: string; canPick: boolean } {
  if (!me) return { owner: override ?? "all", canPick: true };
  if (!isBuilder) return { owner: me.id, canPick: false };
  return { owner: override ?? me.id, canPick: true };
}
