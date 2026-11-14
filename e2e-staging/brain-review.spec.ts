/**
 * Keep the Brain current (OS-016) on the deployed staging site. Read only: staging data is shared,
 * so it never saves an edit. It opens the editor and cancels.
 *
 * As the staging builder: opens the first published Brain page, sees its owner and review line,
 * sees the Edit this page button, opens the editor (prefilled with the page text) and cancels it.
 * With nothing published to any section the test records that and checks the empty sections.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

const SECTIONS = ["Handbook", "Playbooks", "Clients", "Insights"];

test.describe("builder: Brain review and edit", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("opens a page, sees owner and date, opens the editor and cancels", async ({ page }) => {
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

      await expect(article.getByRole("button", { name: "Suggest a fix" })).toHaveCount(0);
      await article.getByRole("button", { name: "Edit this page" }).click();
      const editor = article.getByTestId("document-editor");
      await expect(editor).toBeVisible();
      await expect(editor.getByLabel("Page text")).not.toHaveValue("");
      await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
      await editor.getByRole("button", { name: "Cancel" }).click();
      await expect(editor).toHaveCount(0);
      await expect(article.getByRole("button", { name: "Edit this page" })).toBeVisible();
      opened = true;
      break;
    }
    test.info().annotations.push({ type: "brain-review", description: opened ? "opened a page and the editor" : "nothing published yet; checked the empty sections" });
    expect(watch.problems()).toEqual([]);
  });
});
