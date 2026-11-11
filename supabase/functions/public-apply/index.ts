// public-apply: the creator and actor application forms (P8 part 3). Open to anyone by design.
//
//   POST { kind: creator | actor, action: begin | upload_url | submit, ... }
//
// Access class "public", gate "form" in supabase/function-access.json. There is no token, so:
//   - a draft id from `begin` is needed for uploads and the submit (two hours, used once);
//   - limits per address (hashed) on drafts, uploads and submissions, checked before any work;
//   - the body is capped at 32 KB by bytes read, files go straight to storage on signed addresses
//     that this function makes inside one application's folder, with size and type checked first;
//   - a hidden field and a minimum fill time drop simple bots without telling them;
//   - the only tables written are the application and application video tables, through
//     service-only database functions. Nothing is emailed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRequestLimits, clientKey, jsonResponse, readJsonBody } from "../_shared/public-link.ts";
import { begin, submit, uploadUrl, type ApplyKind } from "../_shared/public-apply.ts";

const MAX_BODY = 32 * 1024;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handler(req: Request, injectedDb?: any): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const db = injectedDb ??
    createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const parsed = await readJsonBody(req, MAX_BODY);
  if (!parsed.ok) return jsonResponse({ error: parsed.status === 413 ? "too_large" : "bad_request" }, parsed.status);
  const body = parsed.body;

  const kind = body.kind === "creator" || body.kind === "actor" ? (body.kind as ApplyKind) : null;
  const action = typeof body.action === "string" ? body.action : "";
  if (!kind || !["begin", "upload_url", "submit"].includes(action)) return jsonResponse({ error: "bad_request" }, 400);

  const ip = await clientKey(req);
  const limited = await checkRequestLimits(db, ip, null, action !== "begin");
  if (limited) return limited;

  try {
    if (action === "begin") return await begin(db, kind, ip);
    if (action === "upload_url") return await uploadUrl(db, kind, ip, body);
    return await submit(db, kind, ip, body);
  } catch {
    return jsonResponse({ error: "server_error" }, 500);
  }
}

if (!Deno.env.get("PUBLIC_APPLY_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
