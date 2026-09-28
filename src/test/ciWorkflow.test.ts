import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(`${process.cwd()}/.github/workflows/ci.yml`, "utf8");
const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8"));

describe("CI deployment safety", () => {
  it("applies every migration and runs database tests in an isolated Supabase stack", () => {
    expect(workflow).toMatch(/^ {2}database-test:\s*$/m);
    expect(workflow).toContain("supabase start");
    expect(workflow).toContain("supabase db reset --local");
    expect(workflow).toContain("supabase test db --local");
  });

  it("never pushes migrations to production from CI", () => {
    // Prod migrations are applied manually until the prod migration ledger is
    // reconciled; an automatic db push would apply drifted history on merge.
    expect(workflow).not.toMatch(/run: supabase db push/);
    expect(workflow).not.toContain("supabase link");
    expect(workflow).toContain("Supabase migrations are NOT deployed by CI");
    expect(workflow).toContain("bash scripts/deploy-functions.sh");
  });

  it("gates the edge-function deploy on the database replay", () => {
    expect(workflow).toContain("needs: [check, deno-test, database-test]");
  });

  it("fails CI before E2E when authenticated-test secrets are missing", () => {
    expect(workflow).toContain("run: npm run check:e2e-env");
  });

  it("uses the non-increasing lint warning budget", () => {
    expect(workflow).toContain("run: npm run lint:ci");
  });

  it("uses npm as the single package-manager authority", () => {
    expect(packageJson.packageManager).toMatch(/^npm@/);
    expect(existsSync(`${process.cwd()}/package-lock.json`)).toBe(true);
    expect(existsSync(`${process.cwd()}/bun.lock`)).toBe(false);
    expect(existsSync(`${process.cwd()}/bun.lockb`)).toBe(false);
  });

  it("enforces bundle budgets and smoke-tests deployed functions", () => {
    expect(workflow).toContain("run: npm run build:check");
    expect(workflow).toContain("run: bash scripts/smoke-test.sh");
  });
});
