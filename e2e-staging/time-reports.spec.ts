/**
 * Time reports (OS-013) on the deployed staging site. Read only: it makes, changes and deletes
 * nothing, so it works on whatever time staging holds (or none).
 *
 * As the staging builder: opens /builder/time/reports from the Time tab, switches through every
 * grouping, picks this month, and downloads the CSV, whose first line is the header (after the BOM).
 * As the staging employee: the page opens with no person filter and no person grouping.
 */
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

const HEADER = "Date,Start,End,Hours,H:MM,Person,Email,Client,Task,Content type,Category,Description";

test.describe("builder: time reports", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("opens from the Time tab, switches groupings and downloads the CSV", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/time");
    await page.getByTestId("time-reports-link").click();
    await expect(page).toHaveURL(/\/builder\/time\/reports$/);
    await expect(page.getByRole("heading", { level: 1, name: "Time reports" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Home tabs" }).getByRole("link", { name: "Time" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Person")).toBeVisible();

    await page.getByLabel("Range").selectOption("this-month");
    await expect(page.getByTestId("time-report-range")).toBeVisible();

    for (const label of ["Person", "Task", "Content type", "Category", "Client"]) {
      await page.getByLabel("Group by").selectOption({ label });
      await expect(page.getByLabel("Group by")).toHaveValue(/.+/);
      await expect(page.getByTestId("time-report-total")).toBeVisible();
    }

    // With no time in the range the file still has its header, so this works on an empty staging.
    const csv = page.getByTestId("time-report-csv");
    await expect(csv).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download"), csv.click()]);
    expect(download.suggestedFilename()).toMatch(/^time-report-\d{4}-\d{2}-01-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile((await download.path())!, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split("\r\n")[0]).toBe(HEADER);
    expect(watch.problems()).toEqual([]);
  });
});

test.describe("employee: time reports", () => {
  test.use({ storageState: storagePath("employee") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("sees only their own time, with no person filter or grouping", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/employee/time/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Time reports" })).toBeVisible();
    await expect(page.getByTestId("time-report-controls")).toBeVisible();
    await expect(page.getByLabel("Person")).toHaveCount(0);
    await expect(page.getByLabel("Group by").locator("option", { hasText: "Person" })).toHaveCount(0);
    expect(watch.problems()).toEqual([]);
  });
});
