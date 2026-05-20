/**
 * Golden path E2E — login → role-prefixed overview.
 *
 * Requires a real Supabase dev/staging instance and test credentials.
 * Set these in .env.local (gitignored):
 *
 *   PLAYWRIGHT_TEST_EMAIL=test@example.com
 *   PLAYWRIGHT_TEST_PASSWORD=your-test-password
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080   (or your staging URL)
 */
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL || "";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD || "";

test.describe("Authentication flow", () => {
  test.beforeEach(async ({ page }) => {
    // Clear storage so every test starts unauthenticated
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("unauthenticated root redirects to /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/login", { timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("login form renders with email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("invalid credentials show an error message", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "invalid@example.com");
    await page.fill("#password", "wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Supabase returns a 400; the UI renders the error string
    await expect(page.locator(".text-destructive, [class*='destructive']").first()).toBeVisible({
      timeout: 10_000,
    });
    // Still on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run this test"
  );

  test("valid credentials redirect to role-prefixed dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", TEST_EMAIL);
    await page.fill("#password", TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // After auth, the app redirects to /:role/ (builder, employee, or client)
    await page.waitForURL(/\/(builder|employee|client)\//, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/(builder|employee|client)\//);

    // The page should no longer show the login form
    await expect(page.locator("#email")).not.toBeVisible();
  });
});
