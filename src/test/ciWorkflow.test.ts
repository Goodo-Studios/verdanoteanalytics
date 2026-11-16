import { spawnSync } from "node:child_process";
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

  it("runs browser tests on the deployed staging site after the staging deploy, with staging secrets only", () => {
    const e2e = job("e2e-staging");
    expect(e2e).toContain("needs: [deploy-staging]");
    expect(e2e).toContain("github.ref == 'refs/heads/staging'");
    expect(e2e).not.toContain("refs/heads/main");
    const secretNames = [...e2e.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secretNames.length).toBeGreaterThan(0);
    for (const n of secretNames) expect(n).toMatch(/^STAGING_/);
    expect(e2e).toContain("npm run test:e2e:staging");
    expect(packageJson.scripts["test:e2e:staging"]).toContain("playwright.staging.config.ts");
  });

  it("skips the staging browser tests with a message naming the missing secret, not silently", () => {
    const e2e = job("e2e-staging");
    expect(e2e).toContain("::warning title=Staging browser tests skipped::");
    expect(e2e).toContain("STAGING_TEST_PASSWORD");
    expect(e2e).toContain("STAGING_GATE_PASSWORD");
    // Every step after the check only runs when the secrets are present.
    const steps = e2e.split(/\n {6}- /);
    for (const marker of ["setup-node@v4", "npm ci", "playwright install", "npm run test:e2e:staging"]) {
      const step = steps.find((s) => s.includes(marker));
      expect(step, marker).toBeDefined();
      expect(step, marker).toContain("if: steps.cfg.outputs.configured == 'true'");
    }
  });

  it("keeps the staging browser tests out of the production E2E run and away from production", () => {
    // playwright.config.ts (production job) only collects ./e2e; the staging specs live in ./e2e-staging.
    const config = readFileSync(`${process.cwd()}/playwright.config.ts`, "utf8");
    expect(config).toContain('testDir: "./e2e"');
    const staging = readFileSync(`${process.cwd()}/playwright.staging.config.ts`, "utf8");
    expect(staging).toContain('testDir: "./e2e-staging"');
    expect(staging).toContain("points at production");
  });

  it("limits the default token to read access on repository contents (second-round audit L11)", () => {
    // A top-level block, before any job, so every job inherits it.
    const head = workflow.slice(0, workflow.search(/^jobs:\s*$/m));
    expect(head).toMatch(/^permissions:\s*\n {2}contents: read\s*$/m);
    // No job asks for more, and nothing in the file needs a write scope.
    expect(workflow.match(/^[ \t]*permissions:/gm)?.length ?? 0).toBe(1);
    expect(workflow).not.toMatch(/(contents|pull-requests|issues|packages|id-token):\s*write/);
  });

  it("names the project for every function deploy and refuses to run without it (second-round audit L11)", () => {
    expect(job("deploy-functions")).toContain("SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}");
    expect(job("deploy-staging")).toContain("SUPABASE_PROJECT_ID: ${{ secrets.STAGING_SUPABASE_PROJECT_ID }}");

    const script = `${process.cwd()}/scripts/deploy-functions.sh`;
    const env = { ...process.env };
    delete env.SUPABASE_PROJECT_ID;
    // Stops before it reaches the Supabase CLI, so nothing is deployed anywhere.
    const run = spawnSync("bash", [script], { env, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("SUPABASE_PROJECT_ID is not set");
    expect(run.stderr).toContain("Nothing was deployed");
    expect(run.stdout).not.toContain("Deploying");

    const source = readFileSync(script, "utf8");
    expect(source).toContain('--project-ref "$SUPABASE_PROJECT_ID"');
    expect(source).not.toContain("DEPLOY_ARGS");
  });

  it("gates the edge-function deploys on the database replay and the Deno check and lint", () => {
    expect(job("deploy-functions")).toContain("needs: [check, deno-test, deno-check, database-test]");
    expect(job("deploy-staging")).toContain("needs: [check, deno-test, deno-check, database-test]");
  });

  it("type-checks and lints every edge function (no --no-check, no skipped files)", () => {
    const deno = job("deno-check");
    expect(deno).toContain("run: deno lint");
    expect(deno).toContain("run: deno check --vendor --frozen supabase/functions");
    expect(deno).not.toContain("--no-check");
    const config = readFileSync(`${process.cwd()}/deno.json`, "utf8");
    // Lint covers the whole functions folder, and only these two rules are switched off (each has a reason).
    expect(config).toContain('"include": ["supabase/functions/"]');
    expect(config).not.toMatch(/"exclude":\s*\[[^\]]*supabase\/functions/);
    const disabled = [...config.matchAll(/^\s*"([a-z-]+)"\s*,?\s*$/gm)].map((m) => m[1]);
    expect(disabled.sort()).toEqual(["no-explicit-any", "no-import-prefix"]);
  });

  it("builds the app and checks the bundle budgets on every run, not only in the E2E job", () => {
    expect(job("check")).toContain("run: npm run build:check");
    expect(job("e2e")).not.toContain("build:check");
  });

  it("cancels superseded pull request runs but never a push run, and serialises the production deploy", () => {
    const head = workflow.slice(0, workflow.search(/^jobs:\s*$/m));
    expect(head).toMatch(/^concurrency:\s*$/m);
    expect(head).toContain("format('ci-pr-{0}', github.event.pull_request.number)");
    expect(head).toContain("format('ci-run-{0}', github.run_id)");
    expect(head).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    const prod = job("deploy-functions");
    expect(prod).toMatch(/concurrency:\s*\n\s+group: prod-deploy\s*\n\s+cancel-in-progress: false/);
  });

  it("checks the production migration ledger on main, read-only, with no new secret", () => {
    const gate = job("migrations-pending");
    expect(gate).toContain("github.ref == 'refs/heads/main'");
    expect(gate).toContain("github.event_name == 'push'");
    expect(gate).toContain("node scripts/check-migrations-applied.mjs");
    const secretNames = [...gate.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]).sort();
    expect(secretNames).toEqual(["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID"]);
    expect(gate).not.toMatch(/db push|supabase link/);
    // Nothing may wait on the gate, so it can never block or trigger a deploy.
    for (const other of ["check", "deno-test", "deno-check", "database-test", "e2e", "deploy-functions", "deploy-staging"]) {
      expect(job(other)).not.toContain("migrations-pending");
    }
  });

  it("fails CI before E2E when authenticated-test secrets are missing", () => {
    expect(workflow).toContain("run: npm run check:e2e-env");
    // Audit Batch 9: the employee login is passed in, so employee specs run instead of skipping.
    const e2e = job("e2e");
    expect(e2e).toContain("PLAYWRIGHT_EMPLOYEE_EMAIL: ${{ secrets.PLAYWRIGHT_EMPLOYEE_EMAIL }}");
    expect(e2e).toContain("PLAYWRIGHT_EMPLOYEE_PASSWORD: ${{ secrets.PLAYWRIGHT_EMPLOYEE_PASSWORD }}");
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
