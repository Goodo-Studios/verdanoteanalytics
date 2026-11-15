#!/usr/bin/env node
// Fails when supabase/migrations holds files the production database has not recorded in
// supabase_migrations.schema_migrations. Read-only: it runs one SELECT through the Supabase
// Management API and never writes to the database.
//
// Environment (CI passes the same repository secrets the production deploy job already uses):
//   SUPABASE_ACCESS_TOKEN  Supabase access token that can read this project's database
//   SUPABASE_PROJECT_ID    project ref of the production project
// Optional:
//   MIGRATIONS_DIR         default supabase/migrations
//   MIGRATIONS_IGNORE_FILE default scripts/migrations-ledger-ignore.txt (one version per line)
//
// Exit 0: nothing pending. Exit 1: files are pending, or the ledger could not be read. A check
// that cannot read the ledger fails instead of passing, so a bad token never looks like "all clear".
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { findPendingMigrations, formatReport, parseIgnoreList } from "./check-migrations-applied-lib.mjs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_ID;
const dir = process.env.MIGRATIONS_DIR || "supabase/migrations";
const ignoreFile = process.env.MIGRATIONS_IGNORE_FILE || "scripts/migrations-ledger-ignore.txt";

function fail(message) {
  console.error(`::error title=Migrations gate::${message}`);
  console.error(message);
  process.exit(1);
}

if (!token) fail("SUPABASE_ACCESS_TOKEN is not set. Add the repository secret SUPABASE_ACCESS_TOKEN.");
if (!ref) fail("SUPABASE_PROJECT_ID is not set. Add the repository secret SUPABASE_PROJECT_ID.");
if (!/^[a-z0-9]{20}$/.test(ref)) fail("SUPABASE_PROJECT_ID is not a valid project ref.");

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: "select version from supabase_migrations.schema_migrations order by version" }),
});
if (!response.ok) {
  // Status only: the response body is not echoed so nothing from the request can leak into the log.
  fail(`The Supabase Management API answered HTTP ${response.status}. The migration ledger was not read.`);
}
const rows = await response.json();
if (!Array.isArray(rows) || rows.some((r) => typeof r?.version !== "string")) {
  fail("The Supabase Management API returned an unexpected shape. The migration ledger was not read.");
}

const files = readdirSync(dir).filter((n) => n.endsWith(".sql"));
const ignored = existsSync(ignoreFile) ? parseIgnoreList(readFileSync(ignoreFile, "utf8")) : new Set();
const result = findPendingMigrations(files, rows.map((r) => r.version), ignored);
const report = formatReport(result, files.length);
console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Production migrations\n\n\`\`\`\n${report}\n\`\`\`\n`);
}
if (result.pending.length > 0) {
  console.error(`::error title=Unapplied production migrations::${result.pending.length} migration file(s) are not applied to production. Frontend and migrations are deployed by hand. Run supabase db push.`);
  process.exit(1);
}
