/**
 * Keep the Brain current (OS-016) on the deployed staging site. Read only: staging data is shared,
 * so it never sends a fix. It opens the form and cancels.
 *
 * As the staging builder: opens the first published Brain page, sees its owner and review line,
 * sees the Suggest a fix button, opens the form (prefilled with the page text) and cancels it.
 * With nothing published to any section the test records that and checks the empty sections.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

const SECTIONS = ["Handbook", "Playbooks", "Clients", "Insights"];

test.describe("builder: Brain review and suggest a fix", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("opens a page, sees owner and date, opens the fix form and cancels", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/knowledge/brain");
    await expect(page.getByRole("heading", { level: 1, name: "Brain" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Brain sections" });

    let opened = false;
    for (const name of SECTIONS) {
      await nav.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      const list = page.getByTestId("brain-list");
      await expect(list.or(page.getByText(`Nothing has been published to ${name} yet.`))).toBeVisible();
      if (!(await list.isVisible())) continue;

      await list.getByRole("button").first().click();
      const article = page.getByTestId("brain-page");
      await expect(article).toBeVisible();
      await expect(article.getByTestId("brain-owner")).toHaveText(/^Owner: .+/);
      await expect(article.getByTestId("brain-reviewed")).toHaveText(/^(Last reviewed .+|Not reviewed yet)$/);
      const tag = article.getByTestId("brain-needs-review");
      if (await tag.count()) await expect(tag).toHaveText("Needs review");

      await article.getByRole("button", { name: "Suggest a fix" }).click();
      const form = article.getByTestId("correction-form");
      await expect(form).toBeVisible();
      await expect(form.getByRole("heading", { name: "Suggest a fix" })).toBeVisible();
      await expect(form.getByLabel("Corrected text")).not.toHaveValue("");
      await expect(form.getByRole("button", { name: "Send to the owner" })).toBeDisabled();
      await form.getByRole("button", { name: "Cancel" }).click();
      await expect(form).toHaveCount(0);
      await expect(article.getByRole("button", { name: "Suggest a fix" })).toBeVisible();
      opened = true;
      break;
    }
    test.info().annotations.push({ type: "brain-review", description: opened ? "opened a page and the fix form" : "nothing published yet; checked the empty sections" });
    expect(watch.problems()).toEqual([]);
  });
});
