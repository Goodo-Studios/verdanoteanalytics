/**
 * Auth setup project — authenticate ONCE per role and persist storage state.
 *
 * Why this exists: the authenticated specs (client-home, content-pipeline) each
 * used to sign in per-test via the /login form. Run serially in CI that meant
 * 6+ sequential client logins, and the cumulative login + role-resolution +
 * accounts-bootstrap latency blew past the per-test budget — the app would
 * still be on the post-login spinner (or with accounts unresolved, showing
 * "Select an account to view the content pipeline") when assertions ran. The
 * symptom looked like missing data; the cause was login throttling.
 *
 * The fix (the canonical Playwright pattern): authenticate each role exactly
 * once here, save the Supabase session (localStorage) into a storageState file,
 * and have every spec reuse it via `test.use({ storageState })`. No per-test
 * logins, so the auth/bootstrap budget is paid once.
 *
 * Skip-safety: when creds are absent these setup tests self-skip, and every
 * authenticated spec also self-skips (test.skip on the same creds), so the
 * storageState files are never read for skipped tests — no missing-file errors.
 */
import { test as setup, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_DIR = path.join(__dirname, ".auth");
export const CLIENT_STORAGE = "e2e/.auth/client.json";
export const STAFF_STORAGE = "e2e/.auth/staff.json";

const CLIENT_EMAIL = process.env.PLAYWRIGHT_CLIENT_EMAIL || "";
const CLIENT_PASSWORD = process.env.PLAYWRIGHT_CLIENT_PASSWORD || "";
const hasClientCreds = !!CLIENT_EMAIL && !!CLIENT_PASSWORD;

const STAFF_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL || "";
const STAFF_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD || "";
const hasStaffCreds = !!STAFF_EMAIL && !!STAFF_PASSWORD;

/**
 * Sign in via the /login form and wait for the post-login role redirect.
 * Internal 2-attempt retry with a generous 30s wait absorbs the one-time
 * auth/role-resolution latency that previously made per-test logins flaky.
 */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto("/login");
      await page.fill("#email", email);
      await page.fill("#password", password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/(builder|employee|client)\//, { timeout: 30_000 });
      return;
    } catch (err) {
      lastErr = err;
      // Reset session state before the second attempt.
      await page.context().clearCookies().catch(() => {});
      await page.evaluate(() => window.localStorage.clear()).catch(() => {});
    }
  }
  throw lastErr;
}

setup("authenticate client", async ({ page }) => {
  setup.skip(!hasClientCreds, "Set PLAYWRIGHT_CLIENT_EMAIL and PLAYWRIGHT_CLIENT_PASSWORD to run");
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await signIn(page, CLIENT_EMAIL, CLIENT_PASSWORD);
  await page.context().storageState({ path: CLIENT_STORAGE });
});

setup("authenticate staff", async ({ page }) => {
  setup.skip(!hasStaffCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);
  await page.context().storageState({ path: STAFF_STORAGE });
});
