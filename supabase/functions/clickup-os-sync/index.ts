import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import { CLICKUP_NO_TOKEN_STATE } from "../_shared/clickup-pipeline.ts";
import { type CuTask, diffTask, type Discrepancy, firstListStatus, type MappedTask, mapTask, OS_SPACE_IDS } from "../_shared/os-task-map.ts";
import {
  type ClickUpReader,
  clickupReader,
  type CommentRow,
  type CuListStatus,
  ensureStatuses,
  type FetchLike,
  fetchComments,
  finishRun,
  folderOwner,
  loadClientContext,
  loadExistingTasks,
  resolvePeople,
  startRun,
  storeListStatuses,
  type SupabaseLike,
  upsertComments,
  upsertTasks,
  withPeople,
} from "../_shared/os-clickup-sync.ts";

// ClickUp -> os_tasks, every task of the three Goodo spaces (Goodo OS story OS-007).
//
// Service role only. Body: {"mode": "full" | "nightly"} (default nightly).
//   * Walks Client Operations, Production Team and Social Media Plan: folders and their lists,
//     then lists with no folder. Tasks are read with include_closed, subtasks, not archived, in
//     pages. ClickUp is only read (GET).
//   * Client folders resolve to a client like sync-clickup-tasks does. Ending clients' folders
//     are read-only history. Production and social tasks have no client.
//   * Every walked list's statuses are stored in os_clickup_list_statuses (the statuses an app user
//     may set on that list's tasks). Statuses the app did not know are added to os_task_statuses
//     first (stage from the list's order, see storeListStatuses), then any task status still
//     unknown (stage Other), before tasks are written; tasks are upserted by clickup_task_id.
//   * nightly: before writing, every compared field where the app differs from ClickUp is
//     recorded in os_sync_discrepancies. Comments are read for tasks ClickUp updated since the
//     last good run. full: comments for every asset task. Both capped (MAX_COMMENT_TASKS).
//   * App rows whose ClickUp task is gone are deleted only after a clean walk: every space and
//     list read, every write chunk saved, at least one task seen. Same rule as the board sync.
//   * Every run is recorded in os_sync_runs.

const MAX_PAGES_PER_LIST = 100; // 100 tasks per page
export const MAX_COMMENT_TASKS = 400;
export const DEMO_SEED_ID_PATTERN = "demo-seed-%";

interface CuList {
  id: string;
  name: string;
  statuses?: CuListStatus[];
}
interface CuFolder {
  id: string;
  name: string;
  lists?: CuList[];
}

async function fetchListTasks(reader: ClickUpReader, listId: string): Promise<CuTask[]> {
  const tasks: CuTask[] = [];
  for (let page = 0; page < MAX_PAGES_PER_LIST; page++) {
    const data = await reader.get(
      `/list/${listId}/task?page=${page}&include_closed=true&subtasks=true&archived=false`,
    );
    const batch = (data.tasks as CuTask[] | undefined) ?? [];
    tasks.push(...batch);
    if (data.last_page === true || batch.length === 0) break;
  }
  return tasks;
}

const RATE_LIMIT_RETRIES = 3;
export const rateLimitWait = { ms: 2000 };

/** reader.get, retried with a growing wait when ClickUp answers 429 (rate limited). */
async function getRateLimited(reader: ClickUpReader, path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await reader.get(path);
    } catch (err) {
      if (attempt >= RATE_LIMIT_RETRIES || !String(err).includes("[429]")) throw err;
      await new Promise((r) => setTimeout(r, rateLimitWait.ms * (attempt + 1)));
    }
  }
}

/**
 * Folderless lists from /space/{id}/list come without their statuses. Such a list's statuses are
 * read from /list/{id}. If that read fails the list is walked as before, without stored statuses.
 */
async function withStatuses(reader: ClickUpReader, list: CuList): Promise<CuList> {
  if (Array.isArray(list.statuses) && list.statuses.length > 0) return list;
  try {
    const full = await getRateLimited(reader, `/list/${list.id}`);
    const statuses = full.statuses as CuListStatus[] | undefined;
    return Array.isArray(statuses) && statuses.length > 0 ? { ...list, statuses } : list;
  } catch (err) {
    console.error(`Statuses of list ${list.name} could not be read:`, err);
    return list;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface Deps {
  supabase?: SupabaseLike;
  fetch?: FetchLike;
  now?: () => number;
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // verify_jwt = false: this check is the only gate. Skipped only when a test injects a client.
  if (!deps.supabase) {
    const authFailure = await requireServiceRole(req);
    if (authFailure) return authFailure;
  }
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let mode: "full" | "nightly" = "nightly";
  try {
    const body = await req.json();
    if (body?.mode === "full" || body?.mode === "nightly") mode = body.mode;
    else if (body?.mode !== undefined) return json({ success: false, error: "mode must be full or nightly" }, 400);
  } catch {
    // empty body: nightly
  }

  const token = Deno.env.get("CLICKUP_API_TOKEN");
  if (!token) {
    console.error(`${CLICKUP_NO_TOKEN_STATE}: CLICKUP_API_TOKEN is not set. clickup-os-sync did not run.`);
    return json({ success: false, state: CLICKUP_NO_TOKEN_STATE, error: "ClickUp is not connected. No row was changed." }, 503);
  }

  const db: SupabaseLike = deps.supabase ??
    (createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) as unknown as SupabaseLike);
  const reader = clickupReader(token, deps.fetch ?? fetch);
  const nowMs = (deps.now ?? Date.now)();
  const nowIso = new Date(nowMs).toISOString();

  const runId = await startRun(db, mode, nowIso);
  const counts: Record<string, unknown> = { mode };
  try {
    // When the last good walk started: tasks ClickUp updated after it get their comments read.
    const lastRuns = await db.from("os_sync_runs").select("started_at").in("kind", ["full", "nightly"]).eq("ok", true)
      .order("started_at", { ascending: false }).limit(1);
    if (lastRuns.error) throw new Error(`os_sync_runs read failed: ${lastRuns.error.message}`);
    const lastOkMs = lastRuns.data?.[0]?.started_at ? Date.parse(String(lastRuns.data[0].started_at)) : 0;

    const ctx = await loadClientContext(db);
    const existing = await loadExistingTasks(db);

    const failedSpaces: string[] = [];
    const failedLists: string[] = [];
    const skippedFolders: { name: string; reason: string }[] = [];
    // Lists of skipped folders: their rows are kept, not deleted, until the folder resolves again.
    const skippedListIds: string[] = [];
    const tasks = new Map<string, { task: CuTask; mapped: MappedTask }>();
    const walkedLists: CuList[] = [];
    let lists = 0;

    for (const spaceId of OS_SPACE_IDS) {
      let folders: CuFolder[];
      let loose: CuList[];
      try {
        folders = ((await reader.get(`/space/${spaceId}/folder?archived=false`)).folders as CuFolder[] | undefined) ?? [];
        loose = ((await reader.get(`/space/${spaceId}/list?archived=false`)).lists as CuList[] | undefined) ?? [];
      } catch (err) {
        console.error(`Space ${spaceId} could not be read:`, err);
        failedSpaces.push(spaceId);
        continue;
      }
      const groups: { folder: CuFolder | null; lists: CuList[] }[] = [
        ...folders.map((f) => ({ folder: f, lists: f.lists ?? [] })),
        { folder: null, lists: loose },
      ];
      for (const group of groups) {
        const owner = folderOwner(spaceId, group.folder, ctx);
        if (owner.kind === "skip") {
          skippedFolders.push({ name: group.folder!.name, reason: owner.reason });
          for (const l of group.lists) skippedListIds.push(String(l.id));
          continue;
        }
        for (const groupList of group.lists) {
          const list = await withStatuses(reader, groupList);
          lists++;
          walkedLists.push(list);
          let listTasks: CuTask[];
          try {
            listTasks = await fetchListTasks(reader, list.id);
          } catch (err) {
            console.error(`List ${list.name} could not be read:`, err);
            failedLists.push(list.name);
            continue;
          }
          const listFirst = firstListStatus(list.statuses);
          for (const task of listTasks) {
            const id = String(task.id);
            if (tasks.has(id)) continue; // a task in several lists: its first list wins
            const prev = existing.get(id);
            const mapped = mapTask(task, {
              clientSlug: owner.clientSlug,
              spaceId,
              list: { id: list.id, name: list.name },
              readOnly: owner.readOnly,
              previousStatus: prev ? String(prev.status) : null,
              listFirstStatus: listFirst,
              nowIso,
            });
            tasks.set(id, { task, mapped });
          }
        }
      }
    }

    // Nightly: what the app holds that ClickUp does not, recorded before it is overwritten.
    const discrepancies: Discrepancy[] = [];
    if (mode === "nightly") {
      for (const [id, { mapped }] of tasks) {
        const prev = existing.get(id);
        if (prev) discrepancies.push(...diffTask(prev, mapped.row));
      }
    }

    let listStatuses: { lists: number; added: string[] } = { lists: 0, added: [] };
    let listStatusesFailed = false;
    try {
      listStatuses = await storeListStatuses(db, walkedLists, nowIso);
    } catch (err) {
      listStatusesFailed = true;
      console.error("List statuses could not be stored:", err);
    }
    const statusesAdded = await ensureStatuses(db, [...tasks.values()].map((t) => t.mapped.row.status));
    const people = await resolvePeople(
      db,
      [...tasks.values()].flatMap((t) => [t.mapped.people.strategist, t.mapped.people.producer, t.mapped.people.editor]),
    );
    const unmatchedPeople = new Set<string>();
    for (const t of tasks.values()) {
      for (const e of [t.mapped.people.strategist, t.mapped.people.producer, t.mapped.people.editor]) {
        if (e && !people.has(e)) unmatchedPeople.add(e);
      }
    }

    const written = await upsertTasks(db, [...tasks.values()].map((t) => withPeople(t.mapped, people)));

    if (runId && discrepancies.length > 0) {
      for (let i = 0; i < discrepancies.length; i += 500) {
        const chunk = discrepancies.slice(i, i + 500).map((d) => ({ ...d, run_id: runId }));
        const { error } = await db.from("os_sync_discrepancies").insert(chunk);
        if (error) console.error(`os_sync_discrepancies insert failed: ${error.message}`);
      }
    }

    // Comments.
    const commentTargets = [...tasks.values()].filter(({ task, mapped }) =>
      mode === "full" ? mapped.row.is_asset : Number(task.date_updated ?? 0) > lastOkMs
    );
    const capped = Math.max(0, commentTargets.length - MAX_COMMENT_TASKS);
    const commentRows: CommentRow[] = [];
    let commentReadFailures = 0;
    for (const { task } of commentTargets.slice(0, MAX_COMMENT_TASKS)) {
      const appId = written.ids.get(String(task.id));
      if (!appId) continue;
      try {
        commentRows.push(...await fetchComments(reader, String(task.id), appId, nowIso));
      } catch (err) {
        commentReadFailures++;
        console.error(`Comments of task ${task.id} could not be read:`, err);
      }
    }
    const comments = await upsertComments(db, commentRows);

    // Authoritative delete, only after a clean walk.
    const clean = failedSpaces.length === 0 && failedLists.length === 0 && !written.failed && tasks.size > 0;
    let deleted = 0;
    if (clean) {
      let del = db.from("os_tasks").delete({ count: "exact" })
        .not("clickup_task_id", "is", null)
        .lt("last_synced_at", nowIso)
        .not("clickup_task_id", "like", DEMO_SEED_ID_PATTERN);
      if (skippedListIds.length > 0) {
        del = del.not("clickup_list_id", "in", `(${skippedListIds.map((id) => `"${id}"`).join(",")})`);
      }
      const { error, count } = await del;
      if (error) console.error(`os_tasks delete failed: ${error.message}`);
      else deleted = count ?? 0;
    } else {
      console.warn("clickup-os-sync: delete skipped, this walk was not clean.");
    }

    Object.assign(counts, {
      lists,
      seen: tasks.size,
      upserted: written.upserted,
      statusesAdded,
      listStatusLists: listStatuses.lists,
      listStatusesAdded: listStatuses.added,
      listStatusesFailed,
      skippedFolders,
      failedSpaces,
      failedLists,
      commentTasks: Math.min(commentTargets.length, MAX_COMMENT_TASKS),
      commentsCapped: capped,
      commentReadFailures,
      comments: comments.written,
      deleted,
      deleteSkipped: !clean,
      unmatchedPeople: unmatchedPeople.size,
      readOnly: [...tasks.values()].filter((t) => t.mapped.row.read_only).length,
      noClient: [...tasks.values()].filter((t) => t.mapped.row.client_slug === null).length,
    });
    const ok = failedSpaces.length === 0 && failedLists.length === 0 && !written.failed && !comments.failed && !listStatusesFailed;
    await finishRun(db, runId, { ok, counts, discrepancyCount: discrepancies.length });
    return json({ success: ok, runId, discrepancies: discrepancies.length, ...counts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("clickup-os-sync error:", msg);
    await finishRun(db, runId, { ok: false, counts, error: msg });
    return json({ success: false, runId, error: msg }, 500);
  }
}

if (!Deno.env.get("CLICKUP_OS_SYNC_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
