import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  findPendingMigrations,
  formatReport,
  migrationVersion,
  parseIgnoreList,
} from "./check-migrations-applied-lib.mjs";

test("migrationVersion reads the digits before the first underscore", () => {
  assert.equal(migrationVersion("20260212023127_ffc4b1e2-3da8.sql"), "20260212023127");
  assert.equal(migrationVersion("20261215150001_rollup_triggers_ordered_upserts.sql"), "20261215150001");
  assert.equal(migrationVersion("MIGRATIONS.md"), null);
  assert.equal(migrationVersion("notes.sql"), null);
});

test("a file missing from the ledger is pending, in file order", () => {
  const files = ["20260102000000_b.sql", "20260101000000_a.sql", "20260103000000_c.sql"];
  const { pending, ledgerOnly } = findPendingMigrations(files, ["20260101000000", "20260103000000"]);
  assert.deepEqual(pending.map((f) => f.name), ["20260102000000_b.sql"]);
  assert.deepEqual(ledgerOnly, []);
});

test("everything applied means nothing pending", () => {
  const { pending } = findPendingMigrations(["20260101000000_a.sql"], ["20260101000000"]);
  assert.equal(pending.length, 0);
});

test("ledger rows without a file are reported but are not pending", () => {
  const { pending, ledgerOnly } = findPendingMigrations(["20260101000000_a.sql"], ["20260101000000", "20250909000000"]);
  assert.equal(pending.length, 0);
  assert.deepEqual(ledgerOnly, ["20250909000000"]);
});

test("an ignored version is not pending", () => {
  const ignored = parseIgnoreList("# why\n20260102000000 # comment\n\n");
  const { pending } = findPendingMigrations(["20260102000000_b.sql"], [], ignored);
  assert.equal(pending.length, 0);
});

test("non-migration files in the directory are skipped", () => {
  const { pending } = findPendingMigrations(["MIGRATIONS.md", "README.txt"], []);
  assert.equal(pending.length, 0);
});

test("the report names every pending file", () => {
  const result = findPendingMigrations(["20260102000000_b.sql"], []);
  const report = formatReport(result, 1);
  assert.match(report, /1 of 1 migration files are NOT recorded/);
  assert.match(report, /20260102000000_b\.sql/);
  assert.match(report, /supabase db push/);
});

test("the CLI fails closed without credentials and prints no secret", () => {
  const script = fileURLToPath(new URL("./check-migrations-applied.mjs", import.meta.url));
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_ID: "" };
  const run = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /SUPABASE_ACCESS_TOKEN is not set/);
});

test("the CLI rejects a project ref that is not 20 lowercase letters or digits", () => {
  const script = fileURLToPath(new URL("./check-migrations-applied.mjs", import.meta.url));
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: "x", SUPABASE_PROJECT_ID: "../etc" };
  const run = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not a valid project ref/);
});
