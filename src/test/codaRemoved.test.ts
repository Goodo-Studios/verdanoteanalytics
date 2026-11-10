import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Coda was retired on 2026-10-09 and ClickUp is the task system. The Coda server
// functions, the "Push to Coda" / "Create brief in Coda" actions and coda_tasks
// were removed (migration 20261110000001). Nothing may call them again.

const root = process.cwd();
const REMOVED = ["create-coda-brief", "sync-coda-tasks", "sync-coda-names"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("Coda code is removed", () => {
  it("has no Coda server function directories", () => {
    for (const name of REMOVED) expect(existsSync(join(root, "supabase/functions", name)), name).toBe(false);
  });

  it("does not deploy, smoke-test, classify or configure a Coda function", () => {
    const files = [
      "scripts/deploy-functions.sh",
      "scripts/smoke-test.sh",
      "supabase/function-access.json",
      "supabase/config.toml",
    ];
    for (const f of files) {
      const text = readFileSync(join(root, f), "utf8");
      for (const name of REMOVED) expect(text, `${f} mentions ${name}`).not.toContain(name);
    }
  });

  it("no page, component or hook calls a Coda function or reads coda_tasks", () => {
    const offenders = walk(join(root, "src"))
      .filter((f) => !f.endsWith("codaRemoved.test.ts"))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return REMOVED.some((n) => text.includes(n)) || text.includes("coda_tasks") || /Push to Coda|brief in Coda/.test(text);
      });
    expect(offenders).toEqual([]);
  });
});
