// Goodo OS story OS-017: write app changes back to ClickUp.
//
// The database queues changes in os_clickup_outbox (migration 20261130080001). runWriteback sends
// the due rows, used by the clickup-writeback function every minute in production.
//
// OFF BY DEFAULT. A row is written only when all of these hold; otherwise it is marked held and
// ClickUp is not called at all:
//   * CLICKUP_WRITEBACK_ENABLED is "true";
//   * the task's ClickUp list id is in CLICKUP_WRITEBACK_LIST_IDS (comma separated, empty by default);
//   * clickup-write-guard.ts allows the list (on staging that also needs CLICKUP_WRITE_ALLOWED_LIST_IDS).
//
// What is written:
//   status      PUT /task/{id} {status}. The app status is the lower-cased ClickUp status name.
//   due_date    PUT /task/{id} {due_date, due_date_time: false}, noon UTC of the app date, or null.
//   assignees   the Strategist, Producer or Editor people field: POST /task/{id}/field/{field}
//               {value: {add, rem}}. Logins are matched to ClickUp members by email (GET /team).
//   comment     POST /task/{id}/comment, with the author and thread named in the text. ClickUp has
//               one comment stream, which only staff see, so client-thread comments are labelled
//               as such.
//   decision    a comment saying who approved or asked for changes, with the note. The ClickUp
//               status is not moved: staff move it in the app, which queues its own status row.
//
// Clashes (status, due date and people fields only; comments and decisions only add):
//   The ClickUp value already equals the app's new value: nothing to write, marked sent.
//   ClickUp's value differs from the value the app changed from, so both places changed it:
//     ClickUp's date_updated is later than the app change (and is not our own earlier write):
//       ClickUp wins. Nothing is written, the app row takes ClickUp's value, state clash.
//     Otherwise the app change is later: it is written, state sent.
//   Both cases are logged in os_clickup_clashes with both values and times.
//
// Retries: a failed write waits 1, 5, 15 and 60 minutes, then the row is failed. A 429 waits for
// ClickUp's reset time (or a minute), does not count as an attempt, and stops the run.
//
// Echo: after each write the row keeps ClickUp's date_updated (clickup_updated_at) and, for
// comments, the ClickUp comment id (clickup_ref). The webhook ignores a task event no newer than
// our last write, and the sync never imports our own comments.

import { type ClickUpWritePolicy, clickUpWritePolicy, type Env, mayWriteToList } from "./clickup-write-guard.ts";
import { CLICKUP_TEAM_ID, type CuTask, FIELDS, findField, msToDate, msToIso, normaliseStatus, usersField } from "./os-task-map.ts";
import { CLICKUP_API, type FetchLike, type OsTaskWrite, resolvePeople, type SupabaseLike } from "./os-clickup-sync.ts";

export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const BATCH_SIZE = 50;
export const ECHO_WINDOW_MS = 10 * 60_000;
export const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export const HELD_OFF = "held: write-back is off (CLICKUP_WRITEBACK_ENABLED is not true)";
export const HELD_LIST = "held: this ClickUp list is not in CLICKUP_WRITEBACK_LIST_IDS";
export const HELD_GUARD = "held: ClickUp writes are blocked in this environment for this list";

export type Kind = "status" | "assignees" | "due_date" | "comment" | "decision";
export type Role = "strategist" | "producer" | "editor";

export interface OutboxRow {
  id: number;
  task_id: string | null;
  clickup_task_id: string;
  clickup_list_id: string | null;
  kind: Kind;
  field: string;
  payload: Record<string, unknown>;
  app_changed_at: string;
  state: string;
  attempts: number;
  clickup_ref?: string | null;
}

// ------------------------------------------------------------------ config

export interface WritebackConfig {
  enabled: boolean;
  listIds: ReadonlySet<string>;
  guard: ClickUpWritePolicy;
  token: string | null;
}

export function writebackConfig(env: Env): WritebackConfig {
  const enabled = (env("CLICKUP_WRITEBACK_ENABLED") ?? "").trim().toLowerCase() === "true";
  const listIds = new Set(
    (env("CLICKUP_WRITEBACK_LIST_IDS") ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)),
  );
  return { enabled, listIds, guard: clickUpWritePolicy(env), token: env("CLICKUP_API_TOKEN") || null };
}

/** Why a row for this list must not be written, or null when it may be. */
export function holdReason(cfg: WritebackConfig, listId: string | null | undefined): string | null {
  if (!cfg.enabled) return HELD_OFF;
  if (!listId || !cfg.listIds.has(String(listId))) return HELD_LIST;
  if (!mayWriteToList(cfg.guard, listId)) return HELD_GUARD;
  return null;
}

// ------------------------------------------------------------------ retries and clashes

/** After a failed attempt (attempts counts it): wait and retry, or give up. */
export function afterFailure(attempts: number, nowMs: number): { state: "queued"; nextAttemptAt: string } | { state: "failed" } {
  if (attempts >= MAX_ATTEMPTS) return { state: "failed" };
  const wait = RETRY_DELAYS_MS[Math.max(0, attempts - 1)];
  return { state: "queued", nextAttemptAt: new Date(nowMs + wait).toISOString() };
}

export type ConflictDecision =
  | { action: "noop" }
  | { action: "write"; clash: boolean }
  | { action: "clash" };

/**
 * Field kinds only. `from`/`to` are the app's old and new values, `current` is ClickUp's value now.
 * Times are ms; lastOwnWriteMs is ClickUp's date_updated after our latest write to this task.
 */
export function decideConflict(input: {
  from: string | null;
  to: string | null;
  current: string | null;
  appChangedMs: number;
  clickupChangedMs: number | null;
  lastOwnWriteMs: number | null;
}): ConflictDecision {
  const { from, to, current, appChangedMs, clickupChangedMs, lastOwnWriteMs } = input;
  if (current === to) return { action: "noop" };
  if (current === from) return { action: "write", clash: false };
  const clickupLater = clickupChangedMs !== null && clickupChangedMs > appChangedMs &&
    (lastOwnWriteMs === null || clickupChangedMs > lastOwnWriteMs);
  return clickupLater ? { action: "clash" } : { action: "write", clash: true };
}

// ------------------------------------------------------------------ ClickUp client (writes)

export class ClickUpRateLimited extends Error {
  constructor(public retryAtMs: number) {
    super("ClickUp rate limit (429)");
  }
}
export class ClickUpHttpError extends Error {
  constructor(public status: number, where: string) {
    super(`ClickUp API error [${status}] for ${where}`);
  }
}

export interface ClickUpClient {
  request(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>>;
}

export function clickupClient(token: string, fetchFn: FetchLike, nowMs: () => number = Date.now): ClickUpClient {
  return {
    async request(method, path, body) {
      const res = await fetchFn(`${CLICKUP_API}${path}`, {
        method,
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const where = `${method} ${path.split("?")[0]}`;
      if (res.status === 429) {
        await res.body?.cancel();
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const after = Number(res.headers.get("retry-after"));
        const at = Number.isFinite(reset) && reset > 0
          ? reset * 1000
          : Number.isFinite(after) && after > 0
          ? nowMs() + after * 1000
          : nowMs() + DEFAULT_RATE_LIMIT_WAIT_MS;
        throw new ClickUpRateLimited(at);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new ClickUpHttpError(res.status, where);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    },
  };
}

// ------------------------------------------------------------------ texts

export function commentText(row: OutboxRow): string {
  const p = row.payload ?? {};
  const author = String(p.author ?? "Someone");
  if (row.kind === "decision") {
    if (p.decision === "approved") return `Client decision in Goodo OS: approved by ${author}.`;
    return `Client decision in Goodo OS: changes requested by ${author}.\nNote: ${String(p.note ?? "")}`;
  }
  const where = p.thread === "client" ? "client thread, the client sees this in Goodo OS" : "internal thread";
  return `${author} commented in Goodo OS (${where}):\n${String(p.body ?? "")}`;
}

/** Noon UTC of a YYYY-MM-DD date, so the date reads back the same in every US time zone. */
export function dateToMs(date: string | null): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

// ------------------------------------------------------------------ helpers

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
};

async function update(db: SupabaseLike, id: number, values: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("os_clickup_outbox").update(values).eq("id", id).eq("state", "queued");
  if (error) throw new Error(`os_clickup_outbox update failed: ${error.message}`);
}

/** ClickUp's date_updated after our latest sent write to this task, in ms. */
export async function lastOwnWrite(db: SupabaseLike, clickupTaskId: string): Promise<number | null> {
  const { data, error } = await db.from("os_clickup_outbox").select("clickup_updated_at, sent_at")
    .eq("clickup_task_id", clickupTaskId).eq("state", "sent");
  if (error) throw new Error(`os_clickup_outbox read failed: ${error.message}`);
  let max: number | null = null;
  for (const r of data ?? []) {
    const t = ms(str(r.clickup_updated_at));
    if (t !== null && (max === null || t > max)) max = t;
  }
  return max;
}

/**
 * True when a ClickUp event for this task is the echo of our own write: a row was sent in the
 * last ECHO_WINDOW_MS and ClickUp has not changed the task since (date_updated not newer).
 */
export async function isEchoOfOwnWrite(
  db: SupabaseLike,
  clickupTaskId: string,
  clickupUpdated: unknown,
  nowMs: number,
): Promise<boolean> {
  const updated = ms(msToIso(clickupUpdated));
  if (updated === null) return false;
  const { data, error } = await db.from("os_clickup_outbox").select("clickup_updated_at, sent_at")
    .eq("clickup_task_id", clickupTaskId).eq("state", "sent");
  if (error) {
    console.error(`os_clickup_outbox read failed: ${error.message}`);
    return false;
  }
  return (data ?? []).some((r) => {
    const own = ms(str(r.clickup_updated_at));
    const sent = ms(str(r.sent_at));
    return own !== null && sent !== null && nowMs - sent <= ECHO_WINDOW_MS && updated <= own;
  });
}

/**
 * The webhook keeps the app's value for a field that still has a change waiting to be sent, so a
 * ClickUp event cannot undo it first. The writer then compares both sides and logs any clash.
 */
export async function keepPendingAppValues(db: SupabaseLike, row: OsTaskWrite): Promise<OsTaskWrite> {
  const { data: pending, error } = await db.from("os_clickup_outbox").select("field")
    .eq("clickup_task_id", row.clickup_task_id).eq("state", "queued");
  if (error || !pending || pending.length === 0) return row;
  const fields = new Set(pending.map((p) => String(p.field)));
  const { data: app } = await db.from("os_tasks").select("status, due_date, strategist_id, producer_id, editor_id")
    .eq("clickup_task_id", row.clickup_task_id).limit(1);
  const cur = app?.[0];
  if (!cur) return row;
  const out = { ...row } as OsTaskWrite & Record<string, unknown>;
  if (fields.has("status")) out.status = String(cur.status);
  if (fields.has("due_date")) out.due_date = str(cur.due_date);
  for (const role of ["strategist", "producer", "editor"] as const) {
    if (fields.has(role)) out[`${role}_id`] = str(cur[`${role}_id`]);
  }
  return out;
}

// ------------------------------------------------------------------ one row

interface RunContext {
  db: SupabaseLike;
  cu: ClickUpClient;
  nowMs: number;
  members: Map<string, string> | null;
  ownWrites: Map<string, number | null>;
}

async function teamMembers(ctx: RunContext): Promise<Map<string, string>> {
  if (ctx.members) return ctx.members;
  const team = await ctx.cu.request("GET", `/team`);
  const out = new Map<string, string>();
  for (const t of (team.teams as Record<string, unknown>[] | undefined) ?? []) {
    if (String(t.id) !== CLICKUP_TEAM_ID) continue;
    for (const m of (t.members as Record<string, unknown>[] | undefined) ?? []) {
      const u = (m.user as Record<string, unknown> | undefined) ?? {};
      if (typeof u.email === "string" && u.id !== undefined && u.id !== null) out.set(u.email.toLowerCase(), String(u.id));
    }
  }
  ctx.members = out;
  return out;
}

async function emailsOf(db: SupabaseLike, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((i): i is string => !!i))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  const { data, error } = await db.rpc("os_user_emails_by_id", { p_ids: list });
  if (error) throw new Error(`os_user_emails_by_id failed: ${error.message}`);
  for (const r of data ?? []) out.set(String(r.user_id), String(r.email).toLowerCase());
  return out;
}

class Permanent extends Error {}

type Outcome = "sent" | "clash" | "noop";

async function logClash(ctx: RunContext, row: OutboxRow, appValue: string | null, clickupValue: string | null, winner: "app" | "clickup", clickupChangedMs: number | null) {
  const { error } = await ctx.db.from("os_clickup_clashes").insert({
    outbox_id: row.id,
    task_id: row.task_id,
    clickup_task_id: row.clickup_task_id,
    kind: row.kind,
    field: row.field,
    app_value: appValue,
    clickup_value: clickupValue,
    winner,
    app_changed_at: row.app_changed_at,
    clickup_changed_at: clickupChangedMs === null ? null : new Date(clickupChangedMs).toISOString(),
  });
  if (error) console.error(`os_clickup_clashes insert failed: ${error.message}`);
}

/** ClickUp won a clash: the app row takes ClickUp's value (service role, so nothing is queued). */
async function applyClickUpValue(ctx: RunContext, row: OutboxRow, current: string | null) {
  if (!row.task_id) return;
  const values: Record<string, unknown> = {};
  if (row.kind === "status") {
    if (!current || current === "stuck") return;
    const { data } = await ctx.db.from("os_task_statuses").select("status").eq("status", current).limit(1);
    if (!data || data.length === 0) return; // an unknown status arrives with the next sync
    values.status = current;
  } else if (row.kind === "due_date") {
    values.due_date = current;
  } else {
    const people = await resolvePeople(ctx.db, [current]);
    values[`${row.field}_id`] = current ? people.get(current) ?? null : null;
  }
  const { error } = await ctx.db.from("os_tasks").update(values).eq("id", row.task_id);
  if (error) console.error(`os_tasks update after clash failed: ${error.message}`);
}

async function sendRow(ctx: RunContext, row: OutboxRow): Promise<{ outcome: Outcome; clickupUpdatedMs: number | null; ref: string | null }> {
  const id = encodeURIComponent(row.clickup_task_id);

  if (row.kind === "comment" || row.kind === "decision") {
    if (row.clickup_ref) return { outcome: "noop", clickupUpdatedMs: null, ref: row.clickup_ref };
    const res = await ctx.cu.request("POST", `/task/${id}/comment`, { comment_text: commentText(row), notify_all: false });
    const after = await ctx.cu.request("GET", `/task/${id}`);
    return { outcome: "sent", clickupUpdatedMs: ms(msToIso((after as unknown as CuTask).date_updated)), ref: str(res.id) };
  }

  let task: CuTask;
  try {
    task = (await ctx.cu.request("GET", `/task/${id}`)) as unknown as CuTask;
  } catch (err) {
    if (err instanceof ClickUpHttpError && err.status === 404) throw new Permanent("the task is not in ClickUp any more");
    throw err;
  }

  const p = row.payload ?? {};
  let from = str(p.from);
  let to = str(p.to);
  let current: string | null;
  let fieldId: string | null = null;
  let currentIds: string[] = [];
  if (row.kind === "status") {
    from = normaliseStatus(from);
    to = normaliseStatus(to);
    current = normaliseStatus(task.status?.status);
  } else if (row.kind === "due_date") {
    current = msToDate(task.due_date);
  } else {
    const ref = FIELDS[row.field as Role];
    if (!ref) throw new Permanent(`unknown people field ${row.field}`);
    fieldId = ref.id;
    const users = usersField(findField(task.custom_fields, ref));
    currentIds = users.map((u) => u.id);
    current = users[0]?.email ?? null;
    const emails = await emailsOf(ctx.db, [from, to]);
    if (to && !emails.has(to)) throw new Permanent("the new person has no email address");
    from = from ? emails.get(from) ?? null : null;
    to = to ? emails.get(to) ?? null : null;
  }

  if (!ctx.ownWrites.has(row.clickup_task_id)) ctx.ownWrites.set(row.clickup_task_id, await lastOwnWrite(ctx.db, row.clickup_task_id));
  const clickupChangedMs = ms(msToIso(task.date_updated));
  const decision = decideConflict({
    from,
    to,
    current,
    appChangedMs: ms(row.app_changed_at) ?? ctx.nowMs,
    clickupChangedMs,
    lastOwnWriteMs: ctx.ownWrites.get(row.clickup_task_id) ?? null,
  });
  if (decision.action === "noop") return { outcome: "noop", clickupUpdatedMs: null, ref: null };
  if (decision.action === "clash") {
    await logClash(ctx, row, to, current, "clickup", clickupChangedMs);
    await applyClickUpValue(ctx, row, current);
    return { outcome: "clash", clickupUpdatedMs: null, ref: null };
  }

  let res: Record<string, unknown>;
  if (row.kind === "status") {
    res = await ctx.cu.request("PUT", `/task/${id}`, { status: to });
  } else if (row.kind === "due_date") {
    res = await ctx.cu.request("PUT", `/task/${id}`, { due_date: dateToMs(to), due_date_time: false });
  } else {
    let add: string[] = [];
    if (to) {
      const cuId = (await teamMembers(ctx)).get(to);
      if (!cuId) throw new Permanent(`no ClickUp member has the email ${to}`);
      add = [cuId];
    }
    const rem = currentIds.filter((c) => !add.includes(c));
    await ctx.cu.request("POST", `/task/${id}/field/${fieldId}`, { value: { add, rem } });
    res = await ctx.cu.request("GET", `/task/${id}`);
  }
  if (decision.clash) await logClash(ctx, row, to, current, "app", clickupChangedMs);
  const updatedMs = ms(msToIso((res as unknown as CuTask).date_updated));
  if (updatedMs !== null) ctx.ownWrites.set(row.clickup_task_id, updatedMs);
  return { outcome: "sent", clickupUpdatedMs: updatedMs, ref: null };
}

// ------------------------------------------------------------------ the run

export interface RunCounts {
  enabled: boolean;
  due: number;
  sent: number;
  held: number;
  clash: number;
  skipped: number;
  retrying: number;
  failed: number;
  rateLimited: boolean;
}

export async function runWriteback(db: SupabaseLike, env: Env, fetchFn: FetchLike, nowIso: string): Promise<RunCounts> {
  const cfg = writebackConfig(env);
  const nowMs = Date.parse(nowIso);
  const counts: RunCounts = { enabled: cfg.enabled, due: 0, sent: 0, held: 0, clash: 0, skipped: 0, retrying: 0, failed: 0, rateLimited: false };

  const { data, error } = await db.from("os_clickup_outbox").select("*").eq("state", "queued")
    .lt("next_attempt_at", nowIso).order("id", { ascending: true }).limit(BATCH_SIZE);
  if (error) throw new Error(`os_clickup_outbox read failed: ${error.message}`);
  const rows = (data ?? []) as unknown as OutboxRow[];
  counts.due = rows.length;

  const taskIds = [...new Set(rows.map((r) => r.task_id).filter((t): t is string => !!t))];
  const tasks = new Map<string, Record<string, unknown>>();
  if (taskIds.length > 0) {
    const { data: t, error: te } = await db.from("os_tasks").select("id, clickup_list_id, read_only").in("id", taskIds);
    if (te) throw new Error(`os_tasks read failed: ${te.message}`);
    for (const r of t ?? []) tasks.set(String(r.id), r);
  }

  const ctx: RunContext = {
    db,
    cu: clickupClient(cfg.token ?? "", fetchFn),
    nowMs,
    members: null,
    ownWrites: new Map(),
  };

  for (const row of rows) {
    const task = row.task_id ? tasks.get(row.task_id) : undefined;
    if (task?.read_only === true) {
      await update(db, row.id, { state: "skipped", last_error: "the task is read-only history" });
      counts.skipped++;
      continue;
    }
    const listId = str(task?.clickup_list_id) ?? row.clickup_list_id;
    const held = holdReason(cfg, listId);
    if (held) {
      await update(db, row.id, { state: "held", last_error: held, clickup_list_id: listId });
      counts.held++;
      continue;
    }
    if (counts.rateLimited) continue;

    const attempts = (row.attempts ?? 0) + 1;
    try {
      if (!cfg.token) throw new Error("CLICKUP_API_TOKEN is not set");
      const r = await sendRow(ctx, row);
      if (r.outcome === "clash") {
        await update(db, row.id, { state: "clash", attempts, last_error: "ClickUp changed this later; ClickUp's value was kept" });
        counts.clash++;
      } else {
        await update(db, row.id, {
          state: "sent",
          attempts,
          last_error: null,
          sent_at: new Date(nowMs).toISOString(),
          clickup_updated_at: r.clickupUpdatedMs === null ? null : new Date(r.clickupUpdatedMs).toISOString(),
          clickup_ref: r.ref,
        });
        counts.sent++;
      }
    } catch (err) {
      if (err instanceof ClickUpRateLimited) {
        counts.rateLimited = true;
        await update(db, row.id, { last_error: "ClickUp rate limit, waiting", next_attempt_at: new Date(Math.max(err.retryAtMs, nowMs + 1000)).toISOString() });
        counts.retrying++;
        continue;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      const next = err instanceof Permanent ? { state: "failed" as const } : afterFailure(attempts, nowMs);
      if (next.state === "failed") {
        await update(db, row.id, { state: "failed", attempts, last_error: message });
        counts.failed++;
      } else {
        await update(db, row.id, { attempts, last_error: message, next_attempt_at: next.nextAttemptAt });
        counts.retrying++;
      }
    }
  }

  const blocked = !cfg.enabled ? "off" : cfg.listIds.size === 0 ? "no lists allowed" : cfg.guard.blocked ? `ClickUp writes blocked (${cfg.guard.reason})` : null;
  const { error: se } = await db.from("os_clickup_writeback_state").upsert([{
    id: true,
    enabled: cfg.enabled,
    allowed_list_ids: [...cfg.listIds],
    blocked_reason: blocked,
    last_run_at: new Date(nowMs).toISOString(),
    last_counts: counts,
    updated_at: new Date(nowMs).toISOString(),
  }], { onConflict: "id" });
  if (se) console.error(`os_clickup_writeback_state upsert failed: ${se.message}`);
  return counts;
}
