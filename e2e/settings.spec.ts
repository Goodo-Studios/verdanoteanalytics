/**
 * Settings page E2E — Meta connection UI, token input, test connection.
 *
 * This does NOT test actual Meta API connectivity — it tests that the UI
 * renders correctly and the save/test buttons function at the component level.
 *
 * Requires credentials:
 *   PLAYWRIGHT_TEST_EMAIL=test@example.com
 *   PLAYWRIGHT_TEST_PASSWORD=your-test-password
 */
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL || "";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD || "";
const hasCredentials = !!TEST_EMAIL && !!TEST_PASSWORD;

async function loginAndGoToSettings(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", TEST_EMAIL);
  await page.fill("#password", TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(builder|employee|client)\//, { timeout: 15_000 });

  const url = page.url();
  const prefix = url.match(/\/(builder|employee|client)/)?.[0] ?? "/builder";
  await page.goto(`${prefix}/settings`);
  await expect(page).toHaveURL(/\/settings/);
}

// MetaConnectionSection lives in the Admin tab, visible only to builder role.
// Waits for the profile loading spinner to clear before checking for the tab.
// Returns true if the tab was found and clicked, false if the user is not a builder.
async function goToAdminTab(page: import("@playwright/test").Page): Promise<boolean> {
  try {
    const adminTab = page.getByRole("button", { name: /^Admin$/i });
    await adminTab.waitFor({ state: "visible", timeout: 8_000 });
    await adminTab.click();
    return true;
  } catch {
    return false;
  }
}

test.describe("Settings page", () => {
  test.skip(!hasCredentials, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("settings page loads without a full-page error", async ({ page }) => {
    await loginAndGoToSettings(page);
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 5_000 });
  });

  test("Meta Connection section is visible", async ({ page }) => {
    await loginAndGoToSettings(page);
    if (!(await goToAdminTab(page))) return; // builder-only; skip for other roles

    await expect(page.getByText(/meta connection/i)).toBeVisible({ timeout: 10_000 });
  });

  test("Meta token input field exists and accepts text", async ({ page }) => {
    await loginAndGoToSettings(page);
    if (!(await goToAdminTab(page))) return;

    const tokenInput = page.locator("#meta-token");
    await expect(tokenInput).toBeVisible({ timeout: 10_000 });

    // Type a dummy token to verify the input is interactive
    await tokenInput.fill("EAAtest123");
    await expect(tokenInput).toHaveValue("EAAtest123");
  });

  test("Save Token button is present and clickable", async ({ page }) => {
    await loginAndGoToSettings(page);
    if (!(await goToAdminTab(page))) return;

    await page.locator("#meta-token").fill("EAAtest123");

    const saveBtn = page.getByRole("button", { name: /save token/i });
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    await expect(saveBtn).toBeEnabled();
  });

  test("Test Connection button is present and clickable", async ({ page }) => {
    await loginAndGoToSettings(page);
    if (!(await goToAdminTab(page))) return;

    const testBtn = page.getByRole("button", { name: /test connection/i });
    await expect(testBtn).toBeVisible({ timeout: 10_000 });
    await expect(testBtn).toBeEnabled();
  });

  test("clicking Test Connection shows a loading or result state", async ({ page }) => {
    await loginAndGoToSettings(page);
    if (!(await goToAdminTab(page))) return;

    const testBtn = page.getByRole("button", { name: /test connection/i });
    await expect(testBtn).toBeVisible({ timeout: 10_000 });
    await testBtn.click();

    // After clicking, the button should either show a loading spinner or the result
    // We check that something changed — loading state OR a status message
    await expect(
      page.locator("[class*='animate-spin'], [class*='spinner']").or(
        page.getByText(/testing/i).or(
          page.getByText(/connected|not connected|error/i)
        )
      ).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
