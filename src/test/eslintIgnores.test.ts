// Audit Batch 9 (lint): ESLint ignored only dist and vendor, so `npm run lint:ci` also linted
// every agent worktree checked out under .claude/worktrees and failed on machines that have one.
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

describe("eslint ignores", () => {
  const eslint = new ESLint({ cwd: process.cwd() });

  it("skips agent worktrees under .claude/worktrees", async () => {
    expect(await eslint.isPathIgnored(".claude/worktrees/some-branch/src/App.tsx")).toBe(true);
  });

  it("still skips build output and vendored code", async () => {
    expect(await eslint.isPathIgnored("dist/assets/index.ts")).toBe(true);
    expect(await eslint.isPathIgnored("vendor/esm.sh/x.ts")).toBe(true);
  });

  it("still lints the app source", async () => {
    expect(await eslint.isPathIgnored("src/App.tsx")).toBe(false);
  });
});
