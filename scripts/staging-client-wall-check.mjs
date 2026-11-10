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
  ["set_staff_role_mapping", { p_dashboard_role: "viewer", p_verdanote_role: "employee", p_needs_owner_decision: false, p_note: "wall" }],
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
const mapPage = await employee.c.from("staff_role_mappings").select("dashboard_role, verdanote_role, needs_owner_decision, note, updated_at").order("dashboard_role");
check("employee loads the role mapping page query (three rows)", !mapPage.error && (mapPage.data ?? []).length === 3, `error=${mapPage.error?.code ?? ""} ${mapPage.error?.message ?? "none"} rows=${mapPage.data?.length ?? "error"}`);
check("the viewer mapping is still flagged for the owner", (mapPage.data ?? []).some((m) => m.dashboard_role === "viewer" && m.needs_owner_decision === true));
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
const invPage = await staff.c.from("staff_invites").select("id, team_member_id, email, name, proposed_role, mapping_flagged, status, prepared_at, cancelled_at, cancel_reason").order("prepared_at", { ascending: false }).limit(200);
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
  ["pipeline_tasks", "id, task_name, stage, due_date, content_type, updated_at", "client_slug"],
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
  const WORK = "id, task_name, stage, due_date, content_type, updated_at";
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

// Staff Home and the cross-client Work page (restructure phase 2b). The same four reads the pages send
// (src/lib/pageQueries.ts, staffList entries; src/test/pageQueryCheck.test.ts keeps the two in step), with
// the filter each page adds. Staff load them (the budget table is builder only: an employee reads nothing).
// A client reads none of the handoff, support and budget rows, and of the cards only its own clients'.
{
  const HOME_QUERIES = [
    ["pipeline_tasks", "id, clickup_task_id, client_slug, task_name, stage, due_date, synced_at"],
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
