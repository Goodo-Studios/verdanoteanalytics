import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Slack-to-Vault import was never used from the app and let any signed-in
// user plant a Slack connection that the events webhook trusted. Matthew decided
// on 2026-11-15 to remove it (audit plan item 0.3). Migration 20261216130001
// closes direct writes to slack_connections. Nothing may bring the functions back
// without a fresh security review.

const root = process.cwd();
const REMOVED = ["vault-slack-connect", "vault-slack-events", "vault-slack-import"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("Slack import to the Vault is removed", () => {
  it("has no Slack import server function directories", () => {
    for (const name of REMOVED) expect(existsSync(join(root, "supabase/functions", name)), name).toBe(false);
  });

  it("does not deploy, smoke-test, classify or configure a Slack import function", () => {
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

  it("no page, component or hook calls a Slack import function", () => {
    const offenders = walk(join(root, "src"))
      .filter((f) => !f.endsWith("slackImportRemoved.test.ts"))
      .filter((f) => REMOVED.some((n) => readFileSync(f, "utf8").includes(n)));
    expect(offenders).toEqual([]);
  });

  it("a migration closes direct writes to slack_connections", () => {
    const dir = join(root, "supabase/migrations");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    expect(sql).toMatch(/DROP POLICY IF EXISTS "slack_connections_insert" ON public\.slack_connections/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "slack_connections_update" ON public\.slack_connections/);
    expect(sql).toMatch(/REVOKE ALL ON public\.slack_connections FROM anon, authenticated/);
  });
});
