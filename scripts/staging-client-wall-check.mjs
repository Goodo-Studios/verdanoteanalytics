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
  return { c, email, token: data.session.access_token, userId: data.user.id };
}

// Logins last one hour and a full run can take longer, so the checks that send a token to a server
// function sign in again first. Without this a slow run fails those checks with "Invalid JWT", and the
// "client token is refused" checks would pass for the wrong reason (an expired token, not the wall).
async function refreshLogins(...sessions) {
  for (const s of sessions) Object.assign(s, await signIn(s.email));
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

// Ad accounts (migration 20261111060001): no client reads ad_accounts directly, not even
// its own linked account, because that returns staff-only columns. Clients get their
// accounts from the accounts function (field check in staging-client-wall-functions.mjs).
// Staff still read the table directly.
const accA = await clientA.c.from("ad_accounts").select("*");
check("client A reads no ad_accounts rows directly (own account included)", !accA.error && (accA.data ?? []).length === 0, `error=${accA.error?.message ?? "none"} rows=${accA.data?.length ?? "error"}`);
const accB = await clientB.c.from("ad_accounts").select("id");
check("client B sees no accounts", (accB.data ?? []).length === 0, `rows=${accB.data?.length ?? "error"}`);
const accStaff = await staff.c.from("ad_accounts").select("id, kill_threshold").eq("id", "act_demo_glowdrip");
check("builder still reads ad_accounts directly, staff columns included", !accStaff.error && (accStaff.data ?? []).length === 1, `error=${accStaff.error?.message ?? "none"} rows=${accStaff.data?.length ?? "error"}`);

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
// Operations page (migration 20261111000001, step 4d): cancel_queued_job is staff only.
// Clients are refused before any lookup; the employee passes the staff check (unknown job)
// and loads the page query (job columns with the job_audit embed, never the payload).
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const r = await s.c.rpc("cancel_queued_job", { p_job_id: "00000000-0000-4000-8000-000000000000", p_reason: "wall check cancel" });
  check(`${label} is refused cancel_queued_job`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
}
const opCancel = await employee.c.rpc("cancel_queued_job", { p_job_id: "00000000-0000-4000-8000-000000000000", p_reason: "wall check cancel" });
check("employee passes the staff check in cancel_queued_job", opCancel.error?.code === "P0002", `code=${opCancel.error?.code ?? "none"}`);
const opPage = await employee.c.from("durable_jobs").select("id, kind, state, client_slug, engagement_id, attempts, max_attempts, available_at, lease_until, fence, send_started_fence, last_error, receipt, created_at, updated_at, job_audit!job_audit_job_id_fkey(id, action, fence, actor, detail, created_at)").order("updated_at", { ascending: false }).limit(100);
check("employee loads the operations page query", !opPage.error, `error=${opPage.error?.code ?? ""} ${opPage.error?.message ?? "none"}`);
const opPageA = await clientA.c.from("durable_jobs").select("id, job_audit!job_audit_job_id_fkey(id)").limit(100);
check("client A loads no rows with the operations page query", !opPageA.error && (opPageA.data ?? []).length === 0, `error=${opPageA.error?.message ?? "none"} rows=${opPageA.data?.length ?? "error"}`);
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

// Meeting recaps (migration 20261110000002): staff only. Clients read nothing and cannot
// write a review; the employee reads. Nothing here writes for staff.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["meeting_recaps", "meeting_recap_items", "meeting_recap_reviews"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("meeting_recap_reviews").insert({ item_id: "00000000-0000-4000-8000-000000000000", decision: "confirmed", confirmed_item_hash: "0".repeat(64), note: "wall check" });
  check(`${label} cannot write a meeting recap review`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  const rec = await s.c.rpc("record_meeting_recap", { p_recap: {}, p_items: [] });
  check(`${label} is refused record_meeting_recap`, rec.error?.code === "42501", `code=${rec.error?.code ?? "none"}`);
}
for (const table of ["meeting_recaps", "meeting_recap_items", "meeting_recap_reviews"]) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}

// Knowledge pages (migration 20261110000003): staff only. Clients read nothing, cannot
// write directly and are refused by every checked function. Nothing here writes for staff.
const knowledgeTables = ["knowledge_sources", "knowledge_source_versions", "knowledge_corrections", "knowledge_correction_reviews"];
const ZERO = "00000000-0000-4000-8000-000000000000";
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of knowledgeTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("knowledge_sources").insert({ title: "wall check", classification: "staff", release_scope: "global", created_by: s.userId });
  check(`${label} cannot write knowledge_sources`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_knowledge_source", { p_title: "wall", p_body: "wall", p_classification: "staff", p_release_scope: "global" }],
    ["submit_knowledge_correction", { p_source_id: ZERO, p_source_version: 1, p_proposed_body: "x", p_reason: "x", p_classification: "content" }],
    ["review_knowledge_correction", { p_correction_id: ZERO, p_decision: "accepted", p_reason: "x" }],
    ["publish_knowledge_correction", { p_correction_id: ZERO }],
    ["rollback_knowledge_source", { p_source_id: ZERO, p_to_version: 1, p_expected_version: 2, p_reason: "x" }],
    ["edit_knowledge_source", { p_source_id: ZERO, p_body: "x", p_expected_version: 1 }],
    ["edit_brain_page", { p_page_id: ZERO, p_body_md: "x", p_expected_updated_at: "2026-01-01T00:00:00Z" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of knowledgeTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
// The employee passes the staff check and is refused only because the source does not exist.
const kEmployee = await employee.c.rpc("submit_knowledge_correction", { p_source_id: ZERO, p_source_version: 1, p_proposed_body: "x", p_reason: "x", p_classification: "content" });
check("employee passes the staff check in submit_knowledge_correction", kEmployee.error?.code === "P0002", `code=${kEmployee.error?.code ?? "none"}`);
const kCreate = await employee.c.rpc("create_knowledge_source", { p_title: "wall", p_body: "wall", p_classification: "staff", p_release_scope: "global" });
check("employee is refused create_knowledge_source (builder only)", kCreate.error?.code === "42501", `code=${kCreate.error?.code ?? "none"}`);

// Engagement setup (migration 20261110120001, step 4b): staff only. Clients read none of the
// four tables, cannot write them and are refused every checked function. Nothing here
// writes for staff: the employee calls fail on the role check or on a missing row.
const engagementTables = ["engagement_templates", "engagement_terms", "engagement_milestones", "engagement_closeouts"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of engagementTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("engagement_closeouts").insert({ engagement_id: ZERO, client_slug: "x", version: 1, evidence_limit: "wall", authored_by: s.userId });
  check(`${label} cannot write engagement_closeouts`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["save_engagement_template", { p_template_key: "wall", p_client_slug: null, p_expected_version: 0, p_template_type: "custom", p_milestone_template: ["kickoff"], p_agreed_deliverables: [], p_source_reference: "wall" }],
    ["create_engagement_from_template", { p_client_slug: "wall", p_template_id: ZERO }],
    ["record_engagement_kickoff", { p_engagement_id: ZERO, p_start_date: "2026-01-01" }],
    ["save_engagement_closeout", { p_engagement_id: ZERO, p_expected_version: 0, p_evidence_limit: "wall" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of engagementTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const eKickoff = await employee.c.rpc("record_engagement_kickoff", { p_engagement_id: ZERO, p_start_date: "2026-01-01" });
check("employee passes the staff check in record_engagement_kickoff", eKickoff.error?.code === "P0002", `code=${eKickoff.error?.code ?? "none"}`);
const eTemplate = await employee.c.rpc("save_engagement_template", { p_template_key: "wall", p_client_slug: null, p_expected_version: 0, p_template_type: "custom", p_milestone_template: ["kickoff"], p_agreed_deliverables: [], p_source_reference: "wall" });
check("employee is refused save_engagement_template (builder only)", eTemplate.error?.code === "42501", `code=${eTemplate.error?.code ?? "none"}`);

// Deliverables and approvals (migration 20261110120002, step 4b): staff only. Clients read none
// of the seven tables, cannot write them and are refused every checked function.
const deliverableTables = ["engagement_deliverables", "engagement_deliverable_revisions", "engagement_deliverable_decisions",
  "engagement_deliverable_round_exceptions", "approval_subjects", "approval_subject_versions", "approval_subject_decisions"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of deliverableTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("approval_subject_decisions").insert({ subject_id: ZERO, version: 1, decision: "approved", channel: "call", source_note: "wall", recorded_by: s.userId });
  check(`${label} cannot write approval_subject_decisions`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["add_engagement_deliverable", { p_engagement_id: ZERO, p_title: "wall", p_asset_kind: "video" }],
    ["add_deliverable_revision", { p_deliverable_id: ZERO, p_expected_revision: 0, p_review_url: "https://example.test/wall" }],
    ["record_deliverable_client_decision", { p_deliverable_id: ZERO, p_revision: 1, p_decision: "approved", p_channel: "call", p_source_note: "wall" }],
    ["decide_deliverable_round_exception", { p_exception_id: ZERO, p_approve: true, p_reason: "wall" }],
    ["withdraw_engagement_deliverable", { p_deliverable_id: ZERO }],
    ["create_approval_subject", { p_engagement_id: ZERO, p_subject_kind: "idea", p_title: "wall" }],
    ["save_approval_draft", { p_subject_id: ZERO, p_expected_version: 0, p_body: "wall" }],
    ["publish_approval_version", { p_subject_id: ZERO, p_version: 1 }],
    ["record_approval_decision", { p_subject_id: ZERO, p_version: 1, p_decision: "approved", p_channel: "call", p_source_note: "wall" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of deliverableTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const dRevision = await employee.c.rpc("add_deliverable_revision", { p_deliverable_id: ZERO, p_expected_revision: 0, p_review_url: "https://example.test/wall" });
check("employee passes the staff check in add_deliverable_revision", dRevision.error?.code === "P0002", `code=${dRevision.error?.code ?? "none"}`);
const dException = await employee.c.rpc("decide_deliverable_round_exception", { p_exception_id: ZERO, p_approve: true, p_reason: "wall" });
check("employee is refused decide_deliverable_round_exception (builder only)", dException.error?.code === "42501", `code=${dException.error?.code ?? "none"}`);

// Old dashboard batch 1 (step 5a: Overview, Client Detail, Creator pipeline, Follow-ups).
// The five tables those pages read are staff only, even for a client login linked to the
// client (client A owns the demo account, which the made-up seed links to demo-glowdrip).
// Clients cannot write and are refused the client functions.
const batch1Tables = ["clients", "deliverables", "creator_assignments", "dashboard_creators", "app_users"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of batch1Tables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const insA = await s.c.from("creator_assignments").insert({ creator_id: ZERO, client_slug: "demo-glowdrip" });
  check(`${label} cannot write creator_assignments`, !!insA.error, `error=${insA.error?.message ?? "none (write accepted)"}`);
  const insC = await s.c.from("dashboard_creators").insert({ name: "wall check" });
  check(`${label} cannot write dashboard_creators`, !!insC.error, `error=${insC.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["set_client_details", { p_slug: "demo-northwind", p_strategist: "wall" }],
    ["set_client_scope", { p_slug: "demo-northwind", p_scope: "wall" }],
    ["set_client_active", { p_slug: "demo-northwind", p_active: false }],
    ["update_client", { p_slug: "demo-northwind", p_name: "wall" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of batch1Tables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const b1Employee = await employee.c.rpc("set_client_details", { p_slug: "demo-northwind", p_strategist: "wall" });
check("employee is refused set_client_details (builder only)", b1Employee.error?.code === "42501", `code=${b1Employee.error?.code ?? "none"}`);

// Old dashboard batch 2, Creators (step 5b): the creator page also reads the creator media
// tables and the creator media buckets. Clients read none of it, cannot write it and cannot
// sign a link to a creator headshot, even one that exists.
const creatorMediaTables = ["creator_videos", "creator_photos", "creator_filming_locations"];
// A headshot file that exists: the employee must be able to sign it, so it doubles as the probe.
let headshotPath = null;
const { data: headshotRows } = await employee.c.from("dashboard_creators").select("headshot_path").not("headshot_path", "is", null).limit(20);
for (const r of headshotRows ?? []) {
  const signed = await employee.c.storage.from("creator-headshots").createSignedUrl(r.headshot_path, 60);
  if (!signed.error && signed.data?.signedUrl) { headshotPath = r.headshot_path; break; }
}
check("employee can sign a creator headshot link", headshotPath !== null, headshotPath ? "" : "no headshot of the first 20 could be signed");
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of creatorMediaTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const insV = await s.c.from("creator_videos").insert({ creator_id: ZERO, storage_path: "wall.mp4", sort_order: 99 });
  check(`${label} cannot write creator_videos`, !!insV.error, `error=${insV.error?.message ?? "none (write accepted)"}`);
  const upd = await s.c.from("dashboard_creators").update({ do_not_use_again: true }).neq("id", ZERO).select("id");
  check(`${label} changes no dashboard_creators row`, !!upd.error || (upd.data ?? []).length === 0, `rows=${upd.data?.length ?? "error"}`);
  if (headshotPath) {
    const signed = await s.c.storage.from("creator-headshots").createSignedUrl(headshotPath, 60);
    check(`${label} cannot sign a creator headshot link`, !!signed.error || !signed.data?.signedUrl, `error=${signed.error?.message ?? "none (link signed)"}`);
  }
}
for (const table of creatorMediaTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}

// Old dashboard batch 2, Actors (step 5b): the actor roster, castings and actor media are staff
// only. Actor emails and phone numbers never reach a client login.
const actorTables = ["actors", "actor_assignments", "actor_videos", "actor_photos"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of actorTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("actors").insert({ name: "wall check" });
  check(`${label} cannot write actors`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  const upd = await s.c.from("actors").update({ do_not_use_again: true }).neq("id", ZERO).select("id");
  check(`${label} changes no actors row`, !!upd.error || (upd.data ?? []).length === 0, `rows=${upd.data?.length ?? "error"}`);
  const files = await s.c.storage.from("actor-headshots").list("", { limit: 10 });
  check(`${label} lists no actor headshot files`, !!files.error || (files.data ?? []).length === 0, `files=${files.data?.length ?? "error"}`);
}
for (const table of actorTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error && (r.data ?? []).length > 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
}
const actorFiles = await employee.c.storage.from("actor-headshots").list("", { limit: 10 });
check("employee lists actor headshot files", !actorFiles.error && (actorFiles.data ?? []).length > 0, `error=${actorFiles.error?.message ?? "none"}`);

// Old dashboard batch 2, Applications (step 5b): applications, their videos and the
// application buckets are staff only, so applicant emails, phone numbers and shipping addresses
// never reach a client. Clients are refused the four decision functions. The employee calls use
// an id that does not exist, so they pass the staff check and stop at no_data_found.
const applicationTables = ["creator_applications", "application_videos", "actor_applications", "actor_application_videos"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of applicationTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("creator_applications").insert({ name: "wall", email: "wall@example.test" });
  check(`${label} cannot write creator_applications`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["approve_application", { application_id: ZERO }],
    ["reject_application", { application_id: ZERO, reason: "wall" }],
    ["approve_actor_application", { application_id: ZERO }],
    ["reject_actor_application", { application_id: ZERO, reason: "wall" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
  const files = await s.c.storage.from("creator-application-headshots").list("", { limit: 10 });
  check(`${label} lists no applicant headshot files`, !!files.error || (files.data ?? []).length === 0, `files=${files.data?.length ?? "error"}`);
}
for (const table of applicationTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
for (const fn of ["approve_application", "reject_application", "approve_actor_application", "reject_actor_application"]) {
  const r = await employee.c.rpc(fn, fn.startsWith("reject") ? { application_id: ZERO, reason: "wall" } : { application_id: ZERO });
  check(`employee passes the staff check in ${fn}`, r.error?.code === "P0002", `code=${r.error?.code ?? "none"}`);
}

// Old dashboard batch 2, Approval boards (step 5b): a board token opens the public approval
// page without a login, so no client reads a board, even client A whose demo client
// (demo-glowdrip) has one. Clients cannot make, revoke or vote, and are refused
// apply_approval_votes. The employee call applies an empty list to a demo client, which
// changes nothing.
const boardTables = ["approval_boards", "approval_votes"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of boardTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("approval_boards").insert({ client_slug: "demo-glowdrip", token: `wall-${label.replace(" ", "-")}-${Date.now()}`, expires_at: new Date(Date.now() + 86400000).toISOString() });
  check(`${label} cannot make an approval link`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  const rev = await s.c.from("approval_boards").update({ revoked: true }).neq("id", ZERO).select("id");
  check(`${label} revokes no approval link`, !!rev.error || (rev.data ?? []).length === 0, `rows=${rev.data?.length ?? "error"}`);
  const r = await s.c.rpc("apply_approval_votes", { p_client_slug: "demo-glowdrip", p_votes: [] });
  check(`${label} is refused apply_approval_votes`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
}
for (const table of boardTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const applyEmpty = await employee.c.rpc("apply_approval_votes", { p_client_slug: "demo-glowdrip", p_votes: [] });
check("employee passes the staff check in apply_approval_votes (empty list, nothing moves)", !applyEmpty.error && applyEmpty.data === 0, `error=${applyEmpty.error?.message ?? "none"} data=${applyEmpty.data}`);

// Public links (P8 part 1): the registry holds a hash of every link's token and the open
// counts, and the rate limit table holds hashed addresses. No client login reads either,
// and no client can write to them or call the functions that serve the public pages.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["public_link_registry", "public_link_rate_limits"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !!r.error || (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const w = await s.c.from("public_link_registry").update({ open_count: 0 }).neq("link_id", ZERO).select("link_id");
  check(`${label} resets no link open counts`, !!w.error || (w.data ?? []).length === 0, `rows=${w.data?.length ?? "error"}`);
  const rl = await s.c.rpc("public_link_rate_hit", { p_key: "wall", p_limit: 1, p_window_seconds: 60, p_cost: 0 });
  check(`${label} is refused public_link_rate_hit`, rl.error?.code === "42501", `code=${rl.error?.code ?? "none"}`);
  const pb = await s.c.rpc("public_board_get", { p_token_hash: "0".repeat(64), p_board_type: "creators", p_count_open: false });
  check(`${label} is refused public_board_get`, pb.error?.code === "42501", `code=${pb.error?.code ?? "none"}`);
}
const regStaff = await employee.c.from("public_link_registry").select("link_id, open_count").limit(1);
check("employee can read public_link_registry (open counts)", !regStaff.error, `error=${regStaff.error?.message ?? "none"}`);

// Old dashboard batch 3, Locations (step 5c): a location holds the host's contact email,
// wifi and entry instructions, and a link token opens the public location page without a
// login, so no client reads any of the four tables, writes them, or passes the checked
// location functions. The employee reads them; the staff check is passed with an id that
// matches no location, which changes nothing.
const locationTables = ["locations", "location_photos", "location_boards", "location_board_items"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of locationTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("location_boards").insert({ client_slug: "demo-harbor", token: `wall-${label.replace(" ", "-")}-${Date.now()}` });
  check(`${label} cannot make a location link`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  const rev = await s.c.from("location_boards").update({ revoked: true }).neq("id", ZERO).select("id");
  check(`${label} revokes no location link`, !!rev.error || (rev.data ?? []).length === 0, `rows=${rev.data?.length ?? "error"}`);
  for (const [fn, args] of [
    ["create_location", { p_name: "wall check" }],
    ["update_location", { p_id: ZERO, p_name: "wall check" }],
    ["delete_location", { p_id: ZERO }],
    ["set_location_capacity", { p_id: ZERO }],
    ["set_location_entry_instructions", { p_id: ZERO }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of locationTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const locPage = await employee.c.from("location_boards").select("id, client_slug, label, token, revoked, created_at, location_board_items(location_id)").limit(1);
check("employee loads the location links page query", !locPage.error, `error=${locPage.error?.code ?? ""} ${locPage.error?.message ?? "none"}`);
for (const fn of ["update_location", "delete_location", "set_location_capacity", "set_location_entry_instructions"]) {
  const r = await employee.c.rpc(fn, fn === "update_location" ? { p_id: ZERO, p_name: "wall check" } : { p_id: ZERO });
  check(`employee passes the staff check in ${fn}`, r.error?.code === "P0002", `code=${r.error?.code ?? "none"}`);
}

// Old dashboard batch 3, Props (step 5c): props name the client a purchase was for and
// what it cost. Clients read none, cannot write them and are refused the six checked prop
// functions. The employee reads them and passes the staff check with an id that matches
// no prop, which changes nothing.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const r = await s.c.from("props").select("*").limit(1000);
  check(`${label} reads no props rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  const ins = await s.c.from("props").insert({ name: "wall check" });
  check(`${label} cannot write props`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_prop", { p_name: "wall check" }],
    ["update_prop", { p_id: ZERO, p_name: "wall check" }],
    ["set_prop_at_studio", { p_id: ZERO, p_at_studio: true }],
    ["set_prop_client_supplied", { p_id: ZERO, p_client_supplied: false }],
    ["set_prop_return_status", { p_id: ZERO, p_return_status: null }],
    ["delete_prop", { p_id: ZERO }],
  ]) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
const propsStaff = await employee.c.from("props").select("id, name, store, price, return_status, client, at_studio, client_supplied, bin_number, notes, updated_at").limit(1);
check("employee loads the props page query", !propsStaff.error, `error=${propsStaff.error?.message ?? "none"}`);
for (const [fn, args] of [
  ["set_prop_at_studio", { p_id: ZERO, p_at_studio: true }],
  ["set_prop_return_status", { p_id: ZERO, p_return_status: null }],
  ["delete_prop", { p_id: ZERO }],
]) {
  const res = await employee.c.rpc(fn, args);
  check(`employee passes the staff check in ${fn}`, res.error?.code === "P0002", `code=${res.error?.code ?? "none"}`);
}

// Old dashboard batch 3, Crew (step 5c): crew rows hold phone numbers, emails and rates.
// Clients read no crew and no call sheet crew, cannot write crew and are refused the three
// checked crew functions. The employee reads both tables and passes the staff check with an
// id that matches no crew member, which changes nothing.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["crew_members", "call_sheet_crew"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("crew_members").insert({ name: "wall check", role: "PA" });
  check(`${label} cannot write crew_members`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_crew_member", { p_name: "wall check", p_role: "PA" }],
    ["update_crew_member", { p_id: ZERO, p_name: "wall check", p_role: "PA" }],
    ["archive_crew_member", { p_id: ZERO, p_active: true }],
  ]) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
for (const table of ["crew_members", "call_sheet_crew"]) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
for (const [fn, args] of [
  ["update_crew_member", { p_id: ZERO, p_name: "wall check", p_role: "PA" }],
  ["archive_crew_member", { p_id: ZERO, p_active: true }],
]) {
  const res = await employee.c.rpc(fn, args);
  check(`employee passes the staff check in ${fn}`, res.error?.code === "P0002", `code=${res.error?.code ?? "none"}`);
}

// Old dashboard batch 3, Shipments (step 5c): studio shipments say what is in a client's
// boxes and where product is. Clients read none, cannot write them and are refused the five
// checked studio shipment functions and set_creator_assignment_delivery. The employee runs
// the page queries and passes the staff check with an id that matches nothing.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const r = await s.c.from("studio_shipments").select("*").limit(1000);
  check(`${label} reads no studio_shipments rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  const ins = await s.c.from("studio_shipments").insert({ client_slug: "demo-harbor", description: "wall check" });
  check(`${label} cannot write studio_shipments`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_studio_shipment", { p_client_slug: "demo-harbor", p_description: "wall check" }],
    ["update_studio_shipment", { p_id: ZERO, p_client_slug: "demo-harbor", p_description: "wall check" }],
    ["set_studio_shipment_delivered", { p_id: ZERO, p_delivered_at: null }],
    ["set_studio_shipment_notes", { p_id: ZERO, p_delivery_notes: null }],
    ["delete_studio_shipment", { p_id: ZERO }],
    ["set_creator_assignment_delivery", { p_assignment_id: ZERO }],
  ]) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
for (const [table, select, extra] of [
  ["studio_shipments", "id, client_slug, actor_assignment_id, description, carrier, tracking_number, shipped_at, expected_delivery_at, delivered_at, delivery_notes, actor_assignments(scheduled_shoot_date, actors(name))", null],
  ["creator_assignments", "id, creator_id, client_slug, stage, tracking_number, product_delivered_at, delivery_notes, next_follow_up_at, next_follow_up_source, dashboard_creators(name)", "tracking_number.not.is.null,product_delivered_at.not.is.null,delivery_notes.not.is.null"],
]) {
  let q = employee.c.from(table).select(select).limit(5);
  if (extra) q = q.or(extra);
  const r = await q;
  check(`employee loads the shipments page query on ${table}`, !r.error, `error=${r.error?.code ?? ""} ${r.error?.message ?? "none"}`);
}
for (const [fn, args] of [
  ["set_studio_shipment_delivered", { p_id: ZERO, p_delivered_at: null }],
  ["delete_studio_shipment", { p_id: ZERO }],
  ["set_creator_assignment_delivery", { p_assignment_id: ZERO }],
]) {
  const res = await employee.c.rpc(fn, args);
  check(`employee passes the staff check in ${fn}`, res.error?.code === "P0002", `code=${res.error?.code ?? "none"}`);
}

// Old dashboard batch 3, Production calendar (step 5c): a shoot names where talent and crew
// will be and when. Clients read no shoots, blocks or block talent and crew, cannot write
// shoots and are refused the eight shoot, block and confirm functions. The employee runs the
// page query and passes the staff check with ids that match nothing.
const shootTables = ["shoots", "shoot_schedule_blocks", "shoot_schedule_block_talent", "shoot_schedule_block_crew"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of shootTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("shoots").insert({ client_slug: "demo-harbor", shoot_date: "2030-01-01" });
  check(`${label} cannot write shoots`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_shoot", { p_client_slug: "demo-harbor", p_shoot_date: "2030-01-01" }],
    ["update_shoot", { p_id: ZERO, p_shoot_date: "2030-01-01" }],
    ["delete_shoot", { p_id: ZERO }],
    ["create_shoot_schedule_block", { p_shoot_id: ZERO, p_label: "wall", p_start_time: "10:00", p_end_time: "11:00" }],
    ["update_shoot_schedule_block", { p_id: ZERO, p_label: "wall", p_start_time: "10:00", p_end_time: "11:00" }],
    ["delete_shoot_schedule_block", { p_id: ZERO }],
    ["confirm_actor_for_shoot", { p_assignment_id: ZERO, p_shoot_id: ZERO }],
    ["unconfirm_actor_from_shoot", { p_assignment_id: ZERO }],
  ]) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
const calPage = await employee.c.from("shoots")
  .select("id, client_slug, shoot_date, location, location_id, notes, shoot_schedule_blocks(id, label, start_time, end_time, location, notes, shoot_schedule_block_talent(actor_assignment_id), shoot_schedule_block_crew(crew_member_id)), call_sheets(id, revoked)")
  .limit(5);
check("employee loads the production calendar page query", !calPage.error && (calPage.data ?? []).length > 0, `error=${calPage.error?.code ?? ""} ${calPage.error?.message ?? "none"} rows=${calPage.data?.length ?? "error"}`);
for (const [fn, args] of [
  ["update_shoot", { p_id: ZERO, p_shoot_date: "2030-01-01" }],
  ["delete_shoot", { p_id: ZERO }],
  ["unconfirm_actor_from_shoot", { p_assignment_id: ZERO }],
]) {
  const res = await employee.c.rpc(fn, args);
  check(`employee passes the staff check in ${fn}`, res.error?.code === "P0002", `code=${res.error?.code ?? "none"}`);
}

// Old dashboard batch 3, Casting (step 5c): castings name the talent and a casting link
// token opens the public casting page without a login. Clients read no castings, no actor
// casting links and no actor votes, cannot cast, make a link or vote, and are refused
// apply_actor_approval_votes. The employee runs the page queries and applies an empty list
// to a demo client, which changes nothing.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["actor_assignments", "actor_approval_votes"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const links = await s.c.from("approval_boards").select("id").eq("board_type", "actors");
  check(`${label} reads no casting links`, !links.error && (links.data ?? []).length === 0, `rows=${links.data?.length ?? "error"}`);
  const cast = await s.c.from("actor_assignments").insert({ actor_id: ZERO, client_slug: "demo-harbor" });
  check(`${label} cannot cast an actor`, !!cast.error, `error=${cast.error?.message ?? "none (write accepted)"}`);
  const ins = await s.c.from("approval_boards").insert({ client_slug: "demo-harbor", board_type: "actors", token: `wall-cast-${label.replace(" ", "-")}-${Date.now()}`, expires_at: new Date(Date.now() + 86400000).toISOString() });
  check(`${label} cannot make a casting link`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  const res = await s.c.rpc("apply_actor_approval_votes", { p_client_slug: "demo-harbor", p_votes: [] });
  check(`${label} is refused apply_actor_approval_votes`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
}
const castPage = await employee.c.from("actor_assignments").select("id, actor_id, client_slug, stage, owner_id, next_follow_up_at, notes, scheduled_shoot_date, shoot_id, actors(name, gender, age_range, do_not_use_again)").eq("client_slug", "demo-harbor");
check("employee loads the casting page query", !castPage.error && (castPage.data ?? []).length > 0, `error=${castPage.error?.message ?? "none"} rows=${castPage.data?.length ?? "error"}`);
const castVotes = await employee.c.from("actor_approval_votes").select("id, board_id, assignment_id, vote, voted_at, voted_by").limit(5);
check("employee can read actor_approval_votes", !castVotes.error, `error=${castVotes.error?.message ?? "none"}`);
const applyCast = await employee.c.rpc("apply_actor_approval_votes", { p_client_slug: "demo-harbor", p_votes: [] });
check("employee passes the staff check in apply_actor_approval_votes (empty list, nothing moves)", !applyCast.error && applyCast.data === 0, `error=${applyCast.error?.message ?? "none"} data=${applyCast.data}`);

// Old dashboard batch 3, Call sheets (step 5c, migration 20261110220001): a call sheet holds
// the secret link token and its talent lines hold rate and internal notes. Clients read no
// call sheets or talent lines, cannot write talent lines and are refused the five call sheet
// functions. The employee runs the page query and passes the staff check with ids that match
// nothing.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["call_sheets", "call_sheet_talent_entries"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("call_sheet_talent_entries").insert({ call_sheet_id: ZERO, actor_assignment_id: ZERO, wardrobe: "wall" });
  check(`${label} cannot write call_sheet_talent_entries`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_call_sheet", { p_shoot_id: ZERO, p_token: "wallCheckToken0000000000000000000000000000001" }],
    ["update_call_sheet", { p_id: ZERO, p_call_time: "06:00" }],
    ["revoke_call_sheet", { p_id: ZERO, p_revoked: true }],
    ["save_call_sheet_talent_entry", { p_call_sheet_id: ZERO, p_actor_assignment_id: ZERO }],
    ["remove_call_sheet_talent_entry", { p_call_sheet_id: ZERO, p_actor_assignment_id: ZERO }],
  ]) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
const sheetPage = await employee.c.from("shoots")
  .select("id, client_slug, shoot_date, location, location_id, notes, call_sheets(id, shoot_id, token, call_time, wrap_time_estimate, general_notes, revoked, created_at, updated_at, call_sheet_crew(crew_member_id), call_sheet_talent_entries(actor_assignment_id, call_time, wardrobe, talent_notes, rate_note, internal_note, updated_at))")
  .limit(5);
check("employee loads the call sheets page query", !sheetPage.error && (sheetPage.data ?? []).length > 0, `error=${sheetPage.error?.code ?? ""} ${sheetPage.error?.message ?? "none"} rows=${sheetPage.data?.length ?? "error"}`);
const lines = await employee.c.from("call_sheet_talent_entries").select("call_sheet_id, rate_note").limit(5);
check("employee reads call sheet talent lines", !lines.error && (lines.data ?? []).length > 0, `error=${lines.error?.message ?? "none"} rows=${lines.data?.length ?? "error"}`);
for (const [fn, args] of [
  ["revoke_call_sheet", { p_id: ZERO, p_revoked: true }],
  ["save_call_sheet_talent_entry", { p_call_sheet_id: ZERO, p_actor_assignment_id: ZERO }],
  ["remove_call_sheet_talent_entry", { p_call_sheet_id: ZERO, p_actor_assignment_id: ZERO }],
]) {
  const res = await employee.c.rpc(fn, args);
  check(`employee passes the staff check in ${fn}`, res.error?.code === "P0002", `code=${res.error?.code ?? "none"}`);
}

// QA gates (migration 20261110120003, step 4b): staff only. Clients read none of the three
// tables, cannot write them and are refused every checked function, the gate read included.
const qaTables = ["engagement_deliverable_confirmations", "engagement_deliverable_qa_returns", "engagement_deliverable_signoffs"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of qaTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("engagement_deliverable_signoffs").insert({ deliverable_id: ZERO, revision: 1, signoff_kind: "qa_release", signed_by: s.userId });
  check(`${label} cannot write engagement_deliverable_signoffs`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["deliverable_release_status", { p_deliverable_id: ZERO }],
    ["confirm_deliverable_revision", { p_deliverable_id: ZERO, p_revision: 1 }],
    ["return_deliverable_to_strategist", { p_deliverable_id: ZERO, p_revision: 1, p_feedback: "wall" }],
    ["resolve_deliverable_qa_return", { p_return_id: ZERO, p_note: "wall" }],
    ["record_deliverable_signoff", { p_deliverable_id: ZERO, p_revision: 1, p_signoff_kind: "qa_release" }],
    ["mark_deliverable_final_ready", { p_deliverable_id: ZERO, p_revision: 1, p_final_download_url: "https://example.test/wall" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of qaTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const qGate = await employee.c.rpc("deliverable_release_status", { p_deliverable_id: ZERO });
check("employee passes the staff check in deliverable_release_status", qGate.error?.code === "P0002", `code=${qGate.error?.code ?? "none"}`);

// Handoffs (migration 20261110120004, step 4b): staff only. Clients read none of the three
// tables, cannot write them and are refused every checked function, the staff list included.
const handoffTables = ["handoff_packets", "handoff_packet_versions", "handoff_acknowledgements"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of handoffTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("handoff_acknowledgements").insert({ packet_id: ZERO, revision: 1, action: "acknowledged", actor_id: s.userId });
  check(`${label} cannot write handoff_acknowledgements`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["handoff_staff_options", {}],
    ["create_handoff_packet", { p_engagement_id: ZERO, p_receiving_role: "editor", p_receiver_id: ZERO, p_accountable_owner_id: ZERO, p_due_date: "2026-01-01", p_brief: "wall", p_angle: "wall", p_goal: "wall", p_required_inputs: ["wall"] }],
    ["acknowledge_handoff", { p_packet_id: ZERO, p_expected_revision: 1, p_action: "acknowledged" }],
    ["reassign_handoff", { p_packet_id: ZERO, p_expected_revision: 1, p_receiver_id: ZERO, p_receiving_role: "editor", p_due_date: "2026-01-01", p_reason: "wall" }],
    ["handoff_source_status", { p_packet_id: ZERO }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of handoffTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const hStatus = await employee.c.rpc("handoff_source_status", { p_packet_id: ZERO });
check("employee passes the staff check in handoff_source_status", hStatus.error?.code === "P0002", `code=${hStatus.error?.code ?? "none"}`);
const hStaff = await employee.c.rpc("handoff_staff_options", {});
check("employee lists staff logins and no client", !hStaff.error && (hStaff.data ?? []).length > 0 && !(hStaff.data ?? []).some((u) => u.user_id === clientA.userId || u.user_id === clientB.userId),
  `error=${hStaff.error?.message ?? "none"} rows=${hStaff.data?.length ?? "error"}`);

// Strategy proposals (migration 20261110200001, step 4c): staff only. Clients read none of the
// five tables, cannot write them and are refused every checked function.
const strategyTables = ["strategy_proposals", "strategy_proposal_versions", "strategy_proposal_reviews", "strategy_proposal_acceptances", "strategy_proposal_publications"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of strategyTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("strategy_proposal_reviews").insert({ proposal_id: ZERO, version: 1, decision: "reviewed", note: "wall", reviewer_id: s.userId });
  check(`${label} cannot write strategy_proposal_reviews`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_strategy_proposal", { p_engagement_id: ZERO, p_source_subject_id: ZERO, p_source_version: 1, p_title: "wall", p_summary: "wall", p_brief: "wall", p_angle: "wall", p_goal: "wall", p_required_inputs: ["wall"] }],
    ["revise_strategy_proposal", { p_proposal_id: ZERO, p_expected_version: 1, p_source_subject_id: ZERO, p_source_version: 1, p_title: "wall", p_summary: "wall", p_brief: "wall", p_angle: "wall", p_goal: "wall", p_required_inputs: ["wall"] }],
    ["review_strategy_proposal", { p_proposal_id: ZERO, p_version: 1, p_decision: "reviewed", p_note: "wall" }],
    ["accept_strategy_proposal", { p_proposal_id: ZERO, p_version: 1 }],
    ["publish_strategy_proposal", { p_proposal_id: ZERO, p_version: 1 }],
    ["published_strategy_for_engagement", { p_engagement_id: ZERO }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of strategyTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const spPublished = await employee.c.rpc("published_strategy_for_engagement", { p_engagement_id: ZERO });
check("employee passes the staff check in published_strategy_for_engagement", !spPublished.error && (spPublished.data ?? []).length === 0, `error=${spPublished.error?.message ?? "none"}`);
const spAccept = await employee.c.rpc("accept_strategy_proposal", { p_proposal_id: ZERO, p_version: 1 });
check("employee passes the staff check in accept_strategy_proposal", spAccept.error?.code === "P0002", `code=${spAccept.error?.code ?? "none"}`);

// Recommendations (migration 20261110200003, step 4c): staff only. Clients read none of the
// six tables, cannot write them and are refused every checked function, the ad list included.
const recTables = ["recommendations", "recommendation_decisions", "recommendation_execution_links", "recommendation_outcomes", "recommendation_outcome_evidence", "recommendation_learnings"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of recTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("recommendation_learnings").insert({ recommendation_id: ZERO, recommendation_version: 2, outcome_id: ZERO, conclusion: "supported", learning: "wall", reviewed_by: s.userId });
  check(`${label} cannot write recommendation_learnings`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["propose_recommendation", { p_engagement_id: ZERO, p_category: "creative", p_title: "wall", p_proposal: "wall" }],
    ["decide_recommendation", { p_recommendation_id: ZERO, p_expected_version: 1, p_decision: "rejected", p_reason: "wall", p_hypothesis: null, p_final_action: null, p_evidence: [] }],
    ["link_recommendation_execution", { p_recommendation_id: ZERO, p_expected_version: 1, p_ad_ids: ["wall"], p_pipeline_task_id: null, p_accountable_owner_id: ZERO, p_review_window_start: "2026-01-01", p_review_window_end: "2026-01-02" }],
    ["record_recommendation_outcome", { p_recommendation_id: ZERO, p_expected_version: 1 }],
    ["review_recommendation_learning", { p_recommendation_id: ZERO, p_expected_version: 1, p_outcome_id: ZERO, p_conclusion: "supported", p_learning: "wall" }],
    ["recommendation_ad_options", { p_client_slug: "demo-glowdrip" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of recTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const recOutcome = await employee.c.rpc("record_recommendation_outcome", { p_recommendation_id: ZERO, p_expected_version: 1 });
check("employee passes the staff check in record_recommendation_outcome", recOutcome.error?.code === "P0002", `code=${recOutcome.error?.code ?? "none"}`);

// Scope changes (migration 20261110200002, step 4c): staff only. Clients read none of the
// three tables, cannot write them and are refused both checked functions.
const scopeTables = ["scope_locks", "scope_change_requests", "scope_change_evaluations"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of scopeTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("scope_change_evaluations").insert({ request_id: ZERO, status: "accepted", rationale: "wall", evaluator_id: s.userId });
  check(`${label} cannot write scope_change_evaluations`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["request_scope_change", { p_subject_id: ZERO, p_base_version: 1, p_requested_change: "wall", p_channel: "call", p_source_note: "wall" }],
    ["evaluate_scope_change", { p_request_id: ZERO, p_status: "accepted", p_rationale: "wall" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of scopeTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const scReq = await employee.c.rpc("request_scope_change", { p_subject_id: ZERO, p_base_version: 1, p_requested_change: "wall", p_channel: "call", p_source_note: "wall" });
check("employee passes the staff check in request_scope_change", scReq.error?.code === "P0002", `code=${scReq.error?.code ?? "none"}`);

// Staff page loads (fix 20261110200004): each page reads a parent row with its history in
// one request. PostgREST refuses an embed with no foreign key to the parent (PGRST200),
// which left the Deliverables, QA gates and Handoffs pages empty. The employee runs the
// same select strings the pages use.
for (const [table, select] of [
  ["engagement_deliverables", "*, engagement_deliverable_revisions(*), engagement_deliverable_decisions(*), engagement_deliverable_round_exceptions(*)"],
  ["approval_subjects", "*, approval_subject_versions(*), approval_subject_decisions(*)"],
  ["engagement_deliverables", "*, engagements(client_slug, cycle_number), engagement_deliverable_revisions(revision, review_url), engagement_deliverable_qa_returns(*), engagement_deliverable_signoffs(*), engagement_deliverable_confirmations(revision)"],
  ["handoff_packets", "*, handoff_packet_versions(*), handoff_acknowledgements(*)"],
  ["strategy_proposals", "*, strategy_proposal_versions(*), strategy_proposal_reviews(*), strategy_proposal_acceptances(*), strategy_proposal_publications(*)"],
]) {
  const r = await employee.c.from(table).select(select).limit(1);
  check(`employee loads the ${table} page query`, !r.error, `error=${r.error?.code ?? ""} ${r.error?.message ?? "none"}`);
}

// Learning (migration 20261110200005, step 4c): staff only. Clients read none of the six
// tables, cannot write them and are refused every checked function.
const learningTables = ["learning_modules", "learning_module_versions", "learning_reviews", "learning_history", "learning_support_weeks", "learning_self_service_snapshots"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of learningTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("learning_reviews").insert({ module_id: ZERO, version: 1, action: "approved", reviewer_id: s.userId });
  check(`${label} cannot write learning_reviews`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_learning_module", { p_client_slug: "demo-glowdrip", p_module_key: "wall-check", p_title: "wall" }],
    ["save_learning_draft", { p_module_id: ZERO, p_expected_version: 0, p_summary: "wall", p_steps: ["wall"], p_checklist: ["wall"], p_source_refs: ["https://wall.test"], p_applicability: ["standard"], p_source_clearance: "cleared", p_client_use_rights: "client_approved", p_blocking_gaps: [], p_assigned_reviewer: null }],
    ["review_learning_version", { p_module_id: ZERO, p_version: 1, p_action: "accepted" }],
    ["publish_learning_version", { p_module_id: ZERO, p_version: 1 }],
    ["withdraw_learning_module", { p_module_id: ZERO, p_reason: "wall" }],
    ["record_learning_support_week", { p_engagement_id: ZERO, p_week_start: "2026-11-09", p_observation_status: "observed", p_recurring_how_to_questions: 1, p_data_origin: "synthetic_fixture" }],
    ["snapshot_learning_self_service", { p_engagement_id: ZERO, p_baseline_start: "2026-09-07", p_baseline_end: "2026-09-20", p_pilot_start: "2026-09-21", p_pilot_end: "2026-10-04" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of learningTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const lnPublish = await employee.c.rpc("publish_learning_version", { p_module_id: ZERO, p_version: 1 });
check("employee cannot publish a lesson (builder only)", lnPublish.error?.code === "42501", `code=${lnPublish.error?.code ?? "none"}`);
const lnDraft = await employee.c.rpc("save_learning_draft", { p_module_id: ZERO, p_expected_version: 0, p_summary: "wall", p_steps: [], p_checklist: [], p_source_refs: [], p_applicability: [], p_source_clearance: "pending", p_client_use_rights: "internal_draft_only", p_blocking_gaps: [], p_assigned_reviewer: null });
check("employee passes the staff check in save_learning_draft", lnDraft.error?.code === "P0002", `code=${lnDraft.error?.code ?? "none"}`);
const lnPage = await employee.c.from("learning_modules").select("*, learning_module_versions!learning_module_versions_module_id_fkey(*), learning_reviews!learning_reviews_module_id_fkey(*), learning_history!learning_history_module_id_fkey(*)").limit(1);
check("employee loads the learning page query", !lnPage.error, `error=${lnPage.error?.code ?? ""} ${lnPage.error?.message ?? "none"}`);

// Agent evaluations (migration 20261110200006, step 4c): staff only. Clients read none of the
// five tables, cannot write them, are refused every checked function, and cannot record a run.
const evalTables = ["agent_evaluation_samples", "agent_evaluation_runs", "agent_evaluation_results", "agent_evaluation_outcomes", "agent_config_approvals"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of evalTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("agent_evaluation_samples").insert({ agent_key: "meeting-recaps", sample_key: "wall_probe", dimension: "grounding", label: "synthetic", prompt: "wall", expected_decision: "deny", source_provenance: "wall", created_by: s.userId });
  check(`${label} cannot write agent_evaluation_samples`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["add_agent_evaluation_sample", { p_agent_key: "meeting-recaps", p_sample_key: "wall_probe", p_dimension: "grounding", p_label: "synthetic", p_prompt: "wall", p_expected_decision: "deny", p_source_provenance: "wall" }],
    ["record_agent_evaluation_outcome", { p_run_id: ZERO, p_approval_count: null, p_approval_total: null, p_business_outcome_status: "unrecorded", p_business_outcome_note: null, p_reason: "wall" }],
    ["approve_agent_config", { p_run_id: ZERO }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
  const run = await s.c.rpc("record_agent_evaluation_run", { p_run: { agent_key: "meeting-recaps" }, p_results: [] });
  check(`${label} cannot record an evaluation run`, !!run.error && run.error.code !== "22023", `code=${run.error?.code ?? "none (call accepted)"}`);
}
for (const table of evalTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const evalOutcome = await employee.c.rpc("record_agent_evaluation_outcome", { p_run_id: ZERO, p_approval_count: null, p_approval_total: null, p_business_outcome_status: "unrecorded", p_business_outcome_note: null, p_reason: "wall" });
check("employee passes the staff check in record_agent_evaluation_outcome", evalOutcome.error?.code === "P0002", `code=${evalOutcome.error?.code ?? "none"}`);
const evalApprove = await employee.c.rpc("approve_agent_config", { p_run_id: ZERO });
check("employee is refused approve_agent_config (builder only)", evalApprove.error?.code === "42501", `code=${evalApprove.error?.code ?? "none"}`);
// Alert exceptions (migration 20261111000002, step 4d): staff only. Clients read none and are
// refused record_alert_exception; the employee reads and passes the staff check (a kind that
// does not fit the problem is refused with 22023, so nothing is written).
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const r = await s.c.from("alert_exceptions").select("*").limit(1000);
  check(`${label} reads no alert_exceptions rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  const fn = await s.c.rpc("record_alert_exception", { p_connector: "queue", p_pattern: "queue.recovery", p_kind: "false_positive", p_reason: "wall", p_hours: 1 });
  check(`${label} is refused record_alert_exception`, fn.error?.code === "42501", `code=${fn.error?.code ?? "none"}`);
}
const aeRead = await employee.c.from("alert_exceptions").select("id, connector, pattern, kind, reason, expires_at").limit(1);
check("employee can read alert_exceptions", !aeRead.error, `error=${aeRead.error?.message ?? "none"}`);
const aeBad = await employee.c.rpc("record_alert_exception", { p_connector: "queue", p_pattern: "queue.recovery", p_kind: "idle_testing", p_reason: "wall", p_hours: 1 });
check("employee passes the staff check in record_alert_exception (wrong kind refused)", aeBad.error?.code === "22023", `code=${aeBad.error?.code ?? "none"}`);

// Operating costs (migration 20261111000003, step 4d): builder only. Clients and the
// employee read none of the four tables and are refused every checked function. The builder
// loads the page queries. Nothing here writes.
const costTables = ["operating_cost_entries", "operating_budgets", "operating_cost_events", "operating_budget_alerts"];
for (const [label, s] of [["client A", clientA], ["client B", clientB], ["employee", employee]]) {
  for (const table of costTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("operating_cost_entries").insert({ entry_key: "wall-check", label: "Wall check", category: "other", monthly_usd: 1, basis: "proposed", source_reference: "wall", updated_by: s.userId });
  check(`${label} cannot write operating_cost_entries`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["record_operating_cost_entry", { p_entry_key: "wall-check", p_label: "Wall check", p_category: "other", p_monthly_usd: 1, p_basis: "proposed", p_source_reference: "wall", p_active: true, p_expected_version: 0 }],
    ["record_operating_budget", { p_budget_key: "total", p_monthly_limit_usd: 10, p_warning_usd: 5, p_expected_version: 0 }],
    ["evaluate_operating_budgets", {}],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const [table, select] of [
  ["operating_cost_entries", "*"],
  ["operating_budgets", "*"],
  ["operating_cost_events", "*"],
  ["operating_budget_alerts", "*, durable_jobs!operating_budget_alerts_job_id_fkey(state)"],
]) {
  const r = await staff.c.from(table).select(select).limit(50);
  check(`builder loads the operating costs page query on ${table}`, !r.error, `error=${r.error?.code ?? ""} ${r.error?.message ?? "none"}`);
}

// Support inbox (migration 20261111000004, step 4d): staff only. Clients read none of the three
// tables, cannot write them and are refused every checked function. The employee reads, passes
// the staff check (unknown request) and loads the page query. Nothing here writes.
const supportTables = ["support_requests", "support_history", "support_assignment_history"];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of supportTables) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const ins = await s.c.from("support_history").insert({ request_id: ZERO, event_kind: "response", body: "wall", status: "open", revision: 9, actor_id: s.userId });
  check(`${label} cannot write support_history`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of [
    ["create_support_request", { p_client_slug: "demo-glowdrip", p_engagement_id: null, p_subject: "wall", p_question: "wall", p_channel: "other", p_next_update_target: "2026-11-30", p_accountable_user_id: null }],
    ["record_support_event", { p_request_id: ZERO, p_expected_revision: 1, p_event_kind: "response", p_body: "wall", p_next_update_target: null }],
    ["assign_support_request", { p_request_id: ZERO, p_expected_revision: 1, p_assigned_to: s.userId, p_assignment_kind: "backup" }],
  ]) {
    const r = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
  }
}
for (const table of supportTables) {
  const r = await employee.c.from(table).select("*").limit(1);
  check(`employee can read ${table}`, !r.error, `error=${r.error?.message ?? "none"}`);
}
const siEvent = await employee.c.rpc("record_support_event", { p_request_id: ZERO, p_expected_revision: 1, p_event_kind: "response", p_body: "wall", p_next_update_target: null });
check("employee passes the staff check in record_support_event", siEvent.error?.code === "P0002", `code=${siEvent.error?.code ?? "none"}`);
const siPage = await employee.c.from("support_requests").select("*, support_history!support_history_request_id_fkey(*), support_assignment_history!support_assignment_history_request_id_fkey(*)").eq("status", "open").order("updated_at", { ascending: false }).limit(200);
check("employee loads the support inbox page query", !siPage.error, `error=${siPage.error?.code ?? ""} ${siPage.error?.message ?? "none"}`);

// Client BIDs (migration 20261111020001, step 6): read-only viewer. Clients read no BIDs (not
// even their own client's), cannot write and cannot import; the employee reads, cannot import
// and loads the page queries. The import is service role only. Nothing here writes.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const r = await s.c.from("client_bids").select("*").limit(1000);
  check(`${label} reads no client_bids rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  const ins = await s.c.from("client_bids").insert({ client_slug: "demo-glowdrip", version: 99, title: "wall", body_markdown: "wall", body_sha256: "0".repeat(64), source: "bid-builder", source_ref: "wall", data_origin: "real", generated_at: new Date().toISOString() });
  check(`${label} cannot write client_bids`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
}
for (const [label, s] of [["client A", clientA], ["employee", employee]]) {
  const r = await s.c.rpc("import_client_bid", { p_client_slug: "demo-glowdrip", p_title: "wall", p_body_markdown: "wall", p_source: "bid-builder", p_source_ref: "wall", p_data_origin: "real", p_generated_at: new Date().toISOString() });
  check(`${label} is refused import_client_bid`, r.error?.code === "42501", `code=${r.error?.code ?? "none"}`);
}
const bidList = await employee.c.from("client_bids").select("id, client_slug, version, title, source, data_origin, generated_at, imported_at").order("version", { ascending: false }).limit(1000);
check("employee loads the BID list query", !bidList.error, `error=${bidList.error?.code ?? ""} ${bidList.error?.message ?? "none"}`);
const bidOne = await employee.c.from("client_bids").select("id, client_slug, version, title, source, data_origin, generated_at, imported_at, body_markdown, body_sha256, source_ref").limit(1);
check("employee loads the BID body query", !bidOne.error, `error=${bidOne.error?.code ?? ""} ${bidOne.error?.message ?? "none"}`);
check("staging BIDs are all made up", !bidList.error && (bidList.data ?? []).every((b) => b.data_origin === "made_up"), `origins=${[...new Set((bidList.data ?? []).map((b) => b.data_origin))]}`);

// Old dashboard batch 4, Settings and team (step 5d, migration 20261111040001): one staff
// list. Clients read no staff list at all (team list, role mapping, invites, audit), cannot
// give themselves a role and are refused the seven functions. The employee reads the mapping
// and the team list (the page queries), reads no invites or audit, cannot grant themselves
// builder by function or by direct write and is refused the reconciliation and the mapping
// change. The builder reads the reconciliation; only counts per issue are printed. Nothing
// here writes: every call that gets past a role check is given an id that matches nothing.
const STAFF_5D_FUNCTIONS = [
  ["staff_reconciliation", {}],
  ["set_staff_role_mapping", { p_dashboard_role: "viewer", p_verdanote_role: "client", p_note: "wall" }],
  ["prepare_staff_invite", { p_team_member_id: ZERO }],
  ["cancel_staff_invite", { p_invite_id: ZERO, p_reason: "wall check" }],
  ["add_login_to_team_list", { p_user_id: ZERO, p_name: "wall" }],
  ["update_team_member", { p_team_member_id: ZERO, p_name: "wall", p_dashboard_role: "producer", p_active: true }],
  ["set_staff_role", { p_user_id: ZERO, p_role: "builder" }],
];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["app_users", "staff_role_mappings", "staff_invites", "staff_admin_events"]) {
    const r = await s.c.from(table).select("*").limit(1000);
    check(`${label} reads no ${table} rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const selfRole = await s.c.from("user_roles").insert({ user_id: s.userId, role: "builder" });
  check(`${label} cannot give itself the builder role`, !!selfRole.error, `error=${selfRole.error?.message ?? "none (write accepted)"}`);
  for (const [fn, args] of STAFF_5D_FUNCTIONS) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
const teamPage = await employee.c.from("app_users").select("id, name, email, role, active").order("name");
check("employee loads the team list page query", !teamPage.error && (teamPage.data ?? []).length > 0, `error=${teamPage.error?.code ?? ""} ${teamPage.error?.message ?? "none"} rows=${teamPage.data?.length ?? "error"}`);
const mapPage = await employee.c.from("staff_role_mappings").select("dashboard_role, verdanote_role, note, updated_at").order("dashboard_role");
check("employee loads the role mapping page query (three rows)", !mapPage.error && (mapPage.data ?? []).length === 3, `error=${mapPage.error?.code ?? ""} ${mapPage.error?.message ?? "none"} rows=${mapPage.data?.length ?? "error"}`);
check("the mapping is admin to builder, producer to employee and viewer to client", ["admin:builder", "producer:employee", "viewer:client"].every((x) => (mapPage.data ?? []).some((m) => `${m.dashboard_role}:${m.verdanote_role}` === x)));
for (const table of ["staff_invites", "staff_admin_events"]) {
  const r = await employee.c.from(table).select("*").limit(1000);
  check(`employee reads no ${table} rows (builder only)`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
}
const empSelf = await employee.c.rpc("set_staff_role", { p_user_id: employee.userId, p_role: "builder" });
check("employee cannot grant themselves builder through set_staff_role", empSelf.error?.code === "42501", `code=${empSelf.error?.code ?? "none"}`);
const empInsert = await employee.c.from("user_roles").insert({ user_id: employee.userId, role: "builder" });
check("employee cannot insert a builder role for themselves", !!empInsert.error, `error=${empInsert.error?.message ?? "none (write accepted)"}`);
check("employee is still not a builder", !(await roleOf(employee))?.includes("builder"), `roles=${await roleOf(employee)}`);
for (const [fn, args] of STAFF_5D_FUNCTIONS.filter(([n]) => ["staff_reconciliation", "set_staff_role_mapping", "prepare_staff_invite"].includes(n))) {
  const res = await employee.c.rpc(fn, args);
  check(`employee is refused ${fn} (builder only)`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
}
const recon = await staff.c.rpc("staff_reconciliation");
const issueCounts = {};
for (const row of recon.data ?? []) for (const i of row.issues ?? []) issueCounts[i] = (issueCounts[i] ?? 0) + 1;
check("builder reads the staff reconciliation", !recon.error && Array.isArray(recon.data), `error=${recon.error?.message ?? "none"} people=${recon.data?.length ?? "error"} issues=${JSON.stringify(issueCounts)}`);
const prepNone = await staff.c.rpc("prepare_staff_invite", { p_team_member_id: ZERO });
check("builder passes the role check in prepare_staff_invite (no such member)", prepNone.error?.code === "P0002", `code=${prepNone.error?.code ?? "none"}`);
// The Team page (/team, step 5d PR 2) loads these as the builder.
const invPage = await staff.c.from("staff_invites").select("id, team_member_id, email, name, proposed_role, status, prepared_at, cancelled_at, cancel_reason").order("prepared_at", { ascending: false }).limit(200);
check("builder loads the Team page invites query", !invPage.error, `error=${invPage.error?.code ?? ""} ${invPage.error?.message ?? "none"}`);
check("no staging invite was ever sent (prepared or cancelled only)", (invPage.data ?? []).every((i) => ["prepared", "cancelled"].includes(i.status)), `statuses=${[...new Set((invPage.data ?? []).map((i) => i.status))]}`);
const evPage = await staff.c.from("staff_admin_events").select("id, kind, subject, detail, created_at").order("created_at", { ascending: false }).limit(20);
check("builder loads the Team page recent changes query", !evPage.error, `error=${evPage.error?.code ?? ""} ${evPage.error?.message ?? "none"}`);
// Clients section of the Team page (step 5d PR 3): every client for staff, add by hand
// (staff), show or hide and edit (builder). Nothing is written: the calls that pass the role
// check carry an empty name or a slug that matches nothing.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const [fn, args] of [
    ["create_client", { p_slug: "wall-probe", p_name: "Wall", p_does_creators: true, p_does_production: false }],
    ["update_client", { p_slug: "wall-probe", p_name: "Wall" }],
    ["set_client_active", { p_slug: "wall-probe", p_active: false }],
  ]) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
const clientSettings = await employee.c.from("clients").select("slug, name, active, status, origin, does_creators, does_production").order("name");
check("employee loads the client settings query", !clientSettings.error && (clientSettings.data ?? []).length > 0, `error=${clientSettings.error?.code ?? ""} ${clientSettings.error?.message ?? "none"} rows=${clientSettings.data?.length ?? "error"}`);
const empCreate = await employee.c.rpc("create_client", { p_slug: "wall-probe", p_name: " ", p_does_creators: true, p_does_production: false });
check("employee passes the staff check in create_client (empty name refused, nothing added)", empCreate.error?.code === "22023", `code=${empCreate.error?.code ?? "none"}`);
const empActive = await employee.c.rpc("set_client_active", { p_slug: "wall-probe", p_active: false });
check("employee is refused set_client_active (builder only)", empActive.error?.code === "42501", `code=${empActive.error?.code ?? "none"}`);
const builderEdit = await staff.c.rpc("update_client", { p_slug: "wall-probe-no-such-client", p_name: "Wall" });
check("builder passes the role check in update_client (no such client)", builderEdit.error?.code === "P0002", `code=${builderEdit.error?.code ?? "none"}`);

// Client switcher and client hub (restructure phase 2a). Every browser query of the new staff shell
// runs here with the exact select string the page sends (src/lib/pageQueries.ts; the test
// src/test/pageQueryCheck.test.ts fails if the two lists differ). Staff load them; a client reads no
// account links and no other client's row.
const SHELL_QUERIES = [
  ["clients", "slug, name, active"],
  ["client_ad_accounts", "account_id, client_slug"],
  // Client hub Work tab: the cards of one client, read by client_slug (the third item).
  ["pipeline_tasks", "id, clickup_task_id, task_name, stage, due_date, content_type, updated_at, asset_link", "client_slug"],
  // The client's own board by cycle (phase 5): board cards, delivered work older than 30 days, cycle
  // dates from engagements, and the client link that decides the landing page.
  ["pipeline_tasks", "id, clickup_task_id, task_name, stage, due_date, content_type, updated_at, cycle_month, delivered_at, asset_link", "client_slug"],
  ["pipeline_delivered", "id, clickup_task_id, task_name, content_type, cycle_month, delivered_at, updated_at, asset_link", "client_slug"],
  ["client_task_decisions", "id, clickup_task_id, client_slug, task_name, decision, note, decided_by_label, decided_at, superseded_at", "client_slug"],
  ["engagements", "start_date, day45_date, status", "client_slug"],
  ["client_members", "client_slug", "client_slug"],
  // Last run line on Operating costs and Integration health (phase 4 PR 3).
  ["check_runs", "check_key, trigger, outcome, created_at", "check_key"],
  // Client hub Setup tab (phase 4): the ad accounts to pick from and the client's ClickUp links.
  ["ad_accounts", "id, name"],
  ["source_mappings", "id, client_slug, provider, kind, external_id, label, active", "client_slug"],
  // Admin Notifications page (phase 4 PR 4): destinations, the send switch, reminders, the team list.
  ["slack_destinations", "id, label, channel_id, purpose, client_slug, owner_confirmed, active", "purpose"],
  ["outbound_switches", "name, enabled, note, updated_at", "name"],
  ["reminders", "id, kind, body, due_at, state, destination_id, client_slug, for_member_id, created_by, created_at", "state"],
  ["app_users", "id, name, email, role, active", "role"],
];
for (const [table, select, filter] of SHELL_QUERIES) {
  for (const [label, s] of [["employee", employee], ["builder", staff]]) {
    let q = s.c.from(table).select(select);
    if (filter) q = q.eq(filter, "demo-glowdrip");
    const r = await q;
    check(`${label} loads the shell page query on ${table}`, !r.error && (filter || (r.data ?? []).length > 0), `error=${r.error?.code ?? ""} ${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
}
{
  const WORK = "id, clickup_task_id, task_name, stage, due_date, content_type, updated_at, asset_link";
  const mineA = await clientA.c.from("pipeline_tasks").select(WORK).eq("client_slug", "demo-glowdrip");
  check("client A loads its own client's cards with the Work tab query", !mineA.error, `error=${mineA.error?.message ?? "none"} rows=${mineA.data?.length ?? "error"}`);
  const otherB = await clientB.c.from("pipeline_tasks").select(WORK).eq("client_slug", "demo-glowdrip");
  check("client B loads no cards of a client it does not belong to with the Work tab query", !otherB.error && (otherB.data ?? []).length === 0, `error=${otherB.error?.message ?? "none"} rows=${otherB.data?.length ?? "error"}`);
  const links = await clientA.c.from("client_ad_accounts").select("account_id, client_slug");
  check("client A loads no client account links with the shell page query", !links.error && (links.data ?? []).length === 0, `error=${links.error?.message ?? "none"} rows=${links.data?.length ?? "error"}`);
  const mine = await slugsOf(clientA);
  const rows = await clientA.c.from("clients").select("slug, name, active");
  check("client A loads only its own clients with the shell page query", !rows.error && (rows.data ?? []).every((r) => mine.includes(r.slug)), `error=${rows.error?.message ?? "none"} rows=${rows.data?.length ?? "error"} own=${mine}`);
}

// Client view by cycle (phase 5, migration 20261113000001). A client login sends the board reads with
// no filter (the row rules decide), so this runs the exact select strings the client pages send
// (src/lib/pageQueries.ts: CLIENT_BOARD_COLUMNS, CLIENT_DELIVERED_COLUMNS, CLIENT_ENGAGEMENT_COLUMNS,
// CLIENT_LINK_COLUMNS) as client A and client B. A must see its own cycles and no other client's, with
// rows to prove it (the seed gives demo-glowdrip two earlier cycles and demo-northwind two delivered
// tasks), and nothing beyond the client-safe fields. B must see nothing. Nobody writes from the browser.
{
  const BOARD = "id, clickup_task_id, task_name, stage, due_date, content_type, updated_at, cycle_month, delivered_at, asset_link";
  const DONE = "id, clickup_task_id, task_name, content_type, cycle_month, delivered_at, updated_at, asset_link";
  const BOARD_FIELDS = ["id", "clickup_task_id", "client_slug", "account_id", "task_name", "stage", "due_date", "content_type", "cycle_month", "delivered_at", "synced_at", "updated_at", "asset_link"];
  const DONE_FIELDS = ["id", "clickup_task_id", "client_slug", "account_id", "task_name", "content_type", "cycle_month", "delivered_at", "synced_at", "updated_at", "asset_link"];
  // Names that would mean a staff-only field has reached a client-readable table.
  const STAFF_FIELD = /status|assign|owner|link|url|brief|hour|qa_|email|note|internal|token|secret|created_by/i;
  const mine = await slugsOf(clientA);
  const firstOfMonth = (v) => v === null || /^\d{4}-\d{2}-01$/.test(v);
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

  // The page reads, exactly as sent.
  const boardA = await clientA.c.from("pipeline_tasks").select(BOARD);
  check("client A loads the cycle board query with no filter, and gets cards", !boardA.error && (boardA.data ?? []).length > 0, `error=${boardA.error?.message ?? "none"} rows=${boardA.data?.length ?? "error"}`);
  const doneA = await clientA.c.from("pipeline_delivered").select(DONE);
  check("client A loads the delivered-work query with no filter, and gets rows", !doneA.error && (doneA.data ?? []).length > 0, `error=${doneA.error?.message ?? "none"} rows=${doneA.data?.length ?? "error"}`);
  const engA = await clientA.c.from("engagements").select("start_date, day45_date, status");
  check("client A loads the cycle dates query", !engA.error && (engA.data ?? []).length > 0, `error=${engA.error?.message ?? "none"} rows=${engA.data?.length ?? "error"}`);
  const linkA = await clientA.c.from("client_members").select("client_slug");
  check("client A loads the client link query and gets only its own clients", !linkA.error && (linkA.data ?? []).every((r) => mine.includes(r.client_slug)), `error=${linkA.error?.message ?? "none"} rows=${linkA.data?.length ?? "error"} own=${mine}`);

  // Own cycles only: the same rows with the owner and cycle named.
  const boardOwn = await clientA.c.from("pipeline_tasks").select("client_slug, stage, cycle_month, delivered_at");
  check("client A's board cards all belong to its own clients", !boardOwn.error && (boardOwn.data ?? []).every((r) => mine.includes(r.client_slug)), `clients=${[...new Set((boardOwn.data ?? []).map((r) => r.client_slug))]} own=${mine}`);
  check("client A's board cards carry a first-of-month cycle, and a delivery day only when delivered", !boardOwn.error && (boardOwn.data ?? []).length > 0 && (boardOwn.data ?? []).every((r) => firstOfMonth(r.cycle_month) && (r.stage === "Ready to Launch" ? r.delivered_at === null || isDay(r.delivered_at) : r.delivered_at === null)), `rows=${boardOwn.data?.length ?? "error"}`);
  const doneOwn = await clientA.c.from("pipeline_delivered").select("client_slug, cycle_month, delivered_at");
  check("client A's delivered work all belongs to its own clients", !doneOwn.error && (doneOwn.data ?? []).every((r) => mine.includes(r.client_slug)), `clients=${[...new Set((doneOwn.data ?? []).map((r) => r.client_slug))]} own=${mine}`);
  check("client A sees at least two earlier cycles, each a first-of-month with a delivery day", !doneOwn.error && new Set((doneOwn.data ?? []).map((r) => r.cycle_month)).size >= 2 && (doneOwn.data ?? []).every((r) => firstOfMonth(r.cycle_month) && isDay(r.delivered_at)), `cycles=${[...new Set((doneOwn.data ?? []).map((r) => r.cycle_month))]}`);
  const engOwn = await clientA.c.from("engagements").select("client_slug");
  check("client A's cycle dates come from its own clients only", !engOwn.error && (engOwn.data ?? []).every((r) => mine.includes(r.client_slug)), `clients=${[...new Set((engOwn.data ?? []).map((r) => r.client_slug))]} own=${mine}`);

  // The wall has something to hold back: staff see delivered work of another client that A does not.
  const staffDone = await staff.c.from("pipeline_delivered").select("client_slug");
  const others = [...new Set((staffDone.data ?? []).map((r) => r.client_slug))].filter((s) => !mine.includes(s));
  check("staff see delivered work of another client (so the wall check is not hollow)", !staffDone.error && others.length > 0, `error=${staffDone.error?.message ?? "none"} other clients=${others}`);
  for (const other of others) {
    const leak = await clientA.c.from("pipeline_delivered").select("id").eq("client_slug", other);
    check(`client A reads no delivered work of ${other} even when it asks for it by name`, !leak.error && (leak.data ?? []).length === 0, `rows=${leak.data?.length ?? "error"}`);
  }

  // Field level: a client may ask for every column, and still gets only the client-safe ones.
  const boardAll = await clientA.c.from("pipeline_tasks").select("*").limit(5);
  const boardKeys = [...new Set((boardAll.data ?? []).flatMap((r) => Object.keys(r)))];
  check("client A reads no pipeline_tasks column beyond the client-safe ones, even with select *", !boardAll.error && boardKeys.length > 0 && boardKeys.every((k) => BOARD_FIELDS.includes(k) && (k === "asset_link" || !STAFF_FIELD.test(k))), `columns=${boardKeys}`);
  const doneAll = await clientA.c.from("pipeline_delivered").select("*").limit(5);
  const doneKeys = [...new Set((doneAll.data ?? []).flatMap((r) => Object.keys(r)))];
  check("client A reads no pipeline_delivered column beyond the client-safe ones, even with select *", !doneAll.error && doneKeys.length > 0 && doneKeys.every((k) => DONE_FIELDS.includes(k) && (k === "asset_link" || !STAFF_FIELD.test(k))), `columns=${doneKeys}`);
  const engAll = await clientA.c.from("engagement_notes").select("*").limit(5);
  check("client A reads no engagement notes (purchase references stay staff only)", !engAll.error && (engAll.data ?? []).length === 0, `rows=${engAll.data?.length ?? "error"}`);

  // The Air review link (phase 5b): every link a client can read is https on an air.inc host, A sees
  // links on its own cards (the seed gives demo-glowdrip some), and writing one is refused.
  const AIR_LINK = /^https:\/\/([a-z0-9-]+\.)*air\.inc(\/[^\s]*)?$/;
  const linksA = await clientA.c.from("pipeline_tasks").select("asset_link").not("asset_link", "is", null);
  const linksDoneA = await clientA.c.from("pipeline_delivered").select("asset_link").not("asset_link", "is", null);
  check("client A reads Air links on its own cards, and every one is an https air.inc address", !linksA.error && !linksDoneA.error && (linksA.data ?? []).length > 0 && [...(linksA.data ?? []), ...(linksDoneA.data ?? [])].every((r) => AIR_LINK.test(r.asset_link)), `error=${linksA.error?.message ?? linksDoneA.error?.message ?? "none"} board=${linksA.data?.length ?? "error"} done=${linksDoneA.data?.length ?? "error"}`);
  const linkWrite = await staff.c.from("pipeline_tasks").update({ asset_link: "javascript:alert(1)" }).eq("client_slug", "demo-glowdrip");
  check("a non-Air link cannot be written to a card, even by staff", !!linkWrite.error, `error=${linkWrite.error?.message ?? "none (write accepted)"}`);
  const linkWriteA = await clientA.c.from("pipeline_tasks").update({ asset_link: "https://app.air.inc/a/hijack" }).eq("client_slug", "demo-glowdrip").select("id");
  check("client A cannot change a card link", !!linkWriteA.error || (linkWriteA.data ?? []).length === 0, `rows=${linkWriteA.data?.length ?? "error"}`);

  // Client B: no links, no cycles.
  for (const [table, select] of [["pipeline_tasks", BOARD], ["pipeline_delivered", DONE], ["engagements", "start_date, day45_date, status"], ["client_members", "client_slug"]]) {
    const r = await clientB.c.from(table).select(select);
    check(`client B reads no ${table} rows with the cycle page query`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }

  // Nobody writes from the browser: clients, and staff too, since the sync is the only writer.
  for (const [label, s] of [["client A", clientA], ["client B", clientB], ["builder", staff]]) {
    const ins = await s.c.from("pipeline_delivered").insert({ clickup_task_id: "wall-check-none", client_slug: "demo-glowdrip", delivered_at: "2026-01-01" });
    check(`${label} cannot add a delivered row`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
    const upd = await s.c.from("pipeline_delivered").update({ task_name: "changed by wall check" }).eq("client_slug", "demo-glowdrip");
    check(`${label} cannot change a delivered row`, !!upd.error, `error=${upd.error?.message ?? "none (write accepted)"}`);
    const del = await s.c.from("pipeline_delivered").delete().eq("client_slug", "demo-glowdrip");
    check(`${label} cannot delete a delivered row`, !!del.error, `error=${del.error?.message ?? "none (write accepted)"}`);
  }
  const stillThere = await staff.c.from("pipeline_delivered").select("id").eq("client_slug", "demo-glowdrip");
  check("the delivered rows are all still there after the write attempts", !stillThere.error && (stillThere.data ?? []).length >= 5, `rows=${stillThere.data?.length ?? "error"}`);
}

// Client decisions (phase 5b, migration 20261117000001). A client approves or asks for changes through the
// client-decision function; the database keeps the history. Proves, with real logins: client A can decide on
// its own client's card (and change its answer while the card is in Client Review), cannot decide on another
// client's card, cannot write the table directly, reads only its own client's decisions and never the login id;
// client B decides on nothing and reads nothing; staff are refused by the function and read every decision; and
// the ClickUp write-back stays queued and unsent with its switch off. The card is demo-seed-4 (demo-glowdrip,
// Client Review, from scripts/seed-staging-dashboard.mjs). A run adds at most two history rows to that card; the
// function allows 5 per person per card per 10 minutes, so wait 10 minutes before a third run in a row.
await refreshLogins(staff, clientA, clientB, employee);
{
  const DECISION_SELECT = "id, clickup_task_id, client_slug, task_name, decision, note, decided_by_label, decided_at, superseded_at";
  const CARD = "demo-seed-4";
  const OTHER_CLIENT_CARD = "demo-seed-done-6"; // demo-northwind, delivered
  const decide = async (s, body) => {
    const res = await fetch(`${url}/functions/v1/client-decision`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const mine = await slugsOf(clientA);

  const a1 = await decide(clientA, { taskId: CARD, decision: "approved" });
  check("client A approves a card of its own client", a1.status === 200 && ["recorded", "unchanged"].includes(a1.json?.status), `status=${a1.status} ${JSON.stringify(a1.json)}`);
  const a2 = await decide(clientA, { taskId: CARD, decision: "approved" });
  check("approving again changes nothing (idempotent)", a2.status === 200 && a2.json?.status === "unchanged", `status=${a2.status} ${JSON.stringify(a2.json)}`);
  const a3 = await decide(clientA, { taskId: CARD, decision: "changes_requested", note: "Wall check: please shorten the intro" });
  check("client A can change its answer while the card is in Client Review", a3.status === 200, `status=${a3.status} ${JSON.stringify(a3.json)}`);
  const a4 = await decide(clientA, { taskId: CARD, decision: "approved" });
  check("and change it back", a4.status === 200 && a4.json?.status === "recorded", `status=${a4.status} ${JSON.stringify(a4.json)}`);
  const noNote = await decide(clientA, { taskId: CARD, decision: "changes_requested" });
  check("a change request with no note is refused", noNote.status === 400, `status=${noNote.status}`);
  const badId = await decide(clientA, { taskId: "not a valid id!", decision: "approved" });
  check("an invalid task id is refused", badId.status === 400, `status=${badId.status}`);
  const wrongClient = await decide(clientA, { taskId: OTHER_CLIENT_CARD, decision: "approved" });
  check("client A cannot decide on another client's card (not found)", wrongClient.status === 404, `status=${wrongClient.status}`);
  const noSuch = await decide(clientA, { taskId: "wall-check-no-such-card", decision: "approved" });
  check("a card that does not exist answers the same as another client's card", noSuch.status === 404 && JSON.stringify(noSuch.json) === JSON.stringify(wrongClient.json), `status=${noSuch.status}`);
  const b1 = await decide(clientB, { taskId: CARD, decision: "approved" });
  check("client B (no clients) cannot decide on client A's card", b1.status === 403 || b1.status === 404, `status=${b1.status}`);
  for (const [label, s] of [["builder", staff], ["employee", employee]]) {
    const r = await decide(s, { taskId: CARD, decision: "approved" });
    check(`${label} is refused by client-decision (the decision is the client's)`, r.status === 403, `status=${r.status}`);
  }
  const noAuth = await fetch(`${url}/functions/v1/client-decision`, { method: "POST", headers: { apikey: anon, "Content-Type": "application/json" }, body: JSON.stringify({ taskId: CARD, decision: "approved" }) });
  await noAuth.text();
  check("a call with no login is refused", noAuth.status === 401, `status=${noAuth.status}`);

  // What the client reads: the exact page select, its own client only, one current decision per card.
  const seenA = await clientA.c.from("client_task_decisions").select(DECISION_SELECT);
  check("client A loads the decisions query and gets its own client's decisions only", !seenA.error && (seenA.data ?? []).length >= 2 && (seenA.data ?? []).every((r) => mine.includes(r.client_slug)), `error=${seenA.error?.message ?? "none"} rows=${seenA.data?.length ?? "error"}`);
  const current = (seenA.data ?? []).filter((r) => r.clickup_task_id === CARD && r.superseded_at === null);
  check("the card has exactly one current decision, and it is the last answer (approved)", current.length === 1 && current[0].decision === "approved", `current=${current.map((r) => r.decision)}`);
  check("the earlier answers stay as history on the card", (seenA.data ?? []).filter((r) => r.clickup_task_id === CARD && r.superseded_at !== null).length >= 1, `rows=${seenA.data?.length}`);
  check("a decision carries a plain label, never an email address", (seenA.data ?? []).every((r) => r.decided_by_label && !r.decided_by_label.includes("@")), `labels=${[...new Set((seenA.data ?? []).map((r) => r.decided_by_label))]}`);
  const allA = await clientA.c.from("client_task_decisions").select("*").limit(50);
  const keysA = [...new Set((allA.data ?? []).flatMap((r) => Object.keys(r)))];
  // The table has column grants without decided_by, so a select * is refused outright (permission denied). Refused
  // or limited to the client-safe columns both keep the login id hidden; reading it is the failure.
  check("client A cannot read beyond the client-safe decision columns with select *", !!allA.error || (!keysA.includes("decided_by") && keysA.every((k) => DECISION_SELECT.split(", ").includes(k))), `columns=${keysA} error=${allA.error?.message ?? "none"}`);
  const idA = await clientA.c.from("client_task_decisions").select("decided_by");
  check("client A cannot read the login id of a decision", !!idA.error, `error=${idA.error?.message ?? "none (read accepted)"}`);
  const idStaff = await staff.c.from("client_task_decisions").select("decided_by");
  check("not even staff read the login id from the browser", !!idStaff.error, `error=${idStaff.error?.message ?? "none (read accepted)"}`);
  const seenB = await clientB.c.from("client_task_decisions").select(DECISION_SELECT);
  check("client B reads no decisions", !seenB.error && (seenB.data ?? []).length === 0, `error=${seenB.error?.message ?? "none"} rows=${seenB.data?.length ?? "error"}`);
  const staffSees = await staff.c.from("client_task_decisions").select(DECISION_SELECT).eq("client_slug", "demo-glowdrip");
  check("staff read the client's decisions, so the wall check is not hollow", !staffSees.error && (staffSees.data ?? []).length >= 2, `error=${staffSees.error?.message ?? "none"} rows=${staffSees.data?.length ?? "error"}`);
  const otherLeak = await clientA.c.from("client_task_decisions").select("id").neq("client_slug", "demo-glowdrip");
  check("client A reads no decision of another client even when it asks for them", !otherLeak.error && (otherLeak.data ?? []).length === 0, `rows=${otherLeak.data?.length ?? "error"}`);

  // Nobody writes the table from the browser.
  for (const [label, s] of [["client A", clientA], ["client B", clientB], ["builder", staff]]) {
    const ins = await s.c.from("client_task_decisions").insert({ clickup_task_id: CARD, client_slug: "demo-glowdrip", decision: "approved", decided_by: s.userId, decided_by_label: "Wall" });
    check(`${label} cannot write a decision directly`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
    const upd = await s.c.from("client_task_decisions").update({ note: "changed by wall check" }).eq("clickup_task_id", CARD).select("id");
    check(`${label} cannot change a decision`, !!upd.error || (upd.data ?? []).length === 0, `rows=${upd.data?.length ?? "error"}`);
    const del = await s.c.from("client_task_decisions").delete().eq("clickup_task_id", CARD).select("id");
    check(`${label} cannot delete a decision`, !!del.error || (del.data ?? []).length === 0, `rows=${del.data?.length ?? "error"}`);
  }
  const still = await staff.c.from("client_task_decisions").select("id").eq("clickup_task_id", CARD);
  check("the history is all still there after the write attempts", !still.error && (still.data ?? []).length >= 3, `rows=${still.data?.length ?? "error"}`);

  // The ClickUp write-back is recorded and not sent: jobs stay queued or canceled and the switch has no enabled row.
  const jobs = await staff.c.from("durable_jobs").select("kind, state").eq("kind", "clickup.decision_writeback");
  check("each decision queued a ClickUp write-back job", !jobs.error && (jobs.data ?? []).length >= 3, `error=${jobs.error?.message ?? "none"} rows=${jobs.data?.length ?? "error"}`);
  check("no write-back job has been claimed, sent or delivered", !jobs.error && (jobs.data ?? []).every((j) => ["queued", "canceled"].includes(j.state)), `states=${[...new Set((jobs.data ?? []).map((j) => j.state))]}`);
  const sw = await staff.c.from("outbound_switches").select("name, enabled").eq("name", "clickup_writeback");
  check("the ClickUp write-back switch is off", !sw.error && (sw.data ?? []).every((r) => r.enabled === false), `error=${sw.error?.message ?? "none"} rows=${JSON.stringify(sw.data)}`);
  const jobsA = await clientA.c.from("durable_jobs").select("id").limit(5);
  check("a client reads no queued jobs", !jobsA.error && (jobsA.data ?? []).length === 0, `rows=${jobsA.data?.length ?? "error"}`);
}

// Staff Home and the cross-client Work page (restructure phase 2b). The same four reads the pages send
// (src/lib/pageQueries.ts, staffList entries; src/test/pageQueryCheck.test.ts keeps the two in step), with
// the filter each page adds. Staff load them (the budget table is builder only: an employee reads nothing).
// A client reads none of the handoff, support and budget rows, and of the cards only its own clients'.
{
  const HOME_QUERIES = [
    ["pipeline_tasks", "id, clickup_task_id, client_slug, task_name, stage, due_date, synced_at, asset_link"],
    ["handoff_packets", "id, client_slug, receiving_role, receiver_id, due_date, status"],
    ["support_requests", "id, client_slug, subject, status, next_update_target, accountable_user_id, backup_user_id"],
    ["operating_budget_alerts", "id, level, period_month"],
  ];
  const HOME_FILTER = { handoff_packets: ["status", "ready"], support_requests: ["status", "open"], operating_budget_alerts: ["period_month", new Date().toISOString().slice(0, 7) + "-01"] };
  const run = (s, table, select) => {
    let q = s.c.from(table).select(select);
    if (HOME_FILTER[table]) q = q.eq(...HOME_FILTER[table]);
    return q;
  };
  for (const [table, select] of HOME_QUERIES) {
    const builderOnly = table === "operating_budget_alerts";
    const emp = await run(employee, table, select);
    check(`employee loads the Home page query on ${table}${builderOnly ? " (and reads no rows: builder only)" : ""}`, !emp.error && (!builderOnly || (emp.data ?? []).length === 0), `error=${emp.error?.code ?? ""} ${emp.error?.message ?? "none"} rows=${emp.data?.length ?? "error"}`);
    const bld = await run(staff, table, select);
    check(`builder loads the Home page query on ${table}`, !bld.error, `error=${bld.error?.code ?? ""} ${bld.error?.message ?? "none"} rows=${bld.data?.length ?? "error"}`);
    for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
      const r = await run(s, table, select);
      if (table === "pipeline_tasks") {
        const mine = await slugsOf(s);
        check(`${label} reads only its own clients' cards with the Home page query`, !r.error && (r.data ?? []).every((row) => mine.includes(row.client_slug)), `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"} own=${mine}`);
      } else {
        check(`${label} reads no rows of ${table} with the Home page query`, !!r.error || (r.data ?? []).length === 0, `rows=${r.data?.length ?? "error"}`);
      }
    }
  }
}
// Client setup (phase 4 PR 1, migration 20261112000001): the Setup tab. A client reads no ClickUp
// links and no client logins, cannot write either table and is refused the four functions. The
// employee reads the setup status (the Team page checklist) and is refused the three login
// functions (builder only). Nothing is written: calls that pass a role check name a client or a
// login that matches nothing.
const SETUP_FUNCTIONS = [
  ["client_setup_status", {}],
  ["list_client_members", { p_slug: "wall-probe-no-such-client" }],
  ["add_client_member", { p_slug: "wall-probe-no-such-client", p_email: "wall@staging.verdanote.test" }],
  ["remove_client_member", { p_slug: "wall-probe-no-such-client", p_user_id: ZERO }],
];
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const m = await s.c.from("source_mappings").select("id, client_slug, provider, kind, external_id, label, active").eq("client_slug", "demo-glowdrip");
  check(`${label} reads no ClickUp links with the Setup tab query`, !m.error && (m.data ?? []).length === 0, `error=${m.error?.message ?? "none"} rows=${m.data?.length ?? "error"}`);
  const insMap = await s.c.from("source_mappings").insert({ client_slug: "demo-glowdrip", provider: "clickup", kind: "folder", external_id: "9999999999" });
  check(`${label} cannot write source_mappings`, !!insMap.error, `error=${insMap.error?.message ?? "none (write accepted)"}`);
  const insMember = await s.c.from("client_members").insert({ user_id: s.userId, client_slug: "demo-glowdrip" });
  check(`${label} cannot link itself to a client`, !!insMember.error, `error=${insMember.error?.message ?? "none (write accepted)"}`);
  const insLink = await s.c.from("client_ad_accounts").insert({ account_id: "act_demo_glowdrip", client_slug: "demo-glowdrip" });
  check(`${label} cannot write client_ad_accounts`, !!insLink.error, `error=${insLink.error?.message ?? "none (write accepted)"}`);
  const accounts = await s.c.from("ad_accounts").select("id, name");
  check(`${label} loads only its own ad accounts with the Setup tab query`, !accounts.error && (accounts.data ?? []).every((a) => a.id === "act_demo_glowdrip"), `rows=${accounts.data?.length ?? "error"}`);
  for (const [fn, args] of SETUP_FUNCTIONS) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn}`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
const setupStatus = await employee.c.rpc("client_setup_status");
check("employee reads the client setup status", !setupStatus.error && Array.isArray(setupStatus.data) && setupStatus.data.length > 0, `error=${setupStatus.error?.message ?? "none"} rows=${setupStatus.data?.length ?? "error"}`);
for (const [fn, args] of SETUP_FUNCTIONS.filter(([n]) => n !== "client_setup_status")) {
  const res = await employee.c.rpc(fn, args);
  check(`employee is refused ${fn} (builder only)`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
}
const setupList = await staff.c.rpc("list_client_members", { p_slug: "demo-glowdrip" });
check("builder reads the client logins of a client", !setupList.error && Array.isArray(setupList.data), `error=${setupList.error?.message ?? "none"} rows=${setupList.data?.length ?? "error"}`);
const setupNoClient = await staff.c.rpc("add_client_member", { p_slug: "wall-probe-no-such-client", p_email: "wall@staging.verdanote.test" });
check("builder passes the role check in add_client_member (no such client, nothing linked)", setupNoClient.error?.code === "P0002", `code=${setupNoClient.error?.code ?? "none"}`);
const setupNoLink = await staff.c.rpc("remove_client_member", { p_slug: "wall-probe-no-such-client", p_user_id: ZERO });
check("builder passes the role check in remove_client_member (nothing linked)", setupNoLink.error?.code === "P0002", `code=${setupNoLink.error?.code ?? "none"}`);

// Invite by email (phase 4 PR 2, migration 20261112000002): the invite log. Clients and employees
// read no invite and are refused the list; the builder reads it. Nobody writes from the browser.
// Nothing is written or sent: the insert is refused before it reaches a row.
for (const [label, s] of [["client A", clientA], ["client B", clientB], ["employee", employee]]) {
  const r = await s.c.from("user_invites").select("*").limit(1000);
  check(`${label} reads no user_invites rows`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  const ins = await s.c.from("user_invites").insert({ email: "wall@staging.verdanote.test", display_name: "Wall", role: "employee", invited_by: s.userId });
  check(`${label} cannot write user_invites`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
  const list = await s.c.rpc("list_user_invites");
  check(`${label} is refused list_user_invites`, list.error?.code === "42501", `code=${list.error?.code ?? "none"}`);
}
const inviteBuilderWrite = await staff.c.from("user_invites").insert({ email: "wall@staging.verdanote.test", display_name: "Wall", role: "employee", invited_by: staff.userId });
check("even the builder cannot write user_invites from the browser", !!inviteBuilderWrite.error, `error=${inviteBuilderWrite.error?.message ?? "none (write accepted)"}`);
const inviteList = await staff.c.rpc("list_user_invites");
check("builder reads the invite list", !inviteList.error && Array.isArray(inviteList.data), `error=${inviteList.error?.message ?? "none"} rows=${inviteList.data?.length ?? "error"}`);

// Scheduled checks (phase 4 PR 3, migration 20261112000003): the run record behind "last run".
// A client reads no run and cannot write one; staff read them. The two check bodies are service
// role only, so clients and staff are refused. Nothing is written: refused calls change nothing.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const r = await s.c.from("check_runs").select("check_key, trigger, outcome, created_at").eq("check_key", "budget_check");
  check(`${label} reads no check runs`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  const ins = await s.c.from("check_runs").insert({ check_key: "alert_check", trigger: "scheduled", outcome: "ok" });
  check(`${label} cannot write check_runs`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
}
for (const [label, s] of [["client A", clientA], ["employee", employee], ["builder", staff]]) {
  for (const [fn, args] of [["run_operating_budget_check", { p_actor: ZERO }], ["run_scheduled_budget_check", {}]]) {
    const res = await s.c.rpc(fn, args);
    check(`${label} is refused ${fn} (service role only)`, res.error?.code === "42501", `code=${res.error?.code ?? "none"}`);
  }
}
const runsStaff = await employee.c.from("check_runs").select("check_key, trigger, outcome, created_at").order("created_at", { ascending: false }).limit(5);
check("employee reads the check runs", !runsStaff.error, `error=${runsStaff.error?.message ?? "none"}`);
const empBudget = await employee.c.rpc("evaluate_operating_budgets");
check("employee is still refused the budget check button", empBudget.error?.code === "42501", `code=${empBudget.error?.code ?? "none"}`);

// Notifications (phase 4 PR 4, migration 20261112000004). A client reads no Slack destination,
// switch or reminder and cannot write any; an employee cannot add a destination or turn sending
// on. Refused writes change nothing, and nothing here sends.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["slack_destinations", "outbound_switches", "reminders"]) {
    const r = await s.c.from(table).select("*").limit(5);
    check(`${label} reads no ${table}`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
  }
  const wDest = await s.c.from("slack_destinations").insert({ label: "wall-check", channel_id: "C0WALLCHK1", purpose: "internal" });
  check(`${label} cannot add a Slack destination`, !!wDest.error, `error=${wDest.error?.message ?? "none (write accepted)"}`);
  const wSw = await s.c.from("outbound_switches").upsert({ name: "slack_sends", enabled: true });
  check(`${label} cannot turn Slack sending on`, !!wSw.error, `error=${wSw.error?.message ?? "none (write accepted)"}`);
  const wRem = await s.c.from("reminders").insert({ kind: "custom", destination_id: ZERO, body: "wall-check", due_at: new Date().toISOString() });
  check(`${label} cannot create a reminder`, !!wRem.error, `error=${wRem.error?.message ?? "none (write accepted)"}`);
}
const empDest = await employee.c.from("slack_destinations").insert({ label: "wall-check", channel_id: "C0WALLCHK2", purpose: "internal" });
check("employee cannot add a Slack destination", !!empDest.error, `error=${empDest.error?.message ?? "none (write accepted)"}`);
const empSw = await employee.c.from("outbound_switches").upsert({ name: "slack_sends", enabled: true });
check("employee cannot turn Slack sending on", !!empSw.error, `error=${empSw.error?.message ?? "none (write accepted)"}`);
const staffNotify = await employee.c.from("slack_destinations").select("id, label, channel_id, purpose, client_slug, owner_confirmed, active").limit(5);
check("employee reads the Slack destinations", !staffNotify.error, `error=${staffNotify.error?.message ?? "none"}`);

// Media upload and delete (phase 6b). Staff upload with their own login: storage signs an upload
// link (the staff write policy on the bucket), the file goes to that link, the row is added under
// the staff row rules. A client must be refused at each step and must not be able to remove or
// change what staff put there. The probe makes a throwaway creator, actor and location, uploads
// one tiny file to each of the eight upload buckets, tries every client write against those
// files and rows, then deletes all of it. Nothing real is touched: every client attempt names a
// throwaway path or row id, never "all rows". Storage is checked in the bucket the file went to,
// and the listing walks the folders (storage lists one level at a time).
const listFiles = async (c, bucket, prefix) => {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await c.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const it of data ?? []) {
      const p = `${prefix}/${it.name}`;
      if (it.id === null) out.push(...(await listFiles(c, bucket, p)));
      else out.push(p);
    }
    if ((data ?? []).length < 100) break;
  }
  return out;
};
const mediaTag = `wall6b-${Date.now()}`;
const tiny = (type) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type });
const owners = { creator: null, actor: null, location: null };
const uploaded = [];
try {
  const mkC = await employee.c.from("dashboard_creators").insert({ name: `Wall check ${mediaTag}`, source: "manual" }).select("id").maybeSingle();
  const mkA = await employee.c.from("actors").insert({ name: `Wall check ${mediaTag}`, source: "manual" }).select("id").maybeSingle();
  const mkL = await employee.c.rpc("create_location", { p_name: `Wall check ${mediaTag}`, p_listing_url: null, p_rental_type: null, p_neighborhood: null, p_cost: null, p_cost_period: null, p_rooms: [], p_attributes: [], p_notes: null });
  owners.creator = mkC.data?.id ?? null;
  owners.actor = mkA.data?.id ?? null;
  owners.location = mkL.data?.id ?? null;
  check("media probe: staff made a throwaway creator, actor and location", !!(owners.creator && owners.actor && owners.location), `creator=${mkC.error?.message ?? "ok"} actor=${mkA.error?.message ?? "ok"} location=${mkL.error?.message ?? "ok"}`);

  if (owners.creator && owners.actor && owners.location) {
    const plan = [
      ["creator-videos", owners.creator, "video-wall.mp4", "video/mp4"],
      ["creator-headshots", owners.creator, "headshot-wall.jpg", "image/jpeg"],
      ["creator-family-pet-photos", owners.creator, "photo-wall.jpg", "image/jpeg"],
      ["creator-filming-locations", owners.creator, "location-wall.jpg", "image/jpeg"],
      ["actor-headshots", owners.actor, "headshot-wall.jpg", "image/jpeg"],
      ["actor-videos", owners.actor, "video-wall.mp4", "video/mp4"],
      ["actor-photos", owners.actor, "photo-wall.jpg", "image/jpeg"],
      ["location-photos", owners.location, "photo-wall.jpg", "image/jpeg"],
    ];
    // Staff: sign, upload, and see the file in the bucket it went to (recursive listing).
    for (const [bucket, owner, file, type] of plan) {
      const path = `${owner}/${file}`;
      const signed = await employee.c.storage.from(bucket).createSignedUploadUrl(path);
      const sent = signed.error ? signed : await employee.c.storage.from(bucket).uploadToSignedUrl(path, signed.data.token, tiny(type), { contentType: type });
      const found = !sent.error && (await listFiles(employee.c, bucket, owner)).includes(path);
      if (found) uploaded.push([bucket, path]);
      check(`staff upload to ${bucket} through a signed link, found by a recursive listing`, found, `error=${signed.error?.message ?? sent.error?.message ?? "none"}`);
    }
    // Storage itself refuses a file type the bucket does not take.
    const badSign = await employee.c.storage.from("creator-videos").createSignedUploadUrl(`${owners.creator}/video-wall-bad.txt`);
    const badSend = badSign.error ? badSign : await employee.c.storage.from("creator-videos").uploadToSignedUrl(`${owners.creator}/video-wall-bad.txt`, badSign.data.token, new Blob(["x"], { type: "text/plain" }), { contentType: "text/plain" });
    check("storage refuses a text file in the creator video bucket", !!badSend.error, `error=${badSend.error?.message ?? "none (accepted)"}`);

    // The rows, as staff.
    const rowPlan = [
      ["creator_videos", { creator_id: owners.creator, storage_path: `${owners.creator}/video-wall.mp4`, sort_order: 1, title: "wall", size_bytes: 4, mime_type: "video/mp4" }],
      ["creator_photos", { creator_id: owners.creator, storage_path: `${owners.creator}/photo-wall.jpg`, category: "pet", sort_order: 0 }],
      ["creator_filming_locations", { creator_id: owners.creator, storage_path: `${owners.creator}/location-wall.jpg`, sort_order: 0 }],
      ["actor_videos", { actor_id: owners.actor, storage_path: `${owners.actor}/video-wall.mp4`, sort_order: 1, size_bytes: 4, mime_type: "video/mp4" }],
      ["actor_photos", { actor_id: owners.actor, storage_path: `${owners.actor}/photo-wall.jpg`, sort_order: 0 }],
      ["location_photos", { location_id: owners.location, storage_path: `${owners.location}/photo-wall.jpg`, sort_order: 0 }],
    ];
    const rowIds = {};
    for (const [table, row] of rowPlan) {
      const r = await employee.c.from(table).insert(row).select("id").maybeSingle();
      rowIds[table] = r.data?.id ?? null;
      check(`staff add a ${table} row`, !!rowIds[table], `error=${r.error?.message ?? "none"}`);
    }

    // Clients: refused at signing, at upload, at the row, and unable to remove or change what staff added.
    for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
      for (const [bucket, owner] of plan) {
        const path = `${owner}/client-${label.replace(" ", "-").toLowerCase()}.jpg`;
        const sign = await s.c.storage.from(bucket).createSignedUploadUrl(path);
        check(`${label} cannot get a signed upload link in ${bucket}`, !!sign.error || !sign.data?.signedUrl, `error=${sign.error?.message ?? "none (link given)"}`);
        const up = await s.c.storage.from(bucket).upload(path, tiny("image/jpeg"), { contentType: "image/jpeg" });
        check(`${label} cannot upload directly to ${bucket}`, !!up.error, `error=${up.error?.message ?? "none (upload accepted)"}`);
      }
      for (const [bucket, path] of uploaded) {
        const rm = await s.c.storage.from(bucket).remove([path]);
        check(`${label} removes no file from ${bucket}`, !!rm.error || (rm.data ?? []).length === 0, `removed=${rm.data?.length ?? "error"}`);
      }
      for (const [table, row] of rowPlan) {
        const ins = await s.c.from(table).insert({ ...row, storage_path: `${row.storage_path}.client` });
        check(`${label} cannot add a ${table} row`, !!ins.error, `error=${ins.error?.message ?? "none (write accepted)"}`);
        if (!rowIds[table]) continue;
        const upd = await s.c.from(table).update({ sort_order: 77 }).eq("id", rowIds[table]).select("id");
        check(`${label} changes no ${table} row`, !!upd.error || (upd.data ?? []).length === 0, `rows=${upd.data?.length ?? "error"}`);
        const del = await s.c.from(table).delete().eq("id", rowIds[table]).select("id");
        check(`${label} deletes no ${table} row`, !!del.error || (del.data ?? []).length === 0, `rows=${del.data?.length ?? "error"}`);
      }
      const head = await s.c.from("dashboard_creators").update({ headshot_path: "client/headshot.jpg" }).eq("id", owners.creator).select("id");
      check(`${label} cannot set a creator headshot`, !!head.error || (head.data ?? []).length === 0, `rows=${head.data?.length ?? "error"}`);
    }
    // Everything staff put there is still there after both clients tried.
    let stillThere = 0;
    for (const [bucket, path] of uploaded) if ((await listFiles(employee.c, bucket, path.split("/")[0])).includes(path)) stillThere++;
    check("every file staff uploaded is still in storage after the client attempts", stillThere === uploaded.length && uploaded.length === plan.length, `${stillThere} of ${plan.length}`);
    let rowsLeft = 0;
    for (const [table] of rowPlan) {
      const r = await employee.c.from(table).select("id, sort_order").eq("id", rowIds[table]).maybeSingle();
      if (r.data && r.data.sort_order !== 77) rowsLeft++;
    }
    check("every row staff added is still there, unchanged, after the client attempts", rowsLeft === rowPlan.length, `${rowsLeft} of ${rowPlan.length}`);

    // Staff delete, file first and row second as the page does.
    for (const [table] of rowPlan) {
      const del = await employee.c.from(table).delete().eq("id", rowIds[table]).select("id");
      check(`staff delete a ${table} row`, !del.error && (del.data ?? []).length === 1, `error=${del.error?.message ?? "none"}`);
    }
  }
} finally {
  // Remove every throwaway file and owner, whatever happened above.
  for (const [bucket, owner] of [
    ["creator-videos", owners.creator], ["creator-headshots", owners.creator], ["creator-family-pet-photos", owners.creator], ["creator-filming-locations", owners.creator],
    ["actor-headshots", owners.actor], ["actor-videos", owners.actor], ["actor-photos", owners.actor], ["location-photos", owners.location],
  ]) {
    if (!owner) continue;
    try {
      const left = await listFiles(employee.c, bucket, owner);
      if (left.length) await employee.c.storage.from(bucket).remove(left);
    } catch { /* reported by the check below */ }
  }
  if (owners.creator) await employee.c.from("dashboard_creators").delete().eq("id", owners.creator);
  if (owners.actor) await employee.c.from("actors").delete().eq("id", owners.actor);
  if (owners.location) await employee.c.rpc("delete_location", { p_id: owners.location });
  let residue = 0;
  for (const [bucket, owner] of [
    ["creator-videos", owners.creator], ["creator-headshots", owners.creator], ["creator-family-pet-photos", owners.creator], ["creator-filming-locations", owners.creator],
    ["actor-headshots", owners.actor], ["actor-videos", owners.actor], ["actor-photos", owners.actor], ["location-photos", owners.location],
  ]) {
    if (owner) residue += (await listFiles(employee.c, bucket, owner)).length;
  }
  const ownersLeft = [
    owners.creator && (await employee.c.from("dashboard_creators").select("id").eq("id", owners.creator).maybeSingle()).data,
    owners.actor && (await employee.c.from("actors").select("id").eq("id", owners.actor).maybeSingle()).data,
    owners.location && (await employee.c.from("locations").select("id").eq("id", owners.location).maybeSingle()).data,
  ].filter(Boolean).length;
  check("media probe: every throwaway file, row and owner was deleted again", residue === 0 && ownersLeft === 0, `files left=${residue} owners left=${ownersLeft}`);
}

// OS-019 client pages. os_client_task_cards returns, per task, exactly the id, the client's current
// decision and the allow-listed fields (os_client_visible_fields). The allow-list itself must still be
// the five fields the story agreed; a change to it is a product decision and should fail here first.
// Read only: the decision calls below use a task id that does not exist, so nothing is written.
{
  const EXPECTED_ALLOW = ["asset_url", "brief", "due_date", "stage", "title"];
  // Staff read the list; a client must read none of it (no open tables on the client wall).
  const allowClient = await clientA.c.from("os_client_visible_fields").select("field");
  check("client A reads nothing from the field allow-list", (allowClient.data ?? []).length === 0, `rows=${allowClient.data?.length ?? "error"}`);
  const allow = await staff.c.from("os_client_visible_fields").select("field");
  const allowList = (allow.data ?? []).map((r) => r.field).sort();
  check("the client field allow-list is exactly title, stage, due_date, brief, asset_url", !allow.error && JSON.stringify(allowList) === JSON.stringify(EXPECTED_ALLOW), `error=${allow.error?.message ?? "none"} fields=${allowList}`);
  const cardsA = await clientA.c.rpc("os_client_task_cards");
  const wanted = JSON.stringify(["decision", "id", ...allowList].sort());
  const badKeys = (cardsA.data ?? []).map((c) => Object.keys(c).sort()).filter((k) => JSON.stringify(k) !== wanted);
  check("client A task cards have exactly id, decision and the allow-listed fields", !cardsA.error && badKeys.length === 0, `error=${cardsA.error?.message ?? "none"} cards=${cardsA.data?.length ?? "error"} bad=${JSON.stringify(badKeys[0] ?? [])}`);
  const cardsB = await clientB.c.rpc("os_client_task_cards");
  check("client B (no client) gets no task cards", !cardsB.error && (cardsB.data ?? []).length === 0, `error=${cardsB.error?.message ?? "none"} rows=${cardsB.data?.length ?? "error"}`);
  const cardsStaff = await staff.c.rpc("os_client_task_cards");
  check("staff get no rows from the client task cards", !cardsStaff.error && (cardsStaff.data ?? []).length === 0, `error=${cardsStaff.error?.message ?? "none"} rows=${cardsStaff.data?.length ?? "error"}`);
  const decisionsA = await clientA.c.from("os_task_client_decisions").select("id");
  check("client A reads no decision rows directly", !decisionsA.error && (decisionsA.data ?? []).length === 0, `error=${decisionsA.error?.message ?? "none"} rows=${decisionsA.data?.length ?? "error"}`);
  const retired = await clientA.c.rpc("os_client_tasks");
  check("client A cannot call the retired os_client_tasks", !!retired.error && retired.data == null, `error=${retired.error?.code ?? "none (call answered)"}`);
  const missing = "00000000-0000-4000-8000-000000000000";
  const decideA = await clientA.c.rpc("os_client_decide", { p_task_id: missing, p_decision: "approved", p_note: null });
  check("client A deciding a task that is not theirs gets not found", decideA.error?.code === "P0002", `code=${decideA.error?.code ?? "none"}`);
  const decideStaff = await staff.c.rpc("os_client_decide", { p_task_id: missing, p_decision: "approved", p_note: null });
  check("staff cannot use the client decision call", decideStaff.error?.code === "42501", `code=${decideStaff.error?.code ?? "none"}`);
}

// OS-020 cut review. Read only: nothing is added or posted. A client reads no os_task_versions row
// directly, gets no versions of a task that is not theirs, and gets only client-thread comments from
// list_task_version_comments on every version staff can see. A client posting an internal comment is
// refused before anything is written.
{
  const versionsA = await clientA.c.from("os_task_versions").select("id");
  check("client A reads no os_task_versions rows directly", !versionsA.error && (versionsA.data ?? []).length === 0, `error=${versionsA.error?.message ?? "none"} rows=${versionsA.data?.length ?? "error"}`);
  const versionsB = await clientB.c.from("os_task_versions").select("id");
  check("client B reads no os_task_versions rows directly", !versionsB.error && (versionsB.data ?? []).length === 0, `error=${versionsB.error?.message ?? "none"} rows=${versionsB.data?.length ?? "error"}`);
  const insA = await clientA.c.from("os_task_versions").insert({ task_id: "00000000-0000-4000-8000-000000000000", version_no: 1, video_url: "https://example.test/x.mp4" });
  check("client A cannot insert a version", !!insA.error, `error=${insA.error?.message ?? "none (write accepted)"}`);
  const staffVersions = await staff.c.from("os_task_versions").select("id, task_id").order("created_at", { ascending: false }).limit(25);
  check("builder can read os_task_versions", !staffVersions.error, `error=${staffVersions.error?.message ?? "none"}`);
  let leaked = 0;
  let seen = 0;
  for (const v of staffVersions.data ?? []) {
    for (const s of [clientA, clientB]) {
      const r = await s.c.rpc("list_task_version_comments", { p_version_id: v.id });
      if (r.error) { leaked++; continue; }
      seen += (r.data ?? []).length;
      leaked += (r.data ?? []).filter((c) => c.thread !== "client").length;
    }
  }
  check("clients get no internal comments from list_task_version_comments", leaked === 0, `versions=${staffVersions.data?.length ?? 0} client rows=${seen} bad=${leaked}`);
  const missing = "00000000-0000-4000-8000-000000000000";
  const otherA = await clientA.c.rpc("os_client_task_versions", { p_task_id: missing });
  check("client A gets no versions of a task that is not theirs", !otherA.error && (otherA.data ?? []).length === 0, `error=${otherA.error?.message ?? "none"} rows=${otherA.data?.length ?? "error"}`);
  const staffClientVersions = await staff.c.rpc("os_client_task_versions", { p_task_id: staffVersions.data?.[0]?.task_id ?? missing });
  check("staff get no rows from the client versions call", !staffClientVersions.error && (staffClientVersions.data ?? []).length === 0, `rows=${staffClientVersions.data?.length ?? "error"}`);
  const postInternal = await clientA.c.rpc("post_task_version_comment", { p_version_id: staffVersions.data?.[0]?.id ?? missing, p_thread: "internal", p_body: "wall check", p_timecode_ms: 0 });
  check("client A cannot post an internal cut comment", postInternal.error?.code === "42501", `code=${postInternal.error?.code ?? "none (post accepted)"}`);
  const addA = await clientA.c.rpc("os_add_task_version", { p_task_id: missing, p_video_url: "https://example.test/x.mp4", p_label: null });
  check("client A cannot add a version", addA.error?.code === "42501", `code=${addA.error?.code ?? "none"}`);
}

// OS-021 client invites. Read only: nothing is created, approved or sent. Clients read no row of any
// invite table and cannot call the builder functions; client-invite refuses a client token before it
// reads the body (the batch id below does not exist, so even a mistaken pass could send nothing).
{
  for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
    for (const table of ["os_invite_excluded_clients", "os_client_invite_template", "os_client_invite_batches", "os_client_invites"]) {
      const r = await s.c.from(table).select("*").limit(50);
      check(`${label} reads 0 rows from ${table}`, !r.error && (r.data ?? []).length === 0, `error=${r.error?.message ?? "none"} rows=${r.data?.length ?? "error"}`);
    }
    const st = await s.c.rpc("os_client_invite_pilot_status");
    check(`${label} cannot read the invite status`, st.error?.code === "42501", `code=${st.error?.code ?? "none (call answered)"}`);
    const ap = await s.c.rpc("os_client_invite_approve_template");
    check(`${label} cannot approve the invite email text`, ap.error?.code === "42501", `code=${ap.error?.code ?? "none (call answered)"}`);
  }
  const ex = await staff.c.from("os_invite_excluded_clients").select("client_slug");
  const exSlugs = (ex.data ?? []).map((r) => r.client_slug);
  check("the invite exclusion list holds cattasaurus, marek, miracle-brand and royo-bread",
    !ex.error && ["cattasaurus", "marek", "miracle-brand", "royo-bread"].every((s) => exSlugs.includes(s)), `error=${ex.error?.message ?? "none"} slugs=${exSlugs}`);

  await refreshLogins(clientA, clientB);
  for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
    const res = await fetch(`${url}/functions/v1/client-invite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", batch_id: "00000000-0000-4000-8000-000000000000" }),
    });
    await res.text();
    check(`${label} is refused by client-invite`, res.status === 403, `status=${res.status}`);
  }
}

// Brain links and ask-the-Brain (OS-026): a client gets no playbook link, no Brain passages and no
// Brain answer. brain_answer_passages is service-role only; brain-ask refuses a client login.
await refreshLogins(clientA, clientB);
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  const links = await s.c.from("brain_playbook_links").select("*").limit(10);
  check(`${label} reads no brain_playbook_links rows`, !links.error && (links.data ?? []).length === 0, `error=${links.error?.message ?? "none"} rows=${links.data?.length ?? "error"}`);
  const pb = await s.c.rpc("brain_playbook_for_content_type", { p_content_type: "ugc" });
  check(`${label} is refused brain_playbook_for_content_type`, pb.error?.code === "42501", `code=${pb.error?.code ?? "none"}`);
  const passages = await s.c.rpc("brain_answer_passages", { p_question: "how do we film a founder story", p_limit: 6 });
  check(`${label} gets no Brain passages`, !!passages.error && !(passages.data ?? []).length, `error=${passages.error?.code ?? "none"} rows=${passages.data?.length ?? 0}`);
  const res = await fetch(`${url}/functions/v1/brain-ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.token}`, apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "how do we film a founder story" }),
  });
  const text = await res.text();
  check(`${label} gets no Brain answer from brain-ask`, res.status === 403 && !text.includes("citations"), `status=${res.status}`);
}

// Staff-only server call: a client token must be refused.
const call = async (token) =>
  fetch(`${url}/functions/v1/user-management`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
await refreshLogins(staff, clientA);
const asClient = await call(clientA.token);
check("client token is refused by user-management", [401, 403].includes(asClient.status), `status=${asClient.status}`);
const asStaff = await call(staff.token);
check("staff token is accepted by user-management", asStaff.status < 400, `status=${asStaff.status}`);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll client wall checks passed");
process.exit(failed ? 1 : 0);
