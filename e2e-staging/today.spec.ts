/**
 * Today (OS-010) on the deployed staging site. Staging test logins are not linked to ClickUp people,
 * so the builder's own list is empty: the page shows the progress bar ("0 of 0 done today") and the
 * empty state, and no table. The builder view reads the imported ClickUp copy, so it lists late items
 * across all clients and client approvals outstanding. This test only reads: it never marks a task
 * done, because that would change the live ClickUp copy and show up in the nightly check.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

test.describe("builder: Today", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("leads with the progress bar and the next action area, no table, and the builder lists", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/");
    await expect(page.getByRole("navigation", { name: "Home tabs" }).getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("progressbar", { name: "Done today" })).toBeVisible();
    await expect(page.getByTestId("today-progress-label")).toHaveText(/^\d+ of \d+ done today$/);
    // Either one next action or the empty state, never both, and no table.
    await expect(page.getByTestId("today-next").or(page.getByTestId("today-empty"))).toBeVisible();
    expect((await page.getByTestId("today-next").count()) + (await page.getByTestId("today-empty").count())).toBe(1);
    await expect(page.getByTestId("today-panel").locator("table")).toHaveCount(0);

    const builder = page.getByTestId("today-builder");
    await expect(builder.getByRole("heading", { name: /Late across all clients/ })).toBeVisible();
    await expect(builder.getByRole("heading", { name: /Client approvals outstanding/ })).toBeVisible();
    await expect(builder.getByRole("heading", { name: /Decisions waiting/ })).toBeVisible();
    // The imported copy has late work, so the late list has rows, each with a date in the late colour.
    const lateRows = page.getByTestId("today-late-row");
    await expect(lateRows.first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });
});

test.describe("employee: Today", () => {
  test.use({ storageState: storagePath("employee") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("has the progress bar and no builder view", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/employee/");
    await expect(page.getByRole("progressbar", { name: "Done today" })).toBeVisible();
    await expect(page.getByTestId("today-builder")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });
});
