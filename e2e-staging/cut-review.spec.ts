/**
 * OS-020 cut review on the deployed staging site. Read only: it never adds a version, posts a
 * comment, approves or asks for changes.
 *
 * As client-a: the Review page renders each card's cut review (a version picker and a player or an
 * Open the cut link, or the plain "No cut to watch yet"), with no Internal label and no console
 * error. As the builder: My work with everyone's tasks opens a task panel that has the Versions
 * section, with no console error.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

test.describe("client: cut review on the Review page", () => {
  test.use({ storageState: storagePath("client") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("each review card shows its cut review and nothing internal", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/client/review");
    await expect(page.getByTestId("client-review-page")).toBeVisible();
    const cards = page.getByTestId("client-review-card");
    await expect(cards.first().or(page.getByText("Nothing to review right now"))).toBeVisible();
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const review = cards.nth(i).getByTestId("cut-review");
      await expect(review).toBeVisible();
      await expect(review.getByTestId("cut-no-versions").or(review.getByTestId("cut-version-body"))).toBeVisible();
      if (await review.getByTestId("cut-version-body").isVisible()) {
        await expect(review.getByTestId("cut-player").or(review.getByTestId("cut-open-link"))).toBeVisible();
      }
      await expect(review.getByTestId("cut-internal-label")).toHaveCount(0);
      await expect(review.getByLabel("Thread")).toHaveCount(0);
      await expect(review.getByTestId("cut-add-version")).toHaveCount(0);
      await expect(review.locator('[data-testid="cut-comment"][data-thread="internal"]')).toHaveCount(0);
    }
    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });
});

test.describe("builder: Versions in the task panel", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("a task panel has the Versions section", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/my-work?everyone=1");
    const row = page.getByTestId("my-task-row").first();
    await expect(row).toBeVisible();
    await row.click();
    const panel = page.getByTestId("task-panel");
    await expect(panel).toBeVisible();
    const versions = panel.getByTestId("task-panel-versions");
    await expect(versions).toBeVisible();
    await expect(versions.getByRole("heading", { name: "Versions" })).toBeVisible();
    await expect(versions.getByTestId("cut-no-versions").or(versions.getByTestId("cut-versions"))).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });
});
