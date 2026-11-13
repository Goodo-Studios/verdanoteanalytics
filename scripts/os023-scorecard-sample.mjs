#!/usr/bin/env node
// OS-023: print one month of scorecard numbers from staging status history, so they can be compared
// with the month's known figures. Read only.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_SERVICE_ROLE_KEY \
//     -- node scripts/os023-scorecard-sample.mjs [YYYY-MM]      (default 2026-10)
//
// Uses public.os_scorecard(month) when the OS-023 migration is on staging. Otherwise it calculates
// the same numbers here from os_task_status_history (same rules as the SQL function) and says so.
// Refuses to run against production.
import { createClient } from "@supabase/supabase-js";
import { scorecard } from "./os023-scorecard-lib.mjs";

const PROD_REF = "gwyxaqoaldnaavkjqquv";
const url = process.env.STAGING_SUPABASE_URL;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (url.includes(PROD_REF)) {
  console.error("Refusing to run: that URL is the production project.");
  process.exit(1);
}
const month = process.argv[2] ?? "2026-10";
if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error("Month must look like 2026-10.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function all(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

let rows;
let source;
const rpc = await db.rpc("os_scorecard", { p_month: `${month}-01` });
if (!rpc.error) {
  rows = rpc.data;
  source = "public.os_scorecard (database)";
} else {
  const [tasks, history, milestones] = await Promise.all([
    all("os_tasks", "id, client_slug, brief_due_date, cut_to_strategist_date, cut_to_client_date"),
    all("os_task_status_history", "id, task_id, from_status, to_status, changed_at, source"),
    db.from("os_task_milestone_statuses").select("milestone, status").then((r) => {
      if (r.error) throw new Error(r.error.message);
      return r.data;
    }),
  ]);
  rows = scorecard({ month, tasks, history, milestones });
  source = `calculated in this script (os_scorecard not on staging yet: ${rpc.error.message})`;
  const inMonth = history.filter((h) => h.changed_at.startsWith(month));
  console.log(`history rows: ${history.length} in total, ${inMonth.length} in ${month}`);
  const first = history.reduce((m, h) => (!m || h.changed_at < m ? h.changed_at : m), null);
  console.log(`earliest history row: ${first ?? "none"}`);
}

console.log(`Scorecard for ${month}, source: ${source}`);
const cols = [
  "client_slug", "briefs_done", "briefs_on_time", "cuts_to_strategist", "cuts_to_strategist_on_time",
  "cuts_to_client", "cuts_to_client_on_time", "internal_revisions", "client_revisions", "completed",
];
console.log(cols.join("\t"));
for (const r of rows) {
  console.log(cols.map((c) => (c === "client_slug" ? (r.is_total ? "TOTAL" : r.client_slug ?? "(no client)") : r[c])).join("\t"));
}
