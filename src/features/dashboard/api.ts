// Reads and writes for the old dashboard pages (step 5a). Every call goes
// through the signed-in user's Supabase session, so the staff-only row rules
// on the dashboard tables (migration 20261101000003) and the checked client
// functions decide what happens. The dashboard tables are not in the
// generated types, hence the small untyped wrapper.
import { supabase } from "@/integrations/supabase/client";
import type { ActiveEngagement, BoardCard, DashboardClient, Deliverable } from "./model";

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
  not(column: string, op: string, value: unknown): Query<T>;
  lte(column: string, value: unknown): Query<T>;
  order(column: string, opts?: { ascending?: boolean }): Query<T>;
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

/** Active clients, their Content Pipeline cards and their active cycle. */
export async function loadOverview(): Promise<OverviewData> {
  const [clients, cards, engagements] = await Promise.all([
    unwrap(db.from("clients").select<DashboardClient[]>(CLIENT_COLUMNS).eq("active", true).order("name")),
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
}

/** Everything the client page shows, all keyed by clients.slug. */
export async function loadClientDetail(slug: string): Promise<ClientDetailData> {
  const [client, deliverables, adAccounts, engagements, cards, assignments, mappings] = await Promise.all([
    unwrapOne(db.from("clients").select<DashboardClient[]>(CLIENT_COLUMNS).eq("slug", slug).maybeSingle()),
    unwrap(db.from("deliverables").select<Deliverable[]>("id, month, type, status").eq("client_slug", slug).order("month", { ascending: false })),
    unwrap(db.from("client_ad_accounts").select<ClientDetailData["adAccounts"]>("account_id, ad_accounts(name)").eq("client_slug", slug).order("account_id")),
    unwrap(db.from("engagements").select<ClientEngagement[]>("id, cycle_number, engagement_type, status, start_date, day30_date, day45_date").eq("client_slug", slug).order("cycle_number", { ascending: false })),
    unwrap(db.from("pipeline_tasks").select<ClientBoardCard[]>("task_name, stage, due_date, content_type").eq("client_slug", slug).order("due_date")),
    unwrap(db.from("creator_assignments").select<ClientAssignment[]>("id, stage, next_follow_up_at, dashboard_creators(name)").eq("client_slug", slug)),
    unwrap(db.from("source_mappings").select<ClientSourceMapping[]>("provider, kind, external_id, label").eq("client_slug", slug).eq("active", true).order("provider")),
  ]);
  return { client, deliverables, adAccounts, engagements, cards, assignments, mappings };
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
