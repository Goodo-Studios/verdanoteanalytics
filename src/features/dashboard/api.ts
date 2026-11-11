// Reads and writes for the old dashboard pages (step 5a). Every call goes
// through the signed-in user's Supabase session, so the staff-only row rules
// on the dashboard tables (migration 20261101000003) and the checked client
// functions decide what happens. The dashboard tables are not in the
// generated types, hence the small untyped wrapper.
import { supabase } from "@/integrations/supabase/client";
import {
  ALL_BRANDS,
  FOLLOW_UP_TERMINAL_STAGES,
  type ActiveEngagement,
  type AppUser,
  type Assignment,
  type BoardCard,
  type CreatorOption,
  type DashboardClient,
  type Deliverable,
  type DerivedTask,
} from "./model";

export interface DbError {
  code?: string;
  message: string;
}
interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}
type Query<T> = PromiseLike<DbResult<T>> & {
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  or(filters: string): Query<T>;
  not(column: string, op: string, value: unknown): Query<T>;
  lte(column: string, value: unknown): Query<T>;
  gte(column: string, value: unknown): Query<T>;
  order(column: string, opts?: { ascending?: boolean }): Query<T>;
  range(from: number, to: number): Query<T>;
  ilike(column: string, pattern: string): Query<T>;
  maybeSingle(): PromiseLike<DbResult<T extends (infer R)[] ? R : T>>;
  select(columns: string): Query<T>;
};
interface Table {
  select<T = unknown[]>(columns: string): Query<T>;
  update<T = unknown[]>(values: Record<string, unknown>): Query<T>;
  insert<T = unknown[]>(values: Record<string, unknown> | Record<string, unknown>[]): Query<T>;
  delete<T = unknown[]>(): Query<T>;
}
interface Untyped {
  from(table: string): Table;
  rpc<T = unknown>(name: string, args: Record<string, unknown>): PromiseLike<DbResult<T>>;
}
export const db = supabase as unknown as Untyped;

export class DashboardError extends Error {
  code?: string;
  constructor(err: DbError) {
    super(err.message);
    this.code = err.code;
  }
}

export async function unwrap<T>(p: PromiseLike<DbResult<T>>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new DashboardError(error);
  return (data ?? ([] as unknown)) as T;
}

/** For maybeSingle: null when no row matched. */
export async function unwrapOne<T>(p: PromiseLike<DbResult<T>>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new DashboardError(error);
  return data ?? null;
}

export const CLIENT_COLUMNS =
  "slug, name, status, active, does_creators, does_production, origin, service_type, strategist, pct_complete, contract_start, contract_end, last_synced, scope, notes";

export interface OverviewData {
  clients: DashboardClient[];
  cards: BoardCard[];
  engagements: ActiveEngagement[];
}

/** Every client (hidden ones included, the page decides), their Content Pipeline cards and their active cycle. */
export async function loadOverview(): Promise<OverviewData> {
  const [clients, cards, engagements] = await Promise.all([
    unwrap(db.from("clients").select<DashboardClient[]>(CLIENT_COLUMNS).order("name")),
    unwrap(db.from("pipeline_tasks").select<BoardCard[]>("client_slug, stage, due_date")),
    unwrap(db.from("engagements").select<ActiveEngagement[]>("client_slug, cycle_number, start_date, day30_date, day45_date").eq("status", "active")),
  ]);
  return { clients, cards, engagements };
}

// --------------------------------------------------------------- Client Detail

export interface ClientEngagement {
  id: string;
  cycle_number: number;
  engagement_type: string;
  status: string;
  start_date: string | null;
  day30_date: string | null;
  day45_date: string | null;
}
export interface ClientBoardCard {
  task_name: string | null;
  stage: string | null;
  due_date: string | null;
  content_type: string | null;
}
export interface ClientAssignment {
  id: string;
  stage: string;
  next_follow_up_at: string | null;
  dashboard_creators: { name: string } | null;
}
export interface ClientSourceMapping {
  provider: string;
  kind: string;
  external_id: string;
  label: string | null;
}
export interface ClientDetailData {
  client: DashboardClient | null;
  deliverables: Deliverable[];
  adAccounts: { account_id: string; ad_accounts: { name: string | null } | null }[];
  engagements: ClientEngagement[];
  cards: ClientBoardCard[];
  assignments: ClientAssignment[];
  mappings: ClientSourceMapping[];
  /** ClickUp work, for the delivery numbers Verdanote derives itself. */
  tasks: DerivedTask[];
  deliveredTasks: DerivedTask[];
}

/** Everything the client page shows, all keyed by clients.slug. */
export async function loadClientDetail(slug: string): Promise<ClientDetailData> {
  const [client, deliverables, adAccounts, engagements, cards, assignments, mappings, tasks, deliveredTasks] = await Promise.all([
    unwrapOne(db.from("clients").select<DashboardClient[]>(CLIENT_COLUMNS).eq("slug", slug).maybeSingle()),
    unwrap(db.from("deliverables").select<Deliverable[]>("id, month, type, status").eq("client_slug", slug).order("month", { ascending: false })),
    unwrap(db.from("client_ad_accounts").select<ClientDetailData["adAccounts"]>("account_id, ad_accounts(name)").eq("client_slug", slug).order("account_id")),
    unwrap(db.from("engagements").select<ClientEngagement[]>("id, cycle_number, engagement_type, status, start_date, day30_date, day45_date").eq("client_slug", slug).order("cycle_number", { ascending: false })),
    unwrap(db.from("pipeline_tasks").select<ClientBoardCard[]>("task_name, stage, due_date, content_type").eq("client_slug", slug).order("due_date")),
    unwrap(db.from("creator_assignments").select<ClientAssignment[]>("id, stage, next_follow_up_at, dashboard_creators(name)").eq("client_slug", slug)),
    unwrap(db.from("source_mappings").select<ClientSourceMapping[]>("provider, kind, external_id, label").eq("client_slug", slug).eq("active", true).order("provider")),
    unwrap(db.from("pipeline_tasks").select<DerivedTask[]>("stage, cycle_month, due_date, delivered_at").eq("client_slug", slug)),
    unwrap(db.from("pipeline_delivered").select<DerivedTask[]>("cycle_month, delivered_at").eq("client_slug", slug)),
  ]);
  return { client, deliverables, adAccounts, engagements, cards, assignments, mappings, tasks, deliveredTasks };
}

export interface ClientDetailsPatch {
  service_type: string | null;
  strategist: string | null;
  contract_start: string | null;
  contract_end: string | null;
  status: string | null;
}

/** Builder only, manual clients only (set_client_details checks both). */
export function saveClientDetails(slug: string, patch: ClientDetailsPatch) {
  return unwrap(db.rpc("set_client_details", {
    p_slug: slug, p_service_type: patch.service_type, p_strategist: patch.strategist,
    p_contract_start: patch.contract_start, p_contract_end: patch.contract_end, p_status: patch.status,
  }));
}

/** Builder only, any client. */
export function saveClientScope(slug: string, scope: string | null) {
  return unwrap(db.rpc("set_client_scope", { p_slug: slug, p_scope: scope }));
}

/** Builder only: whether the client shows on the Client overview. */
export function saveClientActive(slug: string, active: boolean) {
  return unwrap(db.rpc("set_client_active", { p_slug: slug, p_active: active }));
}

// --------------------------------------------------------------- Creator pipeline and Follow-ups

export const ASSIGNMENT_COLUMNS =
  "id, creator_id, client_slug, stage, owner_id, next_follow_up_at, next_follow_up_source, tracking_number, product_delivered_at, delivery_notes, brief_name, notes, dashboard_creators(name, scale, do_not_use_again)";

export interface BrandOption {
  slug: string;
  name: string;
  active: boolean;
  does_creators: boolean;
  /** Production clients (casting, shoots). Optional so older callers and mocks stay valid. */
  does_production?: boolean;
}

export async function loadBrandsAndTeam(): Promise<{ brands: BrandOption[]; users: AppUser[] }> {
  const [brands, users] = await Promise.all([
    unwrap(db.from("clients").select<BrandOption[]>("slug, name, active, does_creators, does_production").order("name")),
    unwrap(db.from("app_users").select<AppUser[]>("id, name, email, role, active").order("name")),
  ]);
  return { brands, users };
}

/** One brand's assignments, or every brand's with ALL_BRANDS. */
export function loadAssignments(brand: string): Promise<Assignment[]> {
  const q = db.from("creator_assignments").select<Assignment[]>(ASSIGNMENT_COLUMNS);
  return unwrap(brand === ALL_BRANDS ? q : q.eq("client_slug", brand));
}

export function loadCreatorOptions(): Promise<CreatorOption[]> {
  return unwrap(db.from("dashboard_creators").select<CreatorOption[]>("id, name, scale, do_not_use_again").order("name"));
}

export interface AssignmentPatch {
  stage?: string;
  owner_id?: string | null;
  next_follow_up_at?: string | null;
}

/**
 * creator_assignments has no updated_at trigger, so every write sets it. The
 * select turns a write that matched no row (deleted, or refused by the row
 * rules) into an error instead of a silent success. Moving the stage lets the
 * database stage rule set the next follow-up.
 */
export async function updateAssignment(id: string, patch: AssignmentPatch): Promise<void> {
  const row = await unwrapOne(
    db.from("creator_assignments").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle(),
  );
  if (!row) throw new DashboardError({ message: "That creator row no longer exists or cannot be changed." });
}

export async function addCreatorsToBrand(slug: string, creatorIds: string[]): Promise<void> {
  if (!creatorIds.length) return;
  await unwrap(db.from("creator_assignments").insert(creatorIds.map((creator_id) => ({ creator_id, client_slug: slug, stage: "sourced" }))).select("id"));
}

export async function removeAssignment(id: string): Promise<void> {
  const rows = await unwrap(db.from("creator_assignments").delete<{ id: string }[]>().eq("id", id).select("id"));
  if (!rows.length) throw new DashboardError({ message: "That creator row no longer exists or cannot be removed." });
}

/** Every assignment with a follow-up date in a stage that still needs chasing. */
export function loadFollowUps(): Promise<Assignment[]> {
  return unwrap(
    db.from("creator_assignments").select<Assignment[]>(ASSIGNMENT_COLUMNS)
      .not("next_follow_up_at", "is", null)
      .not("stage", "in", `(${FOLLOW_UP_TERMINAL_STAGES.join(",")})`)
      .order("next_follow_up_at"),
  );
}

/**
 * Staff only (set_creator_assignment_delivery checks the role). The function
 * replaces tracking, delivered date and delivery notes together, so the
 * current notes are always sent; leaving them out would wipe them.
 */
export function saveDelivery(id: string, tracking: string | null, deliveredAt: string | null, notes: string | null) {
  return unwrap(db.rpc("set_creator_assignment_delivery", { p_assignment_id: id, p_tracking_number: tracking, p_product_delivered_at: deliveredAt, p_delivery_notes: notes }));
}
