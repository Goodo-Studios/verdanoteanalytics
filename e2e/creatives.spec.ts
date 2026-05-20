/**
 * Creatives page E2E — creative library, table/grid rendering, detail modal.
 *
 * Requires real test credentials to see actual data:
 *   PLAYWRIGHT_TEST_EMAIL=test@example.com
 *   PLAYWRIGHT_TEST_PASSWORD=your-test-password
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

async function goToCreatives(page: import("@playwright/test").Page) {
  const url = page.url();
  const prefix = url.match(/\/(builder|employee|client)/)?.[0] ?? "/builder";
  await page.goto(`${prefix}/creatives`);
  await expect(page).toHaveURL(/\/creatives/);
}

test.describe("Creatives page", () => {
  test.skip(!hasCredentials, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("creatives page loads without a full-page error", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    await goToCreatives(page);

    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 5_000 });
  });

  test("creatives table or grid renders within 15s", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    await goToCreatives(page);

    // Table, card grid, or skeleton should be visible — not a blank page
    const content = page.locator("table, [class*='grid'], [class*='card'], [class*='skeleton']");
    await expect(content.first()).toBeVisible({ timeout: 15_000 });
  });

  test("filter controls are present on the creatives page", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    await goToCreatives(page);

    // Filters bar — look for a search input or filter button
    const filterArea = page.locator(
      "input[placeholder*='search' i], input[placeholder*='filter' i], button[aria-label*='filter' i], [class*='filter' i]"
    );
    // At least one filter control should exist
    await expect(filterArea.first()).toBeVisible({ timeout: 12_000 });
  });

  test("clicking a creative row opens the detail modal", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    await goToCreatives(page);

    // Wait for rows/cards to load (not just skeletons)
    await page.waitForTimeout(3_000); // allow data fetch

    // Try clicking the first clickable row in the table
    const firstRow = page.locator("tbody tr, [class*='card'][class*='creative']").first();
    const rowCount = await firstRow.count();
    if (rowCount === 0) {
      test.info().annotations.push({ type: "skip-reason", description: "No creatives in account" });
      return;
    }

    await firstRow.click();

    // The detail modal/sheet should appear
    const modal = page.locator("[role='dialog'], [class*='modal' i], [class*='sheet' i]");
    await expect(modal.first()).toBeVisible({ timeout: 8_000 });
  });
});
