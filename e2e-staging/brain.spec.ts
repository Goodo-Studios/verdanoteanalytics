/**
 * Brain (OS-014) on the deployed staging site. Read only: it changes nothing, so it works on
 * whatever has been published to staging (or nothing).
 *
 * As the staging builder: opens Knowledge > Brain, sees the four section tabs, and, when a
 * section has a published page, opens it and sees its owner and last-reviewed line. With nothing
 * published every section shows its empty message instead.
 * As the staging client: the Brain address does not show the Brain.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

const SECTIONS = ["Handbook", "Playbooks", "Clients", "Insights"];

test.describe("builder: Brain", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("shows the four sections and opens a page with its owner and review date", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/knowledge/brain");
    await expect(page.getByRole("heading", { level: 1, name: "Brain" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Brain sections" });
    for (const name of SECTIONS) await expect(nav.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();

    let opened = false;
    for (const name of SECTIONS) {
      await nav.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      const list = page.getByTestId("brain-list");
      const empty = page.getByText(`Nothing has been published to ${name} yet.`);
      await expect(list.or(empty)).toBeVisible();
      if (await list.isVisible()) {
        await list.getByRole("button").first().click();
        const article = page.getByTestId("brain-page");
        await expect(article).toBeVisible();
        await expect(article.getByTestId("brain-owner")).toHaveText(/^Owner: .+/);
        await expect(article.getByTestId("brain-reviewed")).toHaveText(/^(Last reviewed .+|Not reviewed yet)$/);
        opened = true;
        break;
      }
    }
    test.info().annotations.push({ type: "brain", description: opened ? "opened a published page" : "nothing published yet; checked the empty sections" });
    expect(watch.problems()).toEqual([]);
  });
});

test.describe("client: Brain", () => {
  test.use({ storageState: storagePath("client") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("does not see the Brain", async ({ page }) => {
    await page.goto("/builder/knowledge/brain");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("navigation", { name: "Brain sections" })).toHaveCount(0);
  });
});
