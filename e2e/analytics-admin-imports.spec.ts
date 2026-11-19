/**
 * E2E for the analytics, admin and imports fixes (branch feat/review-analytics-admin).
 *
 * Needs the same staging setup as staff-area.spec.ts (see docs/staging.md). Not run in CI here: it
 * skips without PLAYWRIGHT_EMPLOYEE_EMAIL / PLAYWRIGHT_EMPLOYEE_PASSWORD.
 *
 *  - Creative > Overview with All clients picked shows the agency overview.
 *  - The Time log can check a CSV and shows row errors without writing anything.
 */
import { test, expect } from "@playwright/test";

const hasEmployeeCreds = !!process.env.PLAYWRIGHT_EMPLOYEE_EMAIL && !!process.env.PLAYWRIGHT_EMPLOYEE_PASSWORD;

test.describe("employee: overview and time import", () => {
  test.use({ storageState: "e2e/.auth/employee.json" });
  test.skip(!hasEmployeeCreds, "Set PLAYWRIGHT_EMPLOYEE_EMAIL and PLAYWRIGHT_EMPLOYEE_PASSWORD to run");

  test("Creative > Overview with All clients shows the agency overview", async ({ page }) => {
    await page.goto("/employee/creative/overview");
    const picker = page.getByRole("combobox", { name: "Client" });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await picker.selectOption({ label: "All clients" });
    await expect(page.getByTestId("overview-agency")).toBeVisible({ timeout: 30_000 });
  });

  test("Time log CSV import checks the file and refuses a wrong row without saving", async ({ page }) => {
    await page.goto("/employee/time");
    await page.getByTestId("time-import-open").click();
    await page.getByLabel("Time CSV text").fill("Date,Start,End,Client,Category,Description\n2026-11-02,09:00,10:00,No Such Client,Editing,");
    await page.getByTestId("time-import-check").click();
    await expect(page.getByTestId("time-import-errors")).toContainText("Line 2");
    await expect(page.getByTestId("time-import-errors")).toContainText("Nothing was imported");
    await expect(page.getByTestId("time-import-run")).toHaveCount(0);
  });
});
