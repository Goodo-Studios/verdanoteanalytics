// Audit Batch 9 (lint): `@typescript-eslint/no-unused-vars` was turned off, so dead imports,
// unused results (for example an `error` from a query that is never shown) and leftover state
// were invisible. It is on as a warning first; names starting with `_` mark intentional skips.
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

describe("eslint unused variables", () => {
  const eslint = new ESLint({ cwd: process.cwd() });

  it("warns on unused variables in app source", async () => {
    const config = await eslint.calculateConfigForFile("src/App.tsx");
    const rule = config.rules["@typescript-eslint/no-unused-vars"];
    const severity = Array.isArray(rule) ? rule[0] : rule;
    expect([1, "warn"]).toContain(severity);
  });

  it("reports an unused query error and allows an underscore name", async () => {
    const [result] = await eslint.lintText(
      "export function f(_skip: number) {\n  const { data, error } = { data: 1, error: null };\n  return data;\n}\n",
      { filePath: "src/lib/example-unused.ts" },
    );
    const unused = result.messages.filter((m) => m.ruleId === "@typescript-eslint/no-unused-vars");
    expect(unused.map((m) => m.message)).toEqual([expect.stringContaining("'error'")]);
  });
});
