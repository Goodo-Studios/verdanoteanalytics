#!/usr/bin/env node
// Client wall check for staging: signs in as a test client and a test staff user
// through the normal login API, then confirms what each can read.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/staging-client-wall-check.mjs
//
// Exit code 1 if any check fails. Refuses to run against production.
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

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

async function signIn(email) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { c, token: data.session.access_token, userId: data.user.id };
}

async function rows(c, table) {
  const { data, error } = await c.from(table).select("*").limit(1000);
  return { n: data?.length ?? 0, error: error?.message };
}

const staff = await signIn("builder@staging.verdanote.test");
const clientA = await signIn("client-a@staging.verdanote.test");
const clientB = await signIn("client-b@staging.verdanote.test");

// Sign-in and role lookup.
const roleOf = async (s) => (await s.c.from("user_roles").select("role")).data?.map((r) => r.role);
check("staff sign-in resolves role builder", (await roleOf(staff))?.[0] === "builder");
check("client A sign-in resolves role client", (await roleOf(clientA))?.[0] === "client");

// A client sees only their own rows in the shared admin tables.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["profiles", "user_roles", "user_accounts"]) {
    const r = await rows(s.c, table);
    check(`${label} reads at most their own row in ${table}`, r.n <= 1, `rows=${r.n}`);
  }
}

// Ad accounts: client A sees only the linked demo account, client B sees none, staff see all.
const accA = await clientA.c.from("ad_accounts").select("id");
check("client A sees only linked accounts", (accA.data ?? []).every((a) => a.id === "act_demo_glowdrip"), `ids=${(accA.data ?? []).map((a) => a.id)}`);
const accB = await clientB.c.from("ad_accounts").select("id");
check("client B sees no accounts", (accB.data ?? []).length === 0, `rows=${accB.data?.length ?? "error"}`);

// Content Pipeline board (pipeline_tasks, fed from ClickUp): a client reads rows of its
// linked ad accounts or of its own clients (get_user_client_slugs), nothing else. The
// ClickUp folder mappings live in source_mappings (staff only, checked further down);
// the old clickup_client_folders table is gone.
const ownSlugs = async (s) => ((await s.c.rpc("get_user_client_slugs")).data ?? []).map((r) => (typeof r === "string" ? r : Object.values(r)[0]));
const pipeA = await clientA.c.from("pipeline_tasks").select("account_id, client_slug");
const slugsA = await ownSlugs(clientA);
check("client A reads pipeline rows of its own account or own clients only", !pipeA.error && (pipeA.data ?? []).every((r) => r.account_id === "act_demo_glowdrip" || slugsA.includes(r.client_slug)), `error=${pipeA.error?.message ?? "none"} accounts=${[...new Set((pipeA.data ?? []).map((r) => r.account_id))]} clients=${[...new Set((pipeA.data ?? []).map((r) => r.client_slug))]} own=${slugsA}`);
const pipeB = await clientB.c.from("pipeline_tasks").select("account_id, client_slug");
check("client B reads no pipeline rows", !pipeB.error && (pipeB.data ?? []).length === 0, `rows=${pipeB.data?.length ?? "error"}`);
const pipeStaff = await staff.c.from("pipeline_tasks").select("client_slug").limit(1);
check("builder can read pipeline rows (client_slug column present)", !pipeStaff.error, `error=${pipeStaff.error?.message ?? "none"}`);
const retired = await staff.c.from("clickup_client_folders").select("folder_id").limit(1);
check("clickup_client_folders is retired", !!retired.error, `error=${retired.error?.message ?? "none (table still answers)"}`);

// Growth Dashboard (growth_dashboard_data): builder only. Clients and the employee read
// nothing and cannot insert. The builder can read. Read-only for the builder here, so the
// check never changes stored numbers.
const employee = await signIn("employee@staging.verdanote.test");
for (const [label, s] of [["client A", clientA], ["client B", clientB], ["employee", employee]]) {
  const g = await s.c.from("growth_dashboard_data").select("key");
  check(`${label} reads no Growth Dashboard rows`, !g.error && (g.data ?? []).length === 0, `error=${g.error?.message ?? "none"} rows=${g.data?.length ?? "error"}`);
  const ins = await s.c.from("growth_dashboard_data").insert({ key: `wall-check-${label.replace(/\s/g, "-")}`, data: {} });
  check(`${label} cannot write Growth Dashboard rows`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
}
const gStaff = await staff.c.from("growth_dashboard_data").select("key");
check("builder can read Growth Dashboard rows", !gStaff.error, `error=${gStaff.error?.message ?? "none"} rows=${gStaff.data?.length ?? "error"}`);

// Goodo OS client model (docs/goodo-os-foundations.md). engagements is client-readable for
// the client's own clients only (get_user_client_slugs). The other five tables are staff
// only (goodo_os_workspace_users builder only); a user may read its own client_members rows.
const slugsOf = async (s) => ((await s.c.rpc("get_user_client_slugs")).data ?? []).map((r) => (typeof r === "string" ? r : Object.values(r)[0]));
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const mine = await slugsOf(s);
  const e = await s.c.from("engagements").select("client_slug");
  check(`${label} reads engagements of its own clients only`, !e.error && (e.data ?? []).every((r) => mine.includes(r.client_slug)), `error=${e.error?.message ?? "none"} clients=${[...new Set((e.data ?? []).map((r) => r.client_slug))]} own=${mine}`);
  for (const table of ["engagement_notes", "source_mappings", "client_ad_accounts", "goodo_os_workspace_users"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const m = await s.c.from("client_members").select("user_id");
  check(`${label} reads only its own client_members rows`, !m.error && (m.data ?? []).every((r) => r.user_id === s.userId), `rows=${m.data?.length ?? "error"}`);
  const ins = await s.c.from("engagements").insert({ client_slug: "wall-check-none", cycle_number: 1 });
  check(`${label} cannot write engagements`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
}
check("client B belongs to no client", (await slugsOf(clientB)).length === 0);
for (const table of ["engagements", "engagement_notes", "source_mappings", "client_ad_accounts", "client_members"]) {
  const r = await staff.c.from(table).select("*").limit(1);
  check(`builder can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const gosEmployee = await employee.c.from("goodo_os_workspace_users").select("id");
check("employee reads no Goodo OS users (builder only)", !gosEmployee.error && (gosEmployee.data ?? []).length === 0, `rows=${gosEmployee.data?.length ?? "error"}`);

// Job queue and reminders (migration 20261109000005): staff only. Clients read nothing,
// cannot write, and cannot replay a job. The employee reads but cannot add a Slack
// destination (builder only). Read-only for staff here.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["durable_jobs", "job_audit", "slack_destinations", "reminders"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const insJob = await s.c.from("durable_jobs").insert({ kind: "wall.check", dedupe_key: `wall-check-${label}` });
  check(`${label} cannot write durable_jobs`, !!insJob.error, `error=${insJob.error?.message ?? "none (write accepted)"}`);
  const replay = await s.c.rpc("replay_job", { p_job_id: "00000000-0000-4000-8000-000000000000" });
  check(`${label} is refused replay_job`, replay.error?.code === "42501", `code=${replay.error?.code ?? "none"}`);
}
for (const table of ["durable_jobs", "job_audit", "slack_destinations", "reminders"]) {
  const r = await staff.c.from(table).select("*").limit(1);
  check(`builder can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const destEmployee = await employee.c.from("slack_destinations").insert({ label: "wall check", channel_id: "C0WALLCHECK", purpose: "internal" });
check("employee cannot add a Slack destination (builder only)", !!destEmployee.error, `error=${destEmployee.error?.message ?? "none (write accepted)"}`);

// Outbound switches (migration 20261109000006): clients read nothing; nobody but a builder
// can turn a switch on. Staging has no switch rows. Nothing here writes for the builder.
for (const [label, s] of [["client A", clientA], ["client B", clientB], ["employee", employee]]) {
  const ins = await s.c.from("outbound_switches").insert({ name: "slack_sends", enabled: true });
  check(`${label} cannot turn on an outbound switch`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
}
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const r = await s.c.from("outbound_switches").select("name");
  check(`${label} reads no outbound switches`, !r.error && (r.data ?? []).length === 0, `rows=${r.data?.length ?? "error"}`);
}
const switches = await staff.c.from("outbound_switches").select("name, enabled");
check("staging has no outbound switch turned on", !switches.error && (switches.data ?? []).every((r) => r.enabled !== true), `error=${switches.error?.message ?? "none"} rows=${switches.data?.length ?? "error"}`);

// Staff-only server call: a client token must be refused.
const call = async (token) =>
  fetch(`${url}/functions/v1/user-management`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
const asClient = await call(clientA.token);
check("client token is refused by user-management", [401, 403].includes(asClient.status), `status=${asClient.status}`);
const asStaff = await call(staff.token);
check("staff token is accepted by user-management", asStaff.status < 400, `status=${asStaff.status}`);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll client wall checks passed");
process.exit(failed ? 1 : 0);
