#!/usr/bin/env node
// Anonymous-access wall check for public links, against STAGING only.
//
//   hq secrets exec --company goodo-studios \
//     --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_SUPABASE_SERVICE_ROLE_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/staging-public-link-wall-check.mjs
//
// Makes throwaway rows of its own (two made-up clients, a creator and an actor on each, links of
// every state), then calls the public-link function and the tables the way a stranger would:
//   - no token, a malformed token, an unknown token: 404 and nothing in the body;
//   - a token of one link used for another link's person: refused, no vote written;
//   - a creators token on the casting side and the reverse: 404;
//   - revoked and expired: 410 and no board data;
//   - a live token: only the allowed keys (no email, phone, address, storage path, token);
//   - anonymous and a client login read no link, vote or registry table directly and cannot call
//     the database functions;
//   - a client login holding no token gets the same 404 as anyone else.
// Every throwaway row is deleted at the end, also when a check fails. Nothing real is read.
// Exit code 1 if anything fails. Refuses to run against production.
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const PROD_REF = "gwyxaqoaldnaavkjqquv";
const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_SUPABASE_ANON_KEY;
const service = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.STAGING_TEST_PASSWORD;
if (!url || !anon || !service || !password) {
  console.error("Set STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY and STAGING_TEST_PASSWORD.");
  process.exit(1);
}
if (url.includes(PROD_REF)) {
  console.error("Refusing to run: that URL is the production project.");
  process.exit(1);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const admin = createClient(url, service, { auth: { persistSession: false } });
const anonClient = createClient(url, anon, { auth: { persistSession: false } });
const token = () => randomBytes(36).toString("base64url");
const uuid = () => crypto.randomUUID();

const PREFIX = "wall-pl";
const slugA = `${PREFIX}-a-${Date.now()}`;
const slugB = `${PREFIX}-b-${Date.now()}`;
const ids = { creators: [uuid(), uuid()], actors: [uuid(), uuid()], ca: [uuid(), uuid()], aa: [uuid(), uuid()] };
const boards = {
  creatorsA: { id: uuid(), token: token() },
  creatorsB: { id: uuid(), token: token() },
  actorsA: { id: uuid(), token: token() },
  revoked: { id: uuid(), token: token() },
  expired: { id: uuid(), token: token() },
};
const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

async function call(body, headers = {}) {
  const res = await fetch(`${url}/functions/v1/public-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function cleanup() {
  await admin.from("approval_votes").delete().in("board_id", Object.values(boards).map((b) => b.id));
  await admin.from("actor_approval_votes").delete().in("board_id", Object.values(boards).map((b) => b.id));
  await admin.from("approval_boards").delete().in("id", Object.values(boards).map((b) => b.id));
  await admin.from("creator_assignments").delete().in("id", ids.ca);
  await admin.from("actor_assignments").delete().in("id", ids.aa);
  await admin.from("dashboard_creators").delete().in("id", ids.creators);
  await admin.from("actors").delete().in("id", ids.actors);
  await admin.from("clients").delete().in("slug", [slugA, slugB]);
}

try {
  const must = async (label, p) => {
    const r = await p;
    if (r.error) throw new Error(`seed failed (${label}): ${r.error.message}`);
  };
  await must("clients", admin.from("clients").insert([
    { slug: slugA, name: "Wall Test A", status: "active", origin: "manual" },
    { slug: slugB, name: "Wall Test B", status: "active", origin: "manual" },
  ]));
  await must("creators", admin.from("dashboard_creators").insert([
    { id: ids.creators[0], name: "Wall Creator A", email: "wall-a@example.test" },
    { id: ids.creators[1], name: "Wall Creator B", email: "wall-b@example.test" },
  ]));
  await must("creator assignments", admin.from("creator_assignments").insert([
    { id: ids.ca[0], creator_id: ids.creators[0], client_slug: slugA, stage: "shortlisted" },
    { id: ids.ca[1], creator_id: ids.creators[1], client_slug: slugB, stage: "shortlisted" },
  ]));
  await must("actors", admin.from("actors").insert([
    { id: ids.actors[0], name: "Wall Actor A", email: "wall-actor@example.test", phone: "555-0100" },
    { id: ids.actors[1], name: "Wall Actor B", email: "wall-actor-b@example.test", phone: "555-0101" },
  ]));
  await must("actor assignments", admin.from("actor_assignments").insert([
    { id: ids.aa[0], actor_id: ids.actors[0], client_slug: slugA, stage: "shortlisted" },
    { id: ids.aa[1], actor_id: ids.actors[1], client_slug: slugB, stage: "shortlisted" },
  ]));
  await must("boards", admin.from("approval_boards").insert([
    { id: boards.creatorsA.id, client_slug: slugA, board_type: "creators", token: boards.creatorsA.token, expires_at: future },
    { id: boards.creatorsB.id, client_slug: slugB, board_type: "creators", token: boards.creatorsB.token, expires_at: future },
    { id: boards.actorsA.id, client_slug: slugA, board_type: "actors", token: boards.actorsA.token, expires_at: future },
    { id: boards.revoked.id, client_slug: slugA, board_type: "creators", token: boards.revoked.token, expires_at: future, revoked: true },
    { id: boards.expired.id, client_slug: slugA, board_type: "creators", token: boards.expired.token, expires_at: past },
  ]));

  // Registry rows came from the trigger.
  const reg = await admin.from("public_link_registry").select("link_id").in("link_id", Object.values(boards).map((b) => b.id));
  check("every throwaway link has a registry row", (reg.data ?? []).length === 5, `rows=${reg.data?.length ?? "error"}`);

  // No token, bad token, unknown token.
  const none = await call({ type: "approval", action: "get" });
  check("no token is 404 with no data", none.status === 404 && !none.text.includes("people"), `status=${none.status}`);
  const bad = await call({ type: "approval", action: "get", token: "short" });
  check("a malformed token is 404", bad.status === 404, `status=${bad.status}`);
  const unknown = await call({ type: "casting", action: "get", token: token() });
  check("an unknown token is 404 with no data", unknown.status === 404 && !unknown.text.includes("people"), `status=${unknown.status}`);

  // A live token: allowed keys only.
  const live = await call({ type: "approval", action: "get", token: boards.creatorsA.token });
  check("a live creators token opens its board", live.status === 200 && live.text.includes("Wall Creator A"), `status=${live.status}`);
  check("the board holds nobody from the other client", !live.text.includes("Wall Creator B"));
  const leaks = ["email", "phone", "address", "storage_path", "video_path", "thumbnail_path", "headshot_path", "token", "wall-a@example.test"].filter((k) => live.text.includes(k));
  check("the board carries no email, phone, address, storage path or token", leaks.length === 0, leaks.join(","));
  const cast = await call({ type: "casting", action: "get", token: boards.actorsA.token });
  const castLeaks = ["email", "phone", "555-0100", "wall-actor@example.test", "storage_path", "token"].filter((k) => cast.text.includes(k));
  check("a live casting token opens its board with no contact details", cast.status === 200 && cast.text.includes("Wall Actor A") && castLeaks.length === 0, `status=${cast.status} leaks=${castLeaks.join(",")}`);

  // Wrong link type.
  check("a creators token on the casting side is 404", (await call({ type: "casting", action: "get", token: boards.creatorsA.token })).status === 404);
  check("a casting token on the approval side is 404", (await call({ type: "approval", action: "get", token: boards.actorsA.token })).status === 404);

  // Revoked and expired.
  const rev = await call({ type: "approval", action: "get", token: boards.revoked.token });
  check("a revoked link is 410 with no data", rev.status === 410 && !rev.text.includes("people"), `status=${rev.status}`);
  const exp = await call({ type: "approval", action: "get", token: boards.expired.token });
  check("an expired link is 410 with no data", exp.status === 410 && !exp.text.includes("people"), `status=${exp.status}`);
  check("a revoked link takes no vote", (await call({ type: "approval", action: "vote", token: boards.revoked.token, assignment_id: ids.ca[0], vote: "up" })).status === 410);

  // Votes: own person works, the other link's person does not.
  const own = await call({ type: "approval", action: "vote", token: boards.creatorsA.token, assignment_id: ids.ca[0], vote: "up", voted_by: "Wall" });
  check("a vote on the link's own creator is saved", own.status === 200, `status=${own.status}`);
  const cross = await call({ type: "approval", action: "vote", token: boards.creatorsA.token, assignment_id: ids.ca[1], vote: "up" });
  check("a vote on another link's creator is refused", cross.status === 400, `status=${cross.status}`);
  const crossCast = await call({ type: "casting", action: "vote", token: boards.actorsA.token, assignment_id: ids.aa[1], vote: "up" });
  check("a casting vote on another link's actor is refused", crossCast.status === 400, `status=${crossCast.status}`);
  const written = await admin.from("approval_votes").select("assignment_id").in("board_id", Object.values(boards).map((b) => b.id));
  check("exactly one vote exists and it is the own creator", (written.data ?? []).length === 1 && written.data[0].assignment_id === ids.ca[0], `rows=${written.data?.length ?? "error"}`);
  const castWritten = await admin.from("actor_approval_votes").select("id").in("board_id", Object.values(boards).map((b) => b.id));
  check("no casting vote was written", (castWritten.data ?? []).length === 0);

  // Too big.
  const big = await call({ type: "approval", action: "vote", token: boards.creatorsA.token, assignment_id: ids.ca[0], vote: "up", voted_by: "x".repeat(20000) });
  check("an oversized body is 413", big.status === 413, `status=${big.status}`);

  // Direct table and function access by anon and by a client login.
  const clientSession = await anonClient.auth.signInWithPassword({ email: "client-a@staging.verdanote.test", password });
  if (clientSession.error) throw new Error(`client sign-in failed: ${clientSession.error.message}`);
  const clientHeaders = { Authorization: `Bearer ${clientSession.data.session.access_token}` };
  const asClient = await call({ type: "approval", action: "get" }, clientHeaders);
  check("a client login with no token gets the same 404", asClient.status === 404, `status=${asClient.status}`);
  const asClientWrong = await call({ type: "approval", action: "get", token: token() }, clientHeaders);
  check("a client login with a wrong token gets nothing", asClientWrong.status === 404 && !asClientWrong.text.includes("people"));

  const clientDb = createClient(url, anon, { auth: { persistSession: false }, global: { headers: clientHeaders } });
  for (const [label, c] of [["anonymous", anonClient], ["a client login", clientDb]]) {
    for (const table of ["approval_boards", "approval_votes", "actor_approval_votes", "creator_assignments", "actor_assignments", "public_link_registry", "public_link_rate_limits"]) {
      const all = await c.from(table).select("*").limit(5);
      check(`${label} reads no ${table} rows`, !!all.error || (all.data ?? []).length === 0, `rows=${all.data?.length ?? "error"}`);
    }
    const ins = await c.from("approval_votes").insert({ board_id: boards.creatorsA.id, assignment_id: ids.ca[1], vote: "up" });
    check(`${label} cannot write a vote straight into the table`, !!ins.error, `error=${ins.error?.message ?? "none (accepted)"}`);
    const h = createHash("sha256").update(boards.creatorsA.token).digest("hex");
    const fn = await c.rpc("public_board_get", { p_token_hash: h, p_board_type: "creators", p_count_open: false });
    check(`${label} cannot call public_board_get, even with the right hash`, fn.error?.code === "42501", `code=${fn.error?.code ?? "none"}`);
    const fv = await c.rpc("public_board_vote", { p_token_hash: h, p_board_type: "creators", p_assignment_id: ids.ca[0], p_vote: "down", p_voted_by: null });
    check(`${label} cannot call public_board_vote`, fv.error?.code === "42501", `code=${fv.error?.code ?? "none"}`);
  }
  const still = await admin.from("approval_votes").select("vote").eq("assignment_id", ids.ca[0]);
  check("the own creator's vote is untouched by those attempts", still.data?.[0]?.vote === "up");
} catch (e) {
  console.error(`FAIL  run aborted: ${e.message}`);
  failed++;
} finally {
  await cleanup();
  const left = await admin.from("clients").select("slug").in("slug", [slugA, slugB]);
  check("throwaway rows are deleted", (left.data ?? []).length === 0);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll public link wall checks passed");
process.exit(failed ? 1 : 0);
