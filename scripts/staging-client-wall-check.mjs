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
