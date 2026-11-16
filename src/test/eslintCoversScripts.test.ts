// Audit Batch 9 (lint): the ESLint config only matched **/*.{ts,tsx}, so the Node scripts in
// scripts/*.mjs (CI gates, budget checks) and the plain JS in public/ were never linted, and a
// typo or undefined variable in a CI script only showed up when CI ran it.
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

describe("eslint covers scripts and public JS", () => {
  const eslint = new ESLint({ cwd: process.cwd() });

  const lintedWith = async (path: string) => {
    const config = await eslint.calculateConfigForFile(path);
    return config?.rules ?? {};
  };

  it("lints the Node scripts in scripts/*.mjs with Node globals", async () => {
    const rules = await lintedWith("scripts/require-e2e-env.mjs");
    expect(rules["no-undef"]).toBeDefined();
    const config = await eslint.calculateConfigForFile("scripts/require-e2e-env.mjs");
    expect(config.languageOptions.globals.process).toBeDefined();
  });

  it("lints the browser JS in public/", async () => {
    const rules = await lintedWith("public/facebook-saver.js");
    expect(rules["no-undef"]).toBeDefined();
  });

  it("reports an undefined variable in a script", async () => {
    const [result] = await eslint.lintText("export const x = notDefinedAnywhere + 1;\n", {
      filePath: "scripts/example-check.mjs",
    });
    expect(result.messages.map((m) => m.ruleId)).toContain("no-undef");
  });
});
