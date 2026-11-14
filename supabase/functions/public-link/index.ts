// public-link: the one door for pages that open without a login (P8).
//
//   POST { type, action, token, ... }
//     type    approval | casting | location | call-sheet   (part 3 adds applications)
//     action  get | vote | photo   (location and call-sheet are read only: get)
//
// Who can call it: anyone. What they get depends only on the token. The access class in
// supabase/function-access.json is "public" with gate "token":
//   - the token is hashed here and the database looks the hash up (see the public_links migration);
//   - a malformed token, an unknown token and a token of another link type all answer the same 404;
//   - a revoked or expired link answers 410 to a holder of a real token only;
//   - every call is limited per address and per token, and writes per address, before any work;
//   - the body is capped at 8 KB by bytes read;
//   - the only tables it can touch are through service-only functions that scope to the token's own
//     link and write only the vote table for that link type.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkRequestLimits,
  clientKey,
  countMiss,
  hashToken,
  jsonResponse,
  notFound,
  readJsonBody,
} from "../_shared/public-link.ts";
import { castVote, getBoard, getPhoto, type BoardKind } from "../_shared/public-board.ts";
import { getCallSheet, getLocationBoard } from "../_shared/public-sheet.ts";

const BOARD_TYPES: Record<string, BoardKind> = { approval: "approval", casting: "casting" };

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handler(req: Request, injectedDb?: any): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const db = injectedDb ??
    createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return jsonResponse({ error: parsed.status === 413 ? "too_large" : "bad_request" }, parsed.status);
  const body = parsed.body;

  const type = typeof body.type === "string" ? body.type : "";
  const action = typeof body.action === "string" ? body.action : "";
  const kind = BOARD_TYPES[type];
  const isWrite = action === "vote";
  const readOnlyType = type === "location" || type === "call-sheet";
  const validAction = readOnlyType ? action === "get" : !!kind && ["get", "vote", "photo"].includes(action);
  if ((!kind && !readOnlyType) || !validAction) return jsonResponse({ error: "bad_request" }, 400);

  const ip = await clientKey(req);
  const tokenHash = await hashToken(body.token);

  const limited = await checkRequestLimits(db, ip, tokenHash, isWrite);
  if (limited) return limited;
  if (!tokenHash) {
    await countMiss(db, ip);
    return notFound();
  }

  try {
    let res: Response;
    const countOpen = body.refresh !== true;
    if (type === "location") res = await getLocationBoard(db, tokenHash, countOpen);
    else if (type === "call-sheet") res = await getCallSheet(db, tokenHash, countOpen);
    else if (action === "get") res = await getBoard(db, kind, tokenHash, countOpen);
    else if (action === "vote") res = await castVote(db, kind, tokenHash, body);
    else res = await getPhoto(db, kind, tokenHash, body);
    if (res.status === 404) await countMiss(db, ip);
    return res;
  } catch {
    return jsonResponse({ error: "server_error" }, 500);
  }
}

// Bind only outside tests. The arrow wrapper keeps Deno's ConnInfo out of the handler's
// injectable second parameter.
if (!Deno.env.get("PUBLIC_LINK_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
