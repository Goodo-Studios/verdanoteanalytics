/**
 * Frame-retention curves E2E (US-006 AC1).
 *
 * Covers the three user-visible surfaces of the play-curve feature:
 *   1. Sortable retention threshold column in the creatives table.
 *   2. The drop-off retention curve in the creative detail modal.
 *   3. The clean empty-state when a creative has no curve (non-video /
 *      not-yet-backfilled) — never a zero chart.
 *
 * Resilient by design: skips when no test credentials are set, and annotates
 * (rather than fails) when an account has no creatives to click into. The
 * modal test accepts EITHER the populated curve OR the empty-state, so it
 * passes regardless of whether the first creative happens to be a video.
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

test.describe("Frame-retention curves", () => {
  test.skip(!hasCredentials, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("retention threshold column header is present and sortable", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    await goToCreatives(page);

    // Default-visible retention threshold column (retention_p50 → "Ret @50%").
    await page.waitForTimeout(3_000); // allow data fetch + table mount

    const tableCount = await page.locator("table").count();
    if (tableCount === 0) {
      test.info().annotations.push({ type: "skip-reason", description: "Creatives not in table view" });
      return;
    }

    const retentionHeader = page.getByRole("columnheader", { name: /ret(ention)? @\s*50%/i });
    await expect(retentionHeader.first()).toBeVisible({ timeout: 12_000 });

    // Sortable: clicking the header must not throw a full-page error.
    await retentionHeader.first().click();
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 5_000 });
    // Table still rendered after the sort.
    await expect(page.locator("table").first()).toBeVisible();
  });

  test("creative detail modal shows the retention curve or its empty-state", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    await goToCreatives(page);

    await page.waitForTimeout(3_000); // allow data fetch

    const firstRow = page.locator("tbody tr, [class*='card'][class*='creative']").first();
    if ((await firstRow.count()) === 0) {
      test.info().annotations.push({ type: "skip-reason", description: "No creatives in account" });
      return;
    }

    await firstRow.click();

    const modal = page.locator("[role='dialog'], [class*='modal' i], [class*='sheet' i]");
    await expect(modal.first()).toBeVisible({ timeout: 8_000 });

    // Either the populated curve panel ("Retention curve") OR the clean
    // empty-state must render — never a broken/zero chart.
    const populated = modal.getByText(/retention curve/i);
    const emptyState = page.getByTestId("retention-curve-empty");
    await expect(populated.or(emptyState).first()).toBeVisible({ timeout: 8_000 });
  });
});
