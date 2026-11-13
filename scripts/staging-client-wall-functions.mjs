#!/usr/bin/env node
// Client wall check for server functions, against STAGING only.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/staging-client-wall-functions.mjs
//
// Signs in as the test client and calls every function listed in
// supabase/function-access.json that must refuse clients (class staff, service,
// secret). Each call has to come back 401 or 403. A function that is missing,
// broken (404, 5xx) or lets the client through fails the run. Also checks:
//   - a client linked to the demo account cannot read it through the
//     account-scoped functions that take an account id, when signed in as the
//     client with no linked accounts (client B);
//   - positive controls, so a gate that refuses everybody cannot pass: the
//     builder is accepted by builder functions, the employee by employee
//     functions and refused by builder-only ones.
//   - the accounts list a client gets carries only the client-safe fields, and
//     staff still get the full row.
//
//   - the client progress feed (P9): no token, wrong token and every login are refused by
//     ingest-client-progress, only a builder manages ingest tokens, a revoked token is refused.
//
// Exit code 1 if anything fails. Refuses to run against production.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "gwyxaqoaldnaavkjqquv";
const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_SUPABASE_ANON_KEY;
const password = process.env.STAGING_TEST_PASSWORD;
if (!url || !anon || !password) {
  console.error("Set STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY and STAGING_TEST_PASSWORD.");
  process.exit(1);
}
if (url.includes(PROD_REF)) {
  console.error("Refusing to run: that URL is the production project.");
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(new URL("../supabase/function-access.json", import.meta.url), "utf8"),
).functions;

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

async function signIn(email) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return data.session.access_token;
}

async function call(name, token, { method = "POST", body = {}, query = "" } = {}) {
  const res = await fetch(`${url}/functions/v1/${name}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

const clientA = await signIn("client-a@staging.verdanote.test");
const clientB = await signIn("client-b@staging.verdanote.test");
const builder = await signIn("builder@staging.verdanote.test");
const employee = await signIn("employee@staging.verdanote.test");

const refused = (s) => s === 401 || s === 403;

// 1. Every function that must refuse clients.
const mustRefuse = Object.entries(manifest).filter(([, v]) => ["staff", "service", "secret"].includes(v.class));
for (const [name, entry] of mustRefuse) {
  const status = await call(name, clientA, entry.probe ?? {});
  // Secret and signature gated functions reject a request with no valid secret or
  // signature as 400 (malformed) or 401. Either way no work is done for the caller.
  const ok = entry.class === "secret" ? refused(status) || status === 400 : refused(status);
  check(`client token refused by ${name} (${entry.class})`, ok, `status=${status}`);
}

// 2. Account-scoped functions: a client with no linked accounts is refused for the demo account.
for (const [name, entry] of Object.entries(manifest)) {
  if (!entry.crossAccountProbe) continue;
  const status = await call(name, clientB, entry.crossAccountProbe);
  check(`client B refused demo account by ${name}`, status === 403, `status=${status}`);
}

// 3. Positive controls on read-only calls.
const controls = [
  ["builder accepted by user-management", "user-management", builder, { method: "GET" }, (s) => s < 400],
  ["builder accepted by settings", "settings", builder, { method: "GET" }, (s) => s < 400],
  ["employee accepted by accounts", "accounts", employee, { method: "GET" }, (s) => s < 400],
  ["employee refused by user-management (builder only)", "user-management", employee, { method: "GET" }, refused],
  ["employee refused by settings (builder only)", "settings", employee, { method: "GET" }, refused],
  ["client A accepted by accounts (its own list)", "accounts", clientA, { method: "GET" }, (s) => s < 400],
  // Staging has no FIREFLIES_API_KEY: staff pass the gate and the function fails closed with 503.
  ["employee passes the fireflies-transcript gate and it fails closed without a key", "fireflies-transcript", employee, { body: { transcript_id: "wall_probe" } }, (s) => s === 503],
  // Staging has no CLICKUP_API_TOKEN: staff pass the gate and the function fails closed with 503, writing nothing.
  ["employee passes the push-brief-to-clickup gate and it fails closed without a token", "push-brief-to-clickup", employee, { body: { action: "list", client_slug: "wall_probe" } }, (s) => s === 503],
  ["builder passes the push-brief-to-clickup gate and it fails closed without a token", "push-brief-to-clickup", builder, { body: { action: "list", client_slug: "wall_probe" } }, (s) => s === 503],
  ["client B refused by push-brief-to-clickup", "push-brief-to-clickup", clientB, { body: { action: "list", client_slug: "wall_probe" } }, refused],
  // Staging has no CLICKUP_API_TOKEN: the builder passes the gate and clickup-folders fails closed with 503
  // and no request. The employee is refused (builder only) and the client is refused.
  ["builder passes the clickup-folders gate and it fails closed without a token", "clickup-folders", builder, { method: "GET" }, (s) => s === 503],
  ["employee refused by clickup-folders (builder only)", "clickup-folders", employee, { method: "GET" }, refused],
  ["client B refused by clickup-folders", "clickup-folders", clientB, { method: "GET" }, refused],
  // Invite by email (phase 4 PR 2). Nothing is ever sent from this check: the builder reaches only the
  // validation path (a bad email, answered 400 before any invite) and the not-found path (an id that
  // matches nothing, answered 404 before any email). Employees and clients are refused at the gate.
  ["builder passes the invite-user gate and a bad email is refused before any invite", "invite-user", builder, { body: { action: "invite", email: "not-an-email", display_name: "Wall", role: "employee" } }, (s) => s === 400],
  ["builder passes the invite-user gate and an unknown invite is not found, nothing resent", "invite-user", builder, { body: { action: "resend", invite_id: "00000000-0000-4000-8000-000000000000" } }, (s) => s === 404],
  ["builder passes the invite-user gate and an unknown invite is not found, nothing revoked", "invite-user", builder, { body: { action: "revoke", invite_id: "00000000-0000-4000-8000-000000000000" } }, (s) => s === 404],
  ["employee refused by invite-user (builder only)", "invite-user", employee, { body: { action: "invite", email: "not-an-email", display_name: "Wall", role: "employee" } }, refused],
  ["client B refused by invite-user", "invite-user", clientB, { body: { action: "invite", email: "not-an-email", display_name: "Wall", role: "employee" } }, refused],
  // Integration health is read-only and calls nothing outside, so staff get 200.
  ["employee accepted by integration-health", "integration-health", employee, { method: "GET" }, (s) => s === 200],
  ["builder accepted by integration-health", "integration-health", builder, { method: "GET" }, (s) => s === 200],
  ["client B refused by integration-health", "integration-health", clientB, { method: "GET" }, refused],
  // Alerts (step 4d): the evaluate action is builder only; in staging it queues nothing (not production).
  ["client B refused by integration-health evaluate", "integration-health", clientB, { body: { action: "evaluate" } }, refused],
  ["employee refused by integration-health evaluate (builder only)", "integration-health", employee, { body: { action: "evaluate" } }, refused],
  ["builder accepted by integration-health evaluate", "integration-health", builder, { body: { action: "evaluate" } }, (s) => s === 200],
  // Staging has no FIREFLIES_API_KEY or ANTHROPIC_API_KEY: staff pass the gate and meeting-recaps fails closed with 503.
  ["employee passes the meeting-recaps gate and it fails closed without keys", "meeting-recaps", employee, { body: { client_slug: "wall_probe", transcript_id: "wall_probe" } }, (s) => s === 503],
  ["builder passes the meeting-recaps gate and it fails closed without keys", "meeting-recaps", builder, { body: { client_slug: "wall_probe", transcript_id: "wall_probe" } }, (s) => s === 503],
  // OS-026: brain-ask answers staff only. A client never gets a Brain answer.
  ["employee accepted by brain-ask", "brain-ask", employee, { body: { question: "wall probe question" } }, (s) => s === 200],
  ["client B refused by brain-ask", "brain-ask", clientB, { body: { question: "wall probe question" } }, refused],
  ["client B refused by meeting-recaps", "meeting-recaps", clientB, { body: { client_slug: "wall_probe", transcript_id: "wall_probe" } }, refused],
  // Staging has no ANTHROPIC_API_KEY: staff pass the gate and agent-evaluations fails closed with 503 before any read.
  ["employee passes the agent-evaluations gate and it fails closed without a key", "agent-evaluations", employee, { body: { agent_key: "meeting-recaps" } }, (s) => s === 503],
  ["builder passes the agent-evaluations gate and it fails closed without a key", "agent-evaluations", builder, { body: { agent_key: "meeting-recaps" } }, (s) => s === 503],
  ["client B refused by agent-evaluations", "agent-evaluations", clientB, { body: { agent_key: "meeting-recaps" } }, refused],
  // Client decisions (phase 5b). client-decision is for client logins only: staff and a login with no clients are
  // refused, bad input is refused before anything is recorded. Nothing is written by these calls (the writing
  // checks are in staging-client-wall-check.mjs).
  ["builder refused by client-decision", "client-decision", builder, { body: { taskId: "wall-probe", decision: "approved" } }, (s) => s === 403],
  ["employee refused by client-decision", "client-decision", employee, { body: { taskId: "wall-probe", decision: "approved" } }, (s) => s === 403],
  ["client B (no clients) refused by client-decision", "client-decision", clientB, { body: { taskId: "wall-probe", decision: "approved" } }, (s) => s === 403],
  ["client A is refused a bad task id by client-decision", "client-decision", clientA, { body: { taskId: "not valid!", decision: "approved" } }, (s) => s === 400],
  ["client A is refused a change request with no note by client-decision", "client-decision", clientA, { body: { taskId: "wall-probe", decision: "changes_requested" } }, (s) => s === 400],
  ["client A gets not found for a card that is not its client's", "client-decision", clientA, { body: { taskId: "wall-probe-no-such-card", decision: "approved" } }, (s) => s === 404],
];
for (const [label, name, token, opts, ok] of controls) {
  const status = await call(name, token, opts);
  check(label, ok(status), `status=${status}`);
}

// 4. Ad code counter (Ad Name Generator): clients are refused by peek_ad_code and
//    claim_ad_code; builder and employee may peek. Nobody claims here, so no staging
//    code is spent.
const rpcStatus = async (name, token) => {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon, "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  return { status: res.status, text };
};
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const fn of ["peek_ad_code", "claim_ad_code"]) {
    const r = await rpcStatus(fn, s);
    check(`${label} refused by ${fn}`, refused(r.status), `status=${r.status}`);
  }
}
for (const [label, s] of [["builder", builder], ["employee", employee]]) {
  const r = await rpcStatus("peek_ad_code", s);
  check(`${label} can peek the next ad code`, r.status === 200 && Number(r.text) > 0, `status=${r.status}`);
}

// 5. Field check on the accounts list. A client gets only the allow-listed columns of its
//    linked accounts; any other field fails the run. Copy of CLIENT_ACCOUNT_FIELDS and
//    STAFF_ONLY_ACCOUNT_FIELDS in supabase/functions/_shared/client-account-fields.ts:
//    change both together. Staff still get the full row (positive control).
const CLIENT_ACCOUNT_FIELDS = [
  "id", "name", "created_at", "last_synced_at", "optimization_goal",
  "winner_kpi", "winner_kpi_direction", "winner_kpi_threshold", "winner_roas_threshold",
  "iteration_spend_threshold",
];
const STAFF_ONLY_ACCOUNT_FIELDS = [
  "client_responsiveness", "client_start_date", "attribution_notes", "attribution_model",
  "creative_analysis_prompt", "insights_prompt", "company_description", "company_pdf_url",
  "kill_threshold", "scale_threshold", "kill_scale_kpi", "kill_scale_kpi_direction",
  "tiktok_access_token", "tiktok_advertiser_id", "target_roas", "target_cpa",
  "target_monthly_spend", "primary_kpi", "secondary_kpis", "industry_category",
];
const accountsJson = async (token) => {
  const res = await fetch(`${url}/functions/v1/accounts`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
};
const listA = await accountsJson(clientA);
const rowsA = Array.isArray(listA.body) ? listA.body : [];
check("client A gets its linked account from the accounts function", listA.status === 200 && rowsA.some((r) => r.id === "act_demo_glowdrip"), `status=${listA.status} ids=${rowsA.map((r) => r.id)}`);
const extra = [...new Set(rowsA.flatMap((r) => Object.keys(r).filter((k) => !CLIENT_ACCOUNT_FIELDS.includes(k))))];
check("accounts function returns only allow-listed fields to client A", rowsA.length > 0 && extra.length === 0, `extra=${extra.join(",") || "none"}`);
const leaked = [...new Set(rowsA.flatMap((r) => STAFF_ONLY_ACCOUNT_FIELDS.filter((k) => k in r)))];
check("accounts function returns no staff-only field to client A", rowsA.length > 0 && leaked.length === 0, `leaked=${leaked.join(",") || "none"}`);
const listB = await accountsJson(clientB);
check("client B gets an empty list from the accounts function", listB.status === 200 && Array.isArray(listB.body) && listB.body.length === 0, `status=${listB.status} rows=${Array.isArray(listB.body) ? listB.body.length : "not a list"}`);
const listStaff = await accountsJson(builder);
const rowsStaff = Array.isArray(listStaff.body) ? listStaff.body : [];
check("builder still gets full account rows from the accounts function", listStaff.status === 200 && rowsStaff.some((r) => r.id === "act_demo_glowdrip" && "kill_threshold" in r), `status=${listStaff.status} rows=${rowsStaff.length}`);

// 6. Board sync (phase 5). sync-clickup-tasks is for the schedule only (service role): no login of any
//    role gets in, so nobody can run a sync, or its sweep of the delivered list, from the browser. The
//    missing-token state is named the same in integration-health as in the sync ("clickup.no_token"):
//    staging has no token, so staff must see ClickUp as not connected under that name, with the board
//    rows clients still see reported beside it. (The sync's own 503 answer for a missing token is
//    covered by supabase/functions/sync-clickup-tasks/index.test.ts; it is not called here because
//    with a token set it would run a real sync.)
for (const [label, token] of [["client A", clientA], ["client B", clientB], ["employee", employee], ["builder", builder]]) {
  const status = await call("sync-clickup-tasks", token, {});
  check(`${label} refused by sync-clickup-tasks (service role only)`, refused(status), `status=${status}`);
}
const healthRes = await fetch(`${url}/functions/v1/integration-health`, {
  method: "GET",
  headers: { Authorization: `Bearer ${builder}`, apikey: anon },
});
let health = null;
try { health = await healthRes.json(); } catch { /* not JSON */ }
const clickupHealth = (health?.connectors ?? []).find((c) => c.key === "clickup");
check("integration-health reports ClickUp", healthRes.status === 200 && !!clickupHealth, `status=${healthRes.status}`);
check(
  "a ClickUp connector with no token is reported not connected under the name the sync logs, with the board rows kept",
  !!clickupHealth && (clickupHealth.connected ? true : clickupHealth.state === "not_connected" && (clickupHealth.notes ?? []).includes("clickup.no_token") && typeof clickupHealth.details?.boardRows === "number"),
  `connected=${clickupHealth?.connected} state=${clickupHealth?.state} notes=${(clickupHealth?.notes ?? []).join(",")} boardRows=${clickupHealth?.details?.boardRows}`,
);

// 7. Media storage secrets on Integration health (phase 6b). Staff see the two vault secrets the
//    approve-with-files and delete-location paths need, by name, as present, missing or unknown,
//    and nothing else: no value, and no other key. The client token is already refused by the
//    function above. The database function behind it is service role only (see
//    staging-function-grants-check.mjs).
const vaultList = Array.isArray(health?.vaultSecrets) ? health.vaultSecrets : [];
check(
  "integration-health lists both storage signing secrets by name",
  vaultList.map((s) => s.name).sort().join() === "storage_signing_project_url,storage_signing_service_role_key" && vaultList.every((s) => s.present === true || s.present === false || s.present === null),
  `names=${vaultList.map((s) => `${s.name}:${s.present}`).join(" ")}`,
);
check(
  "integration-health carries only the name, whether it is set and what it is for, never a value",
  vaultList.length === 2 && vaultList.every((s) => Object.keys(s).sort().join() === "name,needed_for,present"),
  `keys=${[...new Set(vaultList.flatMap((s) => Object.keys(s)))].join(",")}`,
);
for (const [label, token] of [["employee", employee], ["builder", builder]]) {
  const res = await fetch(`${url}/functions/v1/integration-health`, { method: "GET", headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  check(`${label} sees the storage signing secrets on Integration health`, res.status === 200 && Array.isArray(body?.vaultSecrets) && body.vaultSecrets.length === 2, `status=${res.status}`);
}

// 8. Client progress feed (P9). ingest-client-progress takes a dedicated ingest token, not a login.
//    - no token, a wrong token and a login JWT of every role are refused with 401;
//    - clients and the employee cannot create, list or revoke tokens and cannot read the audit, the builder can;
//    - a token the builder makes works (a probe with an unknown client slug writes nothing but an audit row),
//      and the same token is refused with 401 once the builder revokes it;
//    - nobody reads ingest_tokens or ingest_audit through the table API, the builder included.
//    The throwaway token lives in memory only: it is never printed or stored, and it is revoked at the end.
const asUser = (jwt) => createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
const ingest = async (token, body = { source: "wall-check", clients: [{ slug: "wall-probe-unknown", pct_complete: 1 }] }) => {
  const headers = { "Content-Type": "application/json", apikey: anon };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${url}/functions/v1/ingest-client-progress`, { method: "POST", headers, body: JSON.stringify(body) });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body: parsed };
};
check("ingest-client-progress refuses a call with no token", (await ingest(null)).status === 401);
check("ingest-client-progress refuses a wrong but well-formed token", (await ingest(`vni_${"0".repeat(64)}`)).status === 401);
for (const [label, jwt] of [["client A", clientA], ["client B", clientB], ["employee", employee], ["builder", builder]]) {
  check(`ingest-client-progress refuses the ${label} login token`, (await ingest(jwt)).status === 401);
}
for (const [label, jwt] of [["client A", clientA], ["employee", employee]]) {
  const c = asUser(jwt);
  const created = await c.rpc("create_ingest_token", { p_name: "wall-check-refused" });
  check(`${label} cannot create an ingest token`, created.error?.code === "42501" && !created.data, `code=${created.error?.code ?? "none"}`);
  const listed = await c.rpc("list_ingest_tokens");
  check(`${label} cannot list ingest tokens`, listed.error?.code === "42501", `code=${listed.error?.code ?? "none"}`);
  const audit = await c.rpc("list_ingest_audit", { p_limit: 5 });
  check(`${label} cannot read the ingest audit`, audit.error?.code === "42501", `code=${audit.error?.code ?? "none"}`);
  const revoked = await c.rpc("revoke_ingest_token", { p_id: "00000000-0000-4000-8000-000000000000" });
  check(`${label} cannot revoke an ingest token`, revoked.error?.code === "42501", `code=${revoked.error?.code ?? "none"}`);
  const write = await c.rpc("apply_client_progress", { p_token_id: "00000000-0000-4000-8000-000000000000", p_source: "wall", p_items: [] });
  check(`${label} cannot call apply_client_progress`, write.error?.code === "42501", `code=${write.error?.code ?? "none"}`);
}
for (const [label, jwt] of [["client A", clientA], ["employee", employee], ["builder", builder]]) {
  const c = asUser(jwt);
  for (const table of ["ingest_tokens", "ingest_audit"]) {
    const r = await c.from(table).select("*").limit(5);
    check(`${label} reads no ${table} rows through the table API`, !!r.error || (r.data ?? []).length === 0, `error=${r.error?.code ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
}
{
  const b = asUser(builder);
  const made = await b.rpc("create_ingest_token", { p_name: `wall-check-${Date.now()}` });
  const token = made.data?.token;
  const tokenId = made.data?.id;
  check("builder creates an ingest token and gets it once", !made.error && /^vni_[0-9a-f]{64}$/.test(token ?? ""), `error=${made.error?.code ?? "none"}`);
  try {
    if (token) {
      const listed = await b.rpc("list_ingest_tokens");
      const row = (listed.data ?? []).find((r) => r.id === tokenId);
      check("builder lists the new token without any hash or raw value", !!row && !("token_hash" in row) && !("token" in row), `keys=${row ? Object.keys(row).join(",") : "missing"}`);
      const ok = await ingest(token);
      check(
        "a live ingest token is accepted; an unknown client is refused per entry and nothing is created",
        ok.status === 200 && ok.body?.applied === 0 && ok.body?.rejected?.[0]?.reason === "unknown_client",
        `status=${ok.status} applied=${ok.body?.applied} reason=${ok.body?.rejected?.[0]?.reason}`,
      );
      const bad = await ingest(token, { source: "wall-check", clients: [{ slug: "wall-probe-unknown", pct_complete: 140, active: false }] });
      check("a bad shape is refused with 400 and the error does not echo the value", bad.status === 400 && !JSON.stringify(bad.body).includes("140"), `status=${bad.status}`);
      const audit = await b.rpc("list_ingest_audit", { p_limit: 5 });
      check("the builder sees the calls in the audit", !audit.error && (audit.data ?? []).some((r) => r.source === "wall-check"), `error=${audit.error?.code ?? "none"} rows=${audit.data?.length ?? 0}`);
    }
  } finally {
    if (tokenId) {
      const rev = await b.rpc("revoke_ingest_token", { p_id: tokenId });
      check("builder revokes the token", !rev.error, `error=${rev.error?.code ?? "none"}`);
    }
  }
  if (token) check("a revoked ingest token is refused with 401", (await ingest(token)).status === 401);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll server function wall checks passed");
process.exit(failed ? 1 : 0);
