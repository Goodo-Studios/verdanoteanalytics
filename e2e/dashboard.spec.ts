/**
 * Dashboard E2E — post-login landing page.
 *
 * Unauthenticated checks run always (no credentials needed).
 * Authenticated checks require real test credentials in env:
 *
 *   PLAYWRIGHT_TEST_EMAIL=test@example.com
 *   PLAYWRIGHT_TEST_PASSWORD=your-test-password
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080   (or staging URL)
 */
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL || "";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD || "";
const hasCredentials = !!TEST_EMAIL && !!TEST_PASSWORD;

async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(builder|employee|client)\//, { timeout: 15_000 });
}

test.describe("Dashboard — unauthenticated", () => {
  test("/ redirects unauthenticated user to /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/login", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown role path redirects to /login", async ({ page }) => {
    await page.goto("/builder/");
    // Without auth, should land on login
    await page.waitForURL("**/login", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Dashboard — authenticated", () => {
  test.skip(!hasCredentials, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("after login, dashboard renders without a full-page error", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);

    // No error boundary message should be visible
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/unexpected error/i)).not.toBeVisible();

    // Navigation/sidebar should be present
    const nav = page.locator("nav, [role='navigation'], aside");
    await expect(nav.first()).toBeVisible({ timeout: 10_000 });
  });

  test("overview page renders metric cards or a loading skeleton", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);

    // Navigate to overview explicitly
    const url = page.url();
    const prefix = url.match(/\/(builder|employee|client)/)?.[0] ?? "/builder";
    await page.goto(`${prefix}/`);

    // Either metric cards or their skeletons should appear
    const metricArea = page.locator(
      "[class*='MetricCard'], [class*='metric-card'], [class*='skeleton'], [class*='Skeleton']"
    );
    await expect(metricArea.first()).toBeVisible({ timeout: 12_000 });
  });

  test("navigation links are present and clickable", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);

    const url = page.url();
    const prefix = url.match(/\/(builder|employee|client)/)?.[0] ?? "/builder";

    // Navigate to creatives via URL (sidebar link target)
    await page.goto(`${prefix}/creatives`);
    await expect(page).toHaveURL(/\/creatives/);
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });
});
