import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";
import { CLICKUP_CLIENT_SPACE_ID } from "../_shared/clickup-pipeline.ts";

// ClickUp folder lookup for the client Setup tab (phase 4). A builder picks a client's
// ClickUp folder from this list instead of pasting an id.
//
// GET or POST, no body -> { folders: [{ id, name, lists: [{ id, name }] }] } for the
// client space. Read-only: one GET to ClickUp, nothing is stored or written.
//
// Gate: a builder login. Clients, employees and logins with no role get 403; the gate
// runs before the key check, so a client never learns whether ClickUp is connected.
// Fails closed: without CLICKUP_API_TOKEN it answers 503 and makes no request. Staging
// has no token on purpose, and the Setup tab then asks for a pasted id instead.

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface Deps {
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  env?: (name: string) => string | undefined;
  fetch?: FetchLike;
}

const CLICKUP_API = "https://api.clickup.com/api/v2";
const MAX_FOLDERS = 500;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

async function defaultResolveCaller(req: Request): Promise<Caller | Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  return await resolveCaller(req, createClient(url, key));
}

interface FolderOut {
  id: string;
  name: string;
  lists: { id: string; name: string }[];
}

/** Keeps only the id and name of each folder and list. Anything else ClickUp sends is dropped. */
export function shapeFolders(data: unknown): FolderOut[] {
  const raw = (data as { folders?: unknown } | null)?.folders;
  if (!Array.isArray(raw)) return [];
  const out: FolderOut[] = [];
  for (const f of raw.slice(0, MAX_FOLDERS)) {
    const id = typeof f?.id === "string" ? f.id : typeof f?.id === "number" ? String(f.id) : "";
    const name = typeof f?.name === "string" ? f.name.trim() : "";
    if (!id || !name) continue;
    const lists = Array.isArray(f.lists)
      ? f.lists
        .map((l: { id?: unknown; name?: unknown }) => ({
          id: typeof l?.id === "string" ? l.id : typeof l?.id === "number" ? String(l.id) : "",
          name: typeof l?.name === "string" ? l.name.trim() : "",
        }))
        .filter((l: { id: string; name: string }) => l.id && l.name)
      : [];
    out.push({ id, name, lists });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== "user" || !caller.roles.includes("builder")) {
    return json({ error: "Forbidden: builder only" }, 403);
  }

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const token = env("CLICKUP_API_TOKEN")?.trim();
  if (!token) {
    return json({ error: "ClickUp is not connected in this environment: CLICKUP_API_TOKEN is not set." }, 503);
  }

  try {
    const res = await (deps.fetch ?? ((url, init) => fetch(url, init)))(
      `${CLICKUP_API}/space/${CLICKUP_CLIENT_SPACE_ID}/folder?archived=false`,
      { method: "GET", headers: { Authorization: token, "Content-Type": "application/json" } },
    );
    if (!res.ok) {
      // The body can echo request details; keep only the status.
      await res.body?.cancel();
      if (res.status === 401) return json({ error: "ClickUp rejected CLICKUP_API_TOKEN." }, 503);
      return json({ error: `ClickUp request failed (${res.status})` }, 502);
    }
    return json({ folders: shapeFolders(await res.json()) });
  } catch (error) {
    console.error("clickup-folders error:", error instanceof Error ? error.message : error);
    return json({ error: "The ClickUp folder lookup failed." }, 502);
  }
}

// Tests import the handler with CLICKUP_FOLDERS_NO_SERVE set.
if (!Deno.env.get("CLICKUP_FOLDERS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
