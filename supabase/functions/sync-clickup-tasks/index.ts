import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import {
  CLICKUP_CLIENT_SPACE_ID,
  type AccountRow,
  type ClickUpTask,
  type PipelineRecord,
  pickProjectList,
  resolveAccountId,
  toPipelineRecord,
} from "../_shared/clickup-pipeline.ts";

// ClickUp -> pipeline_tasks. Feeds the client-facing Content Pipeline board
// (/pipeline). Replaces sync-coda-tasks: Coda was retired on 2026-10-09 and
// ClickUp is the task system.
//
// Read-only against ClickUp (GET only). For every client folder in the Client
// Operations space it reads the "{Client} Project View" list, keeps asset tasks,
// maps each ClickUp status to one of five client-facing columns and writes only
// client-safe fields. See _shared/clickup-pipeline.ts for the rules.
//
// The sync is authoritative: rows not refreshed by a clean run are deleted, so
// a task that is cleared, archived, moved to "stuck" or aged out of the launch
// window leaves the board.

const CLICKUP_API = "https://api.clickup.com/api/v2";
const MAX_PAGES_PER_LIST = 50; // 100 tasks per page
const UPSERT_CHUNK = 500;

// The small part of the Supabase client this handler uses. Tests inject a
// recording stand-in; production passes a real createClient().
interface QueryResult {
  data: Record<string, string>[] | null;
  error: { message: string } | null;
  count?: number | null;
}
interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  upsert(rows: unknown[], options: { onConflict: string }): QueryBuilder;
  delete(options: { count: "exact" }): QueryBuilder;
  lt(column: string, value: string): QueryBuilder;
}
interface SupabaseLike {
  from(table: string): QueryBuilder;
}

async function clickupGet(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${CLICKUP_API}${path}`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    // The body can echo request details; keep only the status in the message.
    await res.body?.cancel();
    throw new Error(`ClickUp API error [${res.status}] for ${path.split("?")[0]}`);
  }
  return await res.json();
}

async function fetchListTasks(listId: string, token: string): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  for (let page = 0; page < MAX_PAGES_PER_LIST; page++) {
    const data = await clickupGet(
      `/list/${listId}/task?page=${page}&include_closed=true&subtasks=false&archived=false`,
      token,
    );
    const batch = (data.tasks as ClickUpTask[] | undefined) ?? [];
    tasks.push(...batch);
    if (data.last_page === true || batch.length === 0) break;
  }
  return tasks;
}

export async function handler(
  req: Request,
  injectedClient?: SupabaseLike,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // verify_jwt = false: this check is the only gate. pg_cron forwards the real
  // service-role key. Skipped when a test injects a client.
  const isInjectedClient =
    !!injectedClient && typeof (injectedClient as { from?: unknown }).from === "function";
  if (!isInjectedClient) {
    const authFailure = await requireServiceRole(req);
    if (authFailure) return authFailure;
  }

  try {
    const token = Deno.env.get("CLICKUP_API_TOKEN");
    if (!token) throw new Error("CLICKUP_API_TOKEN is not configured");

    const supabase: SupabaseLike = isInjectedClient
      ? injectedClient!
      : (createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        ) as unknown as SupabaseLike);

    const { data: accountRows, error: accountsError } = await supabase
      .from("ad_accounts")
      .select("id, name")
      .eq("is_active", true);
    if (accountsError) throw new Error(`ad_accounts read failed: ${accountsError.message}`);
    const accounts: AccountRow[] = (accountRows ?? []).map((a) => ({ id: a.id, name: a.name }));

    const { data: overrideRows, error: overridesError } = await supabase
      .from("clickup_client_folders")
      .select("folder_id, account_id");
    if (overridesError) {
      throw new Error(`clickup_client_folders read failed: ${overridesError.message}`);
    }
    const overrides: Record<string, string> = {};
    for (const row of overrideRows ?? []) overrides[row.folder_id] = row.account_id;

    const folderData = await clickupGet(
      `/space/${CLICKUP_CLIENT_SPACE_ID}/folder?archived=false`,
      token,
    );
    const folders =
      (folderData.folders as { id: string; name: string; lists?: { id: string; name: string }[] }[] | undefined) ??
      [];

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const records = new Map<string, PipelineRecord>();
    const unmatchedFolders: string[] = [];
    const failedFolders: string[] = [];
    const unknownStatuses = new Set<string>();
    let seen = 0;
    let skipped = 0;
    let matchedFolders = 0;

    for (const folder of folders) {
      const accountId = resolveAccountId(folder, accounts, overrides);
      const list = pickProjectList(folder.lists);
      if (!accountId || !list) {
        unmatchedFolders.push(folder.name);
        continue;
      }
      matchedFolders++;

      let tasks: ClickUpTask[];
      try {
        tasks = await fetchListTasks(list.id, token);
      } catch (err) {
        console.error(`Task read failed for folder ${folder.name}:`, err);
        failedFolders.push(folder.name);
        continue;
      }

      for (const task of tasks) {
        seen++;
        const outcome = toPipelineRecord(task, accountId, nowMs);
        if (outcome.kind === "record") {
          records.set(outcome.record.clickup_task_id, outcome.record);
        } else {
          skipped++;
          if (outcome.kind === "unknown") unknownStatuses.add(outcome.status);
        }
      }
    }

    const rows = [...records.values()];
    let upserted = 0;
    let upsertFailed = false;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from("pipeline_tasks")
        .upsert(chunk, { onConflict: "clickup_task_id" });
      if (error) {
        upsertFailed = true;
        console.error(`Upsert error for chunk ${i}-${i + chunk.length}:`, error.message);
      } else {
        upserted += chunk.length;
      }
    }

    // Authoritative delete: every row written this run carries synced_at = nowIso,
    // so anything older was not part of the board this time.
    //
    // SAFETY: skipped when an upsert chunk failed OR when any client folder could
    // not be read. In both cases live rows still carry an old synced_at, and
    // deleting by timestamp would empty a client's board over a transient error.
    let deleted = 0;
    const deleteSkipped = upsertFailed || failedFolders.length > 0;
    if (deleteSkipped) {
      console.warn("Skipping authoritative delete: this run was not clean.");
    } else {
      const { error: deleteError, count } = await supabase
        .from("pipeline_tasks")
        .delete({ count: "exact" })
        .lt("synced_at", nowIso);
      if (deleteError) {
        console.error("Authoritative delete error:", deleteError.message);
      } else {
        deleted = count ?? 0;
      }
    }

    if (unknownStatuses.size > 0) {
      console.warn(
        `ClickUp status drift: unmapped statuses were left off the board: ${[...unknownStatuses].join(", ")}`,
      );
    }
    if (unmatchedFolders.length > 0) {
      console.warn(
        `Client folders with no Verdanote account match (add a clickup_client_folders row): ${unmatchedFolders.join(", ")}`,
      );
    }

    return new Response(
      JSON.stringify({
        success: !upsertFailed && failedFolders.length === 0,
        folders: folders.length,
        matchedFolders,
        unmatchedFolders,
        failedFolders,
        seen,
        upserted,
        skipped,
        deleted,
        deleteSkipped,
        unknownStatuses: [...unknownStatuses],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    console.error("sync-clickup-tasks error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Bind the server unless a test imports this module. Only `req` reaches the
// handler: Deno.serve calls (req, connInfo) and connInfo must not be taken for
// an injected Supabase client.
if (!Deno.env.get("SYNC_CLICKUP_TASKS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
