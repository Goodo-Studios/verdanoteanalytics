// Shared database and ClickUp steps of the OS-007 copy (clickup-os-sync and clickup-webhook).
//
// ClickUp is only ever read: the reader below sends GET and nothing else. Writes go to os_tasks,
// os_task_statuses (new statuses only), os_task_comments, os_sync_runs and
// os_sync_discrepancies, with the service role. No login, role or member row is touched; people
// are matched to logins through os_user_ids_by_email.

import {
  CLICKUP_CLIENT_SPACE_ID,
  type ClientRow,
  resolveClientSlug,
} from "./clickup-pipeline.ts";
import { ENDING_CLIENT_FOLDER_IDS, type MappedTask, normaliseStatus, type OsTaskRow } from "./os-task-map.ts";

export const CLICKUP_API = "https://api.clickup.com/api/v2";
export const UPSERT_CHUNK = 500;
const READ_PAGE = 1000;

// ------------------------------------------------------------------ the small Supabase surface

export interface DbResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
  count?: number | null;
}
export interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  in(column: string, values: unknown[]): DbQuery;
  not(column: string, operator: string, value: unknown): DbQuery;
  lt(column: string, value: string): DbQuery;
  order(column: string, options?: { ascending?: boolean }): DbQuery;
  limit(n: number): DbQuery;
  range(from: number, to: number): DbQuery;
  upsert(rows: unknown[], options: { onConflict: string; ignoreDuplicates?: boolean }): DbQuery;
  insert(rows: unknown[] | Record<string, unknown>): DbQuery;
  update(values: Record<string, unknown>): DbQuery;
  delete(options?: { count: "exact" }): DbQuery;
}
export interface SupabaseLike {
  from(table: string): DbQuery;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ------------------------------------------------------------------ ClickUp, GET only

export class ClickUpNotFound extends Error {}

export interface ClickUpReader {
  get(path: string): Promise<Record<string, unknown>>;
}

export function clickupReader(token: string, fetchFn: FetchLike): ClickUpReader {
  return {
    async get(path: string) {
      const res = await fetchFn(`${CLICKUP_API}${path}`, {
        method: "GET",
        headers: { Authorization: token, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        await res.body?.cancel();
        const where = path.split("?")[0];
        if (res.status === 404) throw new ClickUpNotFound(`ClickUp 404 for ${where}`);
        throw new Error(`ClickUp API error [${res.status}] for ${where}`);
      }
      return await res.json();
    },
  };
}

// ------------------------------------------------------------------ reads

async function must(query: PromiseLike<DbResult>, what: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return data ?? [];
}

export interface ClientContext {
  active: ClientRow[];
  all: ClientRow[];
  mappings: Record<string, string>;
}

/** Clients, their ad account names and the staff-set folder mappings, as the board sync reads them. */
export async function loadClientContext(db: SupabaseLike): Promise<ClientContext> {
  const clientRows = await must(db.from("clients").select("slug, name, active"), "clients read");
  const links = await must(db.from("client_ad_accounts").select("account_id, client_slug"), "client_ad_accounts read");
  const accounts = await must(db.from("ad_accounts").select("id, name").eq("is_active", true), "ad_accounts read");
  const maps = await must(
    db.from("source_mappings").select("external_id, client_slug").eq("provider", "clickup").eq("kind", "folder").eq("active", true),
    "source_mappings read",
  );
  const accountName = new Map(accounts.map((a) => [String(a.id), String(a.name)]));
  const bySlug = new Map<string, ClientRow & { active: boolean }>();
  for (const c of clientRows) {
    bySlug.set(String(c.slug), {
      slug: String(c.slug),
      name: String(c.name ?? ""),
      accountIds: [],
      accountNames: [],
      active: c.active !== false,
    });
  }
  for (const l of links) {
    const c = bySlug.get(String(l.client_slug));
    if (!c) continue;
    c.accountIds.push(String(l.account_id));
    const n = accountName.get(String(l.account_id));
    if (n) c.accountNames.push(n);
  }
  const mappings: Record<string, string> = {};
  for (const m of maps) mappings[String(m.external_id)] = String(m.client_slug);
  const all = [...bySlug.values()];
  return { all, active: all.filter((c) => c.active), mappings };
}

export type FolderOwner =
  | { kind: "owner"; clientSlug: string | null; readOnly: boolean }
  | { kind: "skip"; reason: "unmatched" | "ambiguous" | "stale_mapping" };

/**
 * Who owns the tasks of a folder.
 *   Production Team and Social Media Plan: nobody (internal tasks, client_slug null).
 *   Client Operations, ending client: read-only history; the client when it resolves among all
 *     clients (active or not), else no client.
 *   Client Operations, other folders: the active client it resolves to, as the board sync does;
 *     a folder that does not resolve to exactly one client is skipped and reported.
 *   A list with no folder: no client.
 */
export function folderOwner(
  spaceId: string,
  folder: { id: string; name: string } | null,
  ctx: ClientContext,
): FolderOwner {
  if (spaceId !== CLICKUP_CLIENT_SPACE_ID || !folder) return { kind: "owner", clientSlug: null, readOnly: false };
  if (ENDING_CLIENT_FOLDER_IDS.has(folder.id)) {
    const r = resolveClientSlug(folder, ctx.all, ctx.mappings);
    return { kind: "owner", clientSlug: r.kind === "client" ? r.slug : null, readOnly: true };
  }
  const r = resolveClientSlug(folder, ctx.active, ctx.mappings);
  if (r.kind === "client") return { kind: "owner", clientSlug: r.slug, readOnly: false };
  return { kind: "skip", reason: r.reason };
}

export const EXISTING_COLUMNS =
  "id, clickup_task_id, title, client_slug, status, raw_status, is_stuck, due_date, content_type, brief_type, asset_url, hooks, qa_checklist, description, clickup_list_id, brief_due_date, cut_to_strategist_date, cut_to_client_date, edit_due_date, production_date, brief_handed_off_date, read_only";

/** Every app row that came from ClickUp, keyed by ClickUp id, read in pages. */
export async function loadExistingTasks(db: SupabaseLike): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += READ_PAGE) {
    const rows = await must(
      db.from("os_tasks").select(EXISTING_COLUMNS).not("clickup_task_id", "is", null).order("clickup_task_id").range(from, from + READ_PAGE - 1),
      "os_tasks read",
    );
    for (const r of rows) out.set(String(r.clickup_task_id), r);
    if (rows.length < READ_PAGE) break;
  }
  return out;
}

export async function loadExistingTask(db: SupabaseLike, clickupId: string): Promise<Record<string, unknown> | null> {
  const rows = await must(db.from("os_tasks").select(EXISTING_COLUMNS).eq("clickup_task_id", clickupId).limit(1), "os_tasks read");
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ writes

/** Adds every status not yet in os_task_statuses, stage Other, after the rest. Returns the added ones. */
export async function ensureStatuses(db: SupabaseLike, statuses: Iterable<string>): Promise<string[]> {
  const wanted = new Set<string>();
  for (const s of statuses) {
    const k = normaliseStatus(s);
    if (k) wanted.add(k);
  }
  if (wanted.size === 0) return [];
  const known = await must(db.from("os_task_statuses").select("status, position"), "os_task_statuses read");
  const have = new Set(known.map((k) => String(k.status)));
  let position = known.reduce((m, k) => Math.max(m, Number(k.position) || 0), 0);
  const add = [...wanted].filter((s) => !have.has(s)).sort();
  if (add.length === 0) return [];
  const rows = add.map((status) => ({ status, position: (position += 10), stage: "Other" }));
  const { error } = await db.from("os_task_statuses").upsert(rows, { onConflict: "status", ignoreDuplicates: true });
  if (error) throw new Error(`os_task_statuses insert failed: ${error.message}`);
  return add;
}

/** ClickUp email -> login id, through the service-role-only os_user_ids_by_email. */
export async function resolvePeople(db: SupabaseLike, emails: Iterable<string | null>): Promise<Map<string, string>> {
  const list = [...new Set([...emails].filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  const { data, error } = await db.rpc("os_user_ids_by_email", { p_emails: list });
  if (error) throw new Error(`os_user_ids_by_email failed: ${error.message}`);
  for (const r of data ?? []) out.set(String(r.email).toLowerCase(), String(r.user_id));
  return out;
}

export type OsTaskWrite = OsTaskRow & { strategist_id: string | null; producer_id: string | null; editor_id: string | null };

export function withPeople(m: MappedTask, people: Map<string, string>): OsTaskWrite {
  const id = (email: string | null) => (email ? people.get(email) ?? null : null);
  return {
    ...m.row,
    strategist_id: id(m.people.strategist),
    producer_id: id(m.people.producer),
    editor_id: id(m.people.editor),
  };
}

/** Upserts by clickup_task_id in chunks. Returns ClickUp id -> app id, and whether any chunk failed. */
export async function upsertTasks(
  db: SupabaseLike,
  rows: OsTaskWrite[],
): Promise<{ ids: Map<string, string>; upserted: number; failed: boolean }> {
  const ids = new Map<string, string>();
  let upserted = 0;
  let failed = false;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await db.from("os_tasks").upsert(chunk, { onConflict: "clickup_task_id" }).select("id, clickup_task_id");
    if (error) {
      failed = true;
      console.error(`os_tasks upsert failed for rows ${i}-${i + chunk.length}: ${error.message}`);
      continue;
    }
    upserted += chunk.length;
    for (const r of data ?? []) ids.set(String(r.clickup_task_id), String(r.id));
  }
  return { ids, upserted, failed };
}

export interface CommentRow {
  task_id: string;
  clickup_comment_id: string;
  /** OS-008: ClickUp comments always land in the staff-only internal thread. */
  thread: "internal";
  author: Record<string, unknown>;
  body: string;
  created_at: string | null;
  synced_at: string;
}

/** GET a task's comments and shape them for os_task_comments. */
export async function fetchComments(
  reader: ClickUpReader,
  clickupId: string,
  appId: string,
  nowIso: string,
): Promise<CommentRow[]> {
  const data = await reader.get(`/task/${encodeURIComponent(clickupId)}/comment`);
  const comments = (data.comments as Record<string, unknown>[] | undefined) ?? [];
  return comments
    .filter((c) => c && c.id !== undefined && c.id !== null)
    .map((c) => {
      const user = (c.user as Record<string, unknown> | undefined) ?? {};
      const date = Number(c.date);
      return {
        task_id: appId,
        clickup_comment_id: String(c.id),
        thread: "internal",
        author: {
          id: user.id === undefined || user.id === null ? null : String(user.id),
          username: (user.username as string | undefined) ?? null,
          email: typeof user.email === "string" ? user.email.toLowerCase() : null,
        },
        body: typeof c.comment_text === "string" ? c.comment_text : "",
        created_at: Number.isFinite(date) && date > 0 ? new Date(date).toISOString() : null,
        synced_at: nowIso,
      };
    });
}

export async function upsertComments(db: SupabaseLike, rows: CommentRow[]): Promise<{ written: number; failed: boolean }> {
  let written = 0;
  let failed = false;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    let chunk = rows.slice(i, i + UPSERT_CHUNK);
    // OS-017: comments the app wrote to ClickUp are already in the app; never import them again.
    const { data: own, error: ownError } = await db.from("os_clickup_outbox").select("clickup_ref")
      .in("clickup_ref", chunk.map((c) => c.clickup_comment_id));
    if (ownError) console.error(`os_clickup_outbox read failed: ${ownError.message}`);
    const ownIds = new Set((own ?? []).map((r) => String(r.clickup_ref)));
    chunk = chunk.filter((c) => !ownIds.has(c.clickup_comment_id));
    if (chunk.length === 0) continue;
    const { error } = await db.from("os_task_comments").upsert(chunk, { onConflict: "clickup_comment_id" });
    if (error) {
      failed = true;
      console.error(`os_task_comments upsert failed: ${error.message}`);
    } else {
      written += chunk.length;
    }
  }
  return { written, failed };
}

// ------------------------------------------------------------------ run record

export async function startRun(db: SupabaseLike, kind: "full" | "nightly" | "webhook", startedAt: string): Promise<string | null> {
  const { data, error } = await db.from("os_sync_runs").insert({ kind, started_at: startedAt }).select("id");
  if (error) {
    console.error(`os_sync_runs insert failed: ${error.message}`);
    return null;
  }
  return data?.[0]?.id ? String(data[0].id) : null;
}

export async function finishRun(
  db: SupabaseLike,
  runId: string | null,
  result: { ok: boolean; counts: Record<string, unknown>; discrepancyCount?: number; error?: string | null },
): Promise<void> {
  if (!runId) return;
  const { error } = await db
    .from("os_sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      ok: result.ok,
      counts: result.counts,
      discrepancy_count: result.discrepancyCount ?? 0,
      error: result.error ?? null,
    })
    .eq("id", runId);
  if (error) console.error(`os_sync_runs update failed: ${error.message}`);
}
