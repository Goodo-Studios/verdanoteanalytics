import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type CuTask, firstListStatus, mapTask, OS_SPACE_IDS } from "../_shared/os-task-map.ts";
import {
  type ClickUpReader,
  clickupReader,
  ClickUpNotFound,
  ensureStatuses,
  type FetchLike,
  fetchComments,
  finishRun,
  folderOwner,
  loadClientContext,
  loadExistingTask,
  resolvePeople,
  startRun,
  type SupabaseLike,
  upsertComments,
  upsertTasks,
  withPeople,
} from "../_shared/os-clickup-sync.ts";

// ClickUp webhook receiver (Goodo OS story OS-007).
//
// ClickUp posts here with no JWT (verify_jwt = false). The request is accepted only when
// X-Signature is the hex HMAC-SHA256 of the raw body under CLICKUP_WEBHOOK_SECRET (constant-time
// compare); otherwise, or with no secret set, the answer is 401 and nothing is read or written.
//
// Task events: the task is read from ClickUp (GET), its folder resolved to a client, mapped and
// upserted into os_tasks; comment events also read its comments. taskDeleted removes the app row
// unless it is read-only history. Tasks outside the three Goodo spaces are ignored. Each handled
// event is recorded in os_sync_runs (kind webhook). ClickUp is never written to.
//
// The answer is 200 as soon as the signature checks out; the work runs in the background
// (EdgeRuntime.waitUntil) so ClickUp does not time out and retry.

export const TASK_EVENTS = new Set([
  "taskCreated",
  "taskUpdated",
  "taskStatusUpdated",
  "taskAssigneeUpdated",
  "taskDueDateUpdated",
  "taskMoved",
  "taskCommentPosted",
  "taskCommentUpdated",
]);
export const COMMENT_EVENTS = new Set(["taskCommentPosted", "taskCommentUpdated"]);
export const DELETE_EVENT = "taskDeleted";
export const WEBHOOK_EVENTS = [...TASK_EVENTS, DELETE_EVENT];

const enc = new TextEncoder();

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two strings (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function verifySignature(secret: string | undefined, body: string, header: string | null): Promise<boolean> {
  if (!secret || !header) return false;
  const expected = await hmacHex(secret, body);
  return safeEqual(expected, header.trim().toLowerCase());
}

export interface WebhookEvent {
  event?: string;
  task_id?: string;
  webhook_id?: string;
}

export interface ProcessResult {
  outcome: "upserted" | "deleted" | "kept_read_only" | "ignored" | "skipped_folder" | "not_found" | "failed";
  detail?: Record<string, unknown>;
}

/** Handles one verified event. Never throws; failures are recorded on the run row. */
export async function processEvent(
  db: SupabaseLike,
  reader: ClickUpReader,
  evt: WebhookEvent,
  nowIso: string,
): Promise<ProcessResult> {
  const event = evt.event ?? "";
  const taskId = evt.task_id ? String(evt.task_id) : "";
  if (!taskId || (!TASK_EVENTS.has(event) && event !== DELETE_EVENT)) return { outcome: "ignored" };

  const runId = await startRun(db, "webhook", nowIso);
  const counts: Record<string, unknown> = { event, task: taskId };
  const done = async (result: ProcessResult, ok = true, error: string | null = null) => {
    await finishRun(db, runId, { ok, counts: { ...counts, outcome: result.outcome, ...(result.detail ?? {}) }, error });
    return result;
  };

  try {
    if (event === DELETE_EVENT) {
      const { data, error } = await db.from("os_tasks").delete({ count: "exact" }).eq("clickup_task_id", taskId)
        .eq("read_only", false).select("id");
      if (error) throw new Error(`os_tasks delete failed: ${error.message}`);
      if ((data ?? []).length > 0) return await done({ outcome: "deleted" });
      const kept = await loadExistingTask(db, taskId);
      return await done({ outcome: kept ? "kept_read_only" : "ignored" });
    }

    let task: CuTask;
    try {
      task = (await reader.get(`/task/${encodeURIComponent(taskId)}`)) as unknown as CuTask;
    } catch (err) {
      if (err instanceof ClickUpNotFound) return await done({ outcome: "not_found" });
      throw err;
    }
    const spaceId = String(task.space?.id ?? "");
    if (!OS_SPACE_IDS.includes(spaceId)) return await done({ outcome: "ignored", detail: { reason: "outside_spaces" } });
    const listId = String(task.list?.id ?? "");
    if (!listId) throw new Error("task has no list");

    const folder = task.folder && task.folder.id && !task.folder.hidden
      ? { id: String(task.folder.id), name: String(task.folder.name ?? "") }
      : null;
    const ctx = await loadClientContext(db);
    const owner = folderOwner(spaceId, folder, ctx);
    if (owner.kind === "skip") {
      return await done({ outcome: "skipped_folder", detail: { folder: folder?.name, reason: owner.reason } });
    }

    const prev = await loadExistingTask(db, taskId);
    let listFirst: string | null = null;
    if (!prev && (task.status?.status ?? "").trim().toLowerCase() === "stuck") {
      const list = await reader.get(`/list/${encodeURIComponent(listId)}`);
      listFirst = firstListStatus(list.statuses as { status?: string; orderindex?: number }[] | undefined);
    }
    const mapped = mapTask(task, {
      clientSlug: owner.clientSlug,
      spaceId,
      list: { id: listId, name: String(task.list?.name ?? "") },
      readOnly: owner.readOnly,
      previousStatus: prev ? String(prev.status) : null,
      listFirstStatus: listFirst,
      nowIso,
    });

    await ensureStatuses(db, [mapped.row.status]);
    const people = await resolvePeople(db, [mapped.people.strategist, mapped.people.producer, mapped.people.editor]);
    const written = await upsertTasks(db, [withPeople(mapped, people)]);
    if (written.failed) throw new Error("os_tasks upsert failed");

    let comments = 0;
    if (COMMENT_EVENTS.has(event)) {
      const appId = written.ids.get(taskId);
      if (appId) {
        const rows = await fetchComments(reader, taskId, appId, nowIso);
        const res = await upsertComments(db, rows);
        if (res.failed) throw new Error("os_task_comments upsert failed");
        comments = res.written;
      }
    }
    return await done({ outcome: "upserted", detail: { comments, stuck: mapped.row.is_stuck, read_only: mapped.row.read_only } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`clickup-webhook ${event} ${taskId}:`, msg);
    return await done({ outcome: "failed" }, false, msg);
  }
}

export interface Deps {
  supabase?: SupabaseLike;
  fetch?: FetchLike;
  /** Tests set false to wait for the work; production hands it to EdgeRuntime.waitUntil. */
  background?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  // The signature is checked first, so any unsigned request (any method) gets 401.
  const raw = req.method === "POST" ? await req.text() : "";
  const ok = await verifySignature(Deno.env.get("CLICKUP_WEBHOOK_SECRET"), raw, req.headers.get("x-signature"));
  if (!ok) return json({ error: "Unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let evt: WebhookEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json({ ok: true, outcome: "ignored" });
  }

  const token = Deno.env.get("CLICKUP_API_TOKEN");
  if (!token && evt.event !== DELETE_EVENT) {
    console.error("clickup.no_token: CLICKUP_API_TOKEN is not set; webhook event not applied.");
    return json({ ok: true, outcome: "ignored", reason: "clickup.no_token" });
  }

  const db: SupabaseLike = deps.supabase ??
    (createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) as unknown as SupabaseLike);
  const reader = clickupReader(token ?? "", deps.fetch ?? fetch);
  const work = processEvent(db, reader, evt, new Date().toISOString());

  const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (deps.background !== false && edge?.waitUntil) {
    edge.waitUntil(work);
    return json({ ok: true, accepted: true });
  }
  const result = await work;
  return json({ ok: result.outcome !== "failed", ...result });
}

if (!Deno.env.get("CLICKUP_WEBHOOK_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
