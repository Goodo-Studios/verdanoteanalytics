/**
 * Timer and weekly log (OS-012) on the deployed staging site, as the staging builder.
 *
 * Opens /builder/time and sees the week view, starts an Internal timer in the category Admin from
 * the page, sees the pill on another staff page (My work) and again after a reload, stops it, then
 * deletes the entry it made. Every entry it makes carries a unique description, and cleanup only
 * ever deletes entries with that description, so copied Goodo Time rows and os_tasks are never
 * touched.
 */
import { test, expect, type Page } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

const MARK = `e2e OS-012 ${Date.now()}`;

async function stopIfRunning(page: Page) {
  const stop = page.getByTestId("timer-pill-stop");
  if (await stop.isVisible()) {
    await stop.click();
    await expect(page.getByTestId("timer-pill")).toBeHidden();
  }
}

/** Deletes this run's entries from the current week, through the page. */
async function deleteMine(page: Page) {
  await page.goto("/builder/time");
  await stopIfRunning(page);
  const mine = page.getByTestId("time-entry").filter({ hasText: MARK });
  for (let guard = 0; guard < 5; guard++) {
    const n = await mine.count();
    if (n === 0) break;
    await mine.first().getByTestId("time-entry-delete").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(mine).toHaveCount(n - 1);
  }
}

test.describe("builder: timer and weekly log", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test.afterEach(async ({ page }) => {
    await deleteMine(page);
    await expect(page.getByTestId("time-entry").filter({ hasText: MARK })).toHaveCount(0);
  });

  test("starts an Internal timer, keeps the pill across pages and a reload, stops it, deletes the entry", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/time");
    await expect(page.getByRole("heading", { level: 1, name: "Time" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Home tabs" }).getByRole("link", { name: "Time" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("time-week-label")).toBeVisible();
    await expect(page.getByTestId("time-day")).toHaveCount(7);
    await stopIfRunning(page);

    // Start an Internal timer in Admin.
    const form = page.getByTestId("time-start-form");
    await form.getByLabel("Client or Internal").selectOption({ label: "Internal" });
    await form.getByLabel("Category").selectOption("Admin");
    await form.getByLabel("Description").fill(MARK);
    await form.getByRole("button", { name: "Start timer" }).click();
    const pill = page.getByTestId("timer-pill");
    await expect(pill).toBeVisible();
    await expect(page.getByTestId("timer-pill-label")).toHaveText("Internal · Admin");

    // On another staff page, and after a reload.
    await page.getByRole("navigation", { name: "Home tabs" }).getByRole("link", { name: "My work" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
    await expect(pill).toBeVisible();
    await page.reload();
    await expect(pill).toBeVisible();
    await expect(page.getByTestId("timer-pill-label")).toHaveText("Internal · Admin");
    await expect(page.getByTestId("timer-pill-elapsed")).toHaveText(/^\d+:\d\d:\d\d$/);

    // Stop it. The entry is in the week with an end.
    await page.getByTestId("timer-pill-stop").click();
    await expect(pill).toBeHidden();
    await page.goto("/builder/time");
    const entry = page.getByTestId("time-entry").filter({ hasText: MARK });
    await expect(entry).toHaveCount(1);
    await expect(entry.getByTestId("time-entry-label")).toHaveText("Internal · Admin");
    await expect(entry).not.toContainText("running");

    // Delete it.
    await entry.getByTestId("time-entry-delete").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(entry).toHaveCount(0);

    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });
});
