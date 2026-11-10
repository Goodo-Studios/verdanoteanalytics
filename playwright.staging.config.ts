import { defineConfig, devices } from "@playwright/test";

// Browser tests against the DEPLOYED staging site (phase 6a). Run after the staging deploy, not
// before it. Separate from playwright.config.ts, which starts a local copy of the pages for the
// production E2E job. See docs/staging.md ("Browser tests on staging").
//
// Environment:
//   STAGING_TEST_PASSWORD   shared password of the four staging test logins (vault: STAGING_TEST_PASSWORD)
//   STAGING_GATE_PASSWORD   password of the staging site gate (user name "staging")
//   STAGING_E2E_BASE_URL    optional, default https://staging.verdanote.com
//   STAGING_GATE_USER       optional, default "staging"
// With STAGING_TEST_PASSWORD missing every test skips with a message that names it.

const baseURL = process.env.STAGING_E2E_BASE_URL || "https://staging.verdanote.com";

// Never aim these tests at production, whatever the variable says.
const host = new URL(baseURL).hostname;
if (host === "verdanote.com" || host === "www.verdanote.com" || host.startsWith("verdanoteanalytics")) {
  throw new Error(`STAGING_E2E_BASE_URL points at production (${host}). These tests run against staging only.`);
}

const gatePassword = process.env.STAGING_GATE_PASSWORD;

export default defineConfig({
  testDir: "./e2e-staging",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL,
    // The staging site asks for HTTP basic auth before it serves anything.
    httpCredentials: gatePassword ? { username: process.env.STAGING_GATE_USER || "staging", password: gatePassword } : undefined,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
});
