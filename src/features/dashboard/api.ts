// Reads and writes for the old dashboard pages (step 5a). Every call goes
// through the signed-in user's Supabase session, so the staff-only row rules
// on the dashboard tables (migration 20261101000003) and the checked client
// functions decide what happens. The dashboard tables are not in the
// generated types, hence the small untyped wrapper.
import { supabase } from "@/integrations/supabase/client";
import type { ActiveEngagement, BoardCard, DashboardClient } from "./model";

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
