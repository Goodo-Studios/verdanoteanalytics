// Audit Batch 9: a 419-line "break-glass rollback" SQL script sat in the repo root under the name
// scratchpad-does-not-exist. Run by mistake, it undoes the August security migrations and
// re-grants the report functions to every signed-in user. Rollback scripts for security
// migrations must not live in the repo.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Built from parts so this file does not match its own search.
const MARKER = ["BREAK-GLASS", "ROLLBACK"].join(" ");

describe("repository", () => {
  it("contains no break-glass rollback script for the security migrations", () => {
    const run = spawnSync("git", ["grep", "-l", "-I", MARKER], { cwd: process.cwd(), encoding: "utf8" });
    // git grep exits 1 when nothing matches; anything else is an error.
    expect([0, 1]).toContain(run.status);
    const files = run.stdout.split("\n").filter(Boolean);
    expect(files).toEqual([]);
  });
});
