import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import type { FetchLike, SupabaseLike } from "../_shared/os-clickup-sync.ts";
import { runWriteback } from "../_shared/os-clickup-writeback.ts";

// App -> ClickUp write-back worker (Goodo OS story OS-017).
//
// Service role only (pg_cron every minute in production, or a builder by hand with the service
// role key). Each call sends the due rows of os_clickup_outbox; see _shared/os-clickup-writeback.ts.
//
// Off by default: unless CLICKUP_WRITEBACK_ENABLED=true and the task's list is in
// CLICKUP_WRITEBACK_LIST_IDS (and the staging write guard allows it), rows are marked held and
// ClickUp is not called. Every run records what it saw in os_clickup_writeback_state.

export interface Deps {
  supabase?: SupabaseLike;
  fetch?: FetchLike;
  env?: (name: string) => string | undefined;
  now?: () => string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireServiceRole(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db: SupabaseLike = deps.supabase ??
    (createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) as unknown as SupabaseLike);
  try {
    const counts = await runWriteback(
      db,
      deps.env ?? ((name) => Deno.env.get(name)),
      deps.fetch ?? fetch,
      deps.now ? deps.now() : new Date().toISOString(),
    );
    return json({ ok: true, ...counts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("clickup-writeback error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
}

if (!Deno.env.get("CLICKUP_WRITEBACK_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
