/**
 * My work (OS-009) on the deployed staging site. Staging test logins are not linked to ClickUp
 * people, so the builder's own list is empty: the page must show its heading, the My work tab and
 * the "No tasks assigned to you" empty state, and log no console error.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

test.describe("builder: My work", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("renders the heading and the empty state without a console error", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/my-work");
    await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Home tabs" }).getByRole("link", { name: "My work" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("No tasks assigned to you")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });
});
