import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(`${process.cwd()}/.github/workflows/ci.yml`, "utf8");
const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8"));

// Text of one top-level job (from its "  name:" line to the next job or EOF).
function job(name: string): string {
  const start = workflow.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  expect(start, `job ${name} exists`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

const PROD_REF = "gwyxaqoaldnaavkjqquv";

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
    // Scoped to the production job: the staging job below is allowed to push.
    const prod = job("deploy-functions");
    expect(prod).not.toMatch(/run: supabase db push/);
    expect(prod).not.toContain("supabase link");
    expect(prod).toContain("Supabase migrations are NOT deployed by CI");
    expect(prod).toContain("bash scripts/deploy-functions.sh");
  });

  it("deploys staging only from the staging branch, with staging secrets only", () => {
    const staging = job("deploy-staging");
    expect(staging).toContain("github.ref == 'refs/heads/staging'");
    expect(staging).not.toContain("refs/heads/main");
    // Never reads a production secret.
    const secretNames = [...staging.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secretNames.length).toBeGreaterThan(0);
    for (const n of secretNames) expect(n).toMatch(/^STAGING_/);
    // Refuses the production project and locks down cron/URLs after migrating.
    expect(staging).toContain(PROD_REF);
    expect(staging).toContain("scripts/staging-lockdown.sql");
    expect(staging).toContain("supabase db push");
  });

  it("keeps the production deploy off the staging branch and out of staging secrets", () => {
    const prod = job("deploy-functions");
    expect(prod).toContain("github.ref == 'refs/heads/main'");
    expect(prod).not.toContain("secrets.STAGING_");
  });

  it("never runs the production-credential E2E job for staging", () => {
    const e2e = job("e2e");
    expect(e2e).toContain("github.ref != 'refs/heads/staging'");
    expect(e2e).toContain("github.base_ref != 'staging'");
  });

  it("gates the edge-function deploy on the database replay", () => {
    expect(workflow).toContain("needs: [check, deno-test, database-test]");
  });

  it("fails CI before E2E when authenticated-test secrets are missing", () => {
    expect(workflow).toContain("run: npm run check:e2e-env");
  });

  it("runs the node script tests (scripts/*.test.mjs) in the check job", () => {
    expect(workflow).toContain("run: npm run test:scripts");
    expect(job("check")).toContain("run: npm run test:scripts");
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

  it("pins every Supabase CLI install to one explicit version", () => {
    // "latest" pulled in new major CLI versions that broke the staging deploy
    // twice on 2026-11-09 (db push defaulting to local, remote SQL asking for
    // confirmation). Every setup-cli step must name the same exact version.
    const steps = [
      ...workflow.matchAll(/uses: supabase\/setup-cli@\S+\n((?: {8,}.*\n)*)/g),
    ];
    expect(steps.length).toBeGreaterThanOrEqual(3);
    const versions = steps.map((m) => {
      const v = m[1].match(/^ +version: *(\S+)\s*$/m);
      expect(v, "setup-cli step has a version").not.toBeNull();
      return v![1];
    });
    for (const v of versions) {
      expect(v).not.toBe("latest");
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(new Set(versions).size).toBe(1);
    expect(workflow).not.toMatch(/version: *latest/);
  });

  it("keeps the staging deploy commands explicit about the remote project", () => {
    const staging = job("deploy-staging");
    expect(staging).toContain("supabase db push --linked --include-all --yes");
    expect(staging).toContain("supabase db query --linked --yes");
  });

  it("enforces bundle budgets and smoke-tests deployed functions", () => {
    expect(workflow).toContain("run: npm run build:check");
    expect(workflow).toContain("run: bash scripts/smoke-test.sh");
  });
});
