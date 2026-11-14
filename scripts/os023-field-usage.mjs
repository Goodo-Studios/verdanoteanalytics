#!/usr/bin/env node
// OS-023: how often each copied ClickUp custom field is filled in, from the os_tasks copy on staging.
// Read only. Prints one line per field: filled / asset tasks, and the share.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_SERVICE_ROLE_KEY \
//     -- node scripts/os023-field-usage.mjs
//
// Counts asset tasks only (is_asset), since the custom fields live on the Project View lists.
// Refuses to run against production.
import { createClient } from "@supabase/supabase-js";

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

// ClickUp field name -> how it lands on os_tasks (supabase/functions/_shared/os-task-map.ts).
const FIELDS = [
  ["Producer", (t) => t.producer_id],
  ["Editor", (t) => t.editor_id],
  ["Strategist", (t) => t.strategist_id],
  ["Reviewed By", (t) => (t.reviewed_by ?? []).length > 0],
  ["Brief", (t) => t.brief_type],
  ["Type of Content", (t) => t.content_type],
  ["Link to Asset", (t) => t.asset_url],
  ["Goodo Ad Name Hook 1", (t) => (t.hooks ?? []).length >= 1],
  ["Goodo Ad Name Hook 2", (t) => (t.hooks ?? []).length >= 2],
  ...["Overall Polish", "Story & Pacing", "Audio & Captions", "Visual Quality"].map((name) => [
    name,
    (t) => (t.qa_checklist ?? []).some((q) => q.item === name && q.result),
  ]),
  ["Brief due", (t) => t.brief_due_date],
  ["Cut to strategist", (t) => t.cut_to_strategist_date],
  ["Cut to client", (t) => t.cut_to_client_date],
  ["Edit due", (t) => t.edit_due_date],
  ["Production Date", (t) => t.production_date],
  ["Brief handed off", (t) => t.brief_handed_off_date],
];

const db = createClient(url, key, { auth: { persistSession: false } });
const cols =
  "id, created_at, producer_id, editor_id, strategist_id, reviewed_by, brief_type, content_type, asset_url, hooks, qa_checklist, " +
  "brief_due_date, cut_to_strategist_date, cut_to_client_date, edit_due_date, production_date, brief_handed_off_date";
const tasks = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("os_tasks").select(cols).eq("is_asset", true).order("id").range(from, from + 999);
  if (error) throw new Error(error.message);
  tasks.push(...data);
  if (data.length < 1000) break;
}

const filled = (v) => v !== null && v !== undefined && v !== false && v !== "";
const out = FIELDS.map(([name, get]) => {
  const n = tasks.filter((t) => filled(get(t))).length;
  return { name, n, share: tasks.length ? n / tasks.length : 0 };
}).sort((a, b) => a.share - b.share);

console.log(`asset tasks: ${tasks.length}`);
for (const f of out) console.log(`${(f.share * 100).toFixed(1).padStart(5)}%  ${String(f.n).padStart(5)}  ${f.name}`);
