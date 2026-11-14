import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isStaffUser } from "../_shared/account-access.ts";
import { checkDecisionInput, decisionLabel } from "../_shared/client-decision.ts";

// client-decision: a signed-in CLIENT approves a card or asks for changes (phase 5b, owner decision
// 2026-11-10: approvals happen inside Verdanote, made by the client).
//
// Who may call: a client login only. Staff (builder, employee) are refused with 403: the decision is
// the client's, and a staff preview of the client view must not record one. No token is 401.
//
// What it does: checks the input, reads the caller's own clients with the caller's token
// (get_user_client_slugs answers only for auth.uid()), then calls record_client_decision with the
// service role. That function accepts only a card of one of those clients (anything else answers
// "not found", the same as a card that does not exist), records who decided, when and the note,
// keeps the history, is idempotent, allows a change only while the card is still in Client Review,
// limits one person to 5 decisions per card per 10 minutes, and queues the ClickUp write-back as an
// unsent durable job. This function never writes to ClickUp and sends nothing.
//
// Body: { taskId: string, decision: "approved" | "changes_requested", note?: string }

// The small part of the Supabase client this handler uses. The user client uses `auth` and `rpc`; the
// service client only `rpc`.
interface Client {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string; email?: string } | null } | null; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}
export interface Deps {
  createClient?: (url: string, key: string, options?: Record<string, unknown>) => Client;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// SQLSTATE raised by record_client_decision -> status and a plain sentence for the client.
const DB_ERRORS: Record<string, [number, string]> = {
  P0002: [404, "We could not find that asset."],
  P0409: [409, "This asset is not open for a decision right now."],
  P0429: [429, "That is a lot of changes in a short time. Please try again in a few minutes."],
  "22023": [400, "That decision could not be saved. Please check it and try again."],
};

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const make = deps.createClient ?? (createClient as unknown as NonNullable<Deps["createClient"]>);
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = make(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const service = make(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (await isStaffUser(service, user.id)) {
    return json({ error: "Only the client can record a decision." }, 403);
  }
  const { data: role } = await service.rpc("get_user_role", { _user_id: user.id });
  if (role !== "client") return json({ error: "Forbidden" }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }
  const input = checkDecisionInput(body);
  if (!input.ok) return json({ error: input.error }, 400);

  const { data: slugs, error: slugError } = await userClient.rpc("get_user_client_slugs");
  const own = Array.isArray(slugs) ? slugs.filter((s: unknown): s is string => typeof s === "string") : [];
  if (slugError) return json({ error: "We could not check your account just now." }, 500);
  if (own.length === 0) return json({ error: "Forbidden" }, 403);

  const { data, error } = await service.rpc("record_client_decision", {
    p_user_id: user.id,
    p_label: decisionLabel(user.email),
    p_allowed_slugs: own,
    p_task_id: input.value.taskId,
    p_decision: input.value.decision,
    p_note: input.value.note,
  });
  if (error) {
    const mapped = DB_ERRORS[String(error.code)];
    if (mapped) return json({ error: mapped[1] }, mapped[0]);
    console.error("client-decision: record_client_decision failed", error.code);
    return json({ error: "We could not save that just now. Please try again." }, 500);
  }
  return json({ success: true, ...(data as Record<string, unknown>) });
}

if (!Deno.env.get("CLIENT_DECISION_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
