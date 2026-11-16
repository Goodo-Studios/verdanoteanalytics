// Audit Batch 9 (MIGRATIONS.md): both migration notes named seven files by placeholder numbers
// that were renumbered before they shipped, and one copy sat inside supabase/migrations/, where
// only migrations belong. Every migration a tracked doc names must exist, and the migrations
// folder holds .sql files only.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

function trackedMarkdown(): string[] {
  const run = spawnSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" });
  expect(run.status).toBe(0);
  return run.stdout.split("\n").filter(Boolean);
}

describe("migration docs", () => {
  it("name only migration files that exist", () => {
    const missing = trackedMarkdown().flatMap((doc) =>
      [...readFileSync(path.join(ROOT, doc), "utf8").matchAll(/\b(\d{14}_[A-Za-z0-9_-]+\.sql)\b/g)]
        .map((m) => m[1])
        .filter((name) => !existsSync(path.join(MIGRATIONS, name)))
        .map((name) => `${doc}: ${name}`),
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  it("keep the migrations folder to .sql files", () => {
    const other = readdirSync(MIGRATIONS).filter((f) => !f.endsWith(".sql"));
    expect(other).toEqual([]);
  });
});
