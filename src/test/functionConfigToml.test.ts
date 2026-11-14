/**
 * supabase/config.toml, explicit JWT setting for the staff functions that had no block.
 *
 * agent-evaluations, integration-health, meeting-recaps and push-brief-to-clickup used to rely on
 * the platform default. Each now has a [functions.<name>] block. integration-health must be
 * verify_jwt = false because its cron caller is authenticated inside the handler; the other three
 * keep the old effective behaviour (verify_jwt = true).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const toml = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");

/** The verify_jwt value of a [functions.<name>] block, or null when the block is missing. */
function verifyJwt(name: string): boolean | null {
  const lines = toml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `[functions.${name}]`);
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("[")) return null;
    const m = line.match(/^verify_jwt\s*=\s*(true|false)\b/);
    if (m) return m[1] === "true";
  }
  return null;
}

describe("config.toml function blocks", () => {
  it("integration-health is verify_jwt = false (its cron caller is checked inside the handler)", () => {
    expect(verifyJwt("integration-health")).toBe(false);
  });

  it.each(["agent-evaluations", "meeting-recaps", "push-brief-to-clickup"])("%s is explicitly verify_jwt = true", (name) => {
    expect(verifyJwt(name)).toBe(true);
  });

  it("has no duplicate function blocks", () => {
    const headers = toml.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("[functions."));
    expect(new Set(headers).size).toBe(headers.length);
  });
});
