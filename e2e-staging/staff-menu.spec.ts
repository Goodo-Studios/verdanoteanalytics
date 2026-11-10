/**
 * Staff menu on the deployed staging site: every menu item, every section and every tab loads,
 * shows a page heading and logs no console error. The tab list is read from src/lib/sections.ts,
 * so a tab added there is tested without an edit here.
 */
import { test, expect } from "@playwright/test";
import { SECTIONS, STAFF_NAV } from "../src/lib/sections";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

/**
 * Console errors known on one tab, with the reason. A new kind of error on that tab, or any error
 * on another tab, still fails. Remove an entry when its cause is fixed.
 *
 * Creative > Creatives: the page tries to fetch its grey placeholder image, which is a data: URL,
 * and connect-src in the CSP (vercel.json) does not allow data:. Each card logs three errors.
 * The fix is a CSP or code change, so it is listed here instead of hidden.
 */
const KNOWN_ON_TAB: Record<string, RegExp[]> = {
  "creative/creatives": [
    /^Connecting to 'data:image\/svg\+xml.*violates the following Content Security Policy directive: "connect-src/s,
    /^Fetch API cannot load data:image\/svg\+xml/,
    /^Media load error: TypeError: Failed to fetch/,
  ],
};

test.describe("builder: the seven menu items", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("the sidebar lists every menu item", async ({ page }) => {
    await page.goto("/builder/");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const item of STAFF_NAV) {
      await expect(nav.getByRole("link", { name: item.label, exact: true })).toBeVisible();
    }
  });

  for (const item of STAFF_NAV.filter((i) => i.id === "home" || i.id === "clients")) {
    test(`${item.label} renders its heading without a console error`, async ({ page }) => {
      const watch = watchConsole(page);
      await page.goto(`/builder${item.url}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(watch.problems()).toEqual([]);
    });
  }
});

for (const section of SECTIONS) {
  test.describe(`builder: ${section.label}`, () => {
    test.use({ storageState: storagePath("builder") });
    test.skip(!hasLogins, NEEDS_PASSWORD);

    test(`the ${section.label} menu item opens its first tab`, async ({ page }) => {
      await page.goto("/builder/");
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: section.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/builder/${section.id}/`));
      const tabs = page.getByRole("navigation", { name: `${section.label} tabs` });
      for (const tab of section.tabs) {
        await expect(tabs.getByRole("link", { name: tab.label, exact: true })).toBeVisible();
      }
    });

    for (const tab of section.tabs) {
      test(`${section.label} > ${tab.label} renders its heading without a console error`, async ({ page }) => {
        const watch = watchConsole(page, KNOWN_ON_TAB[`${section.id}/${tab.slug}`]);
        await page.goto(`/builder/${section.id}/${tab.slug}`);
        await expect(page).toHaveURL(new RegExp(`/builder/${section.id}/${tab.slug}`));
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expect(page.getByText(/page not found/i)).toHaveCount(0);
        await page.waitForLoadState("networkidle");
        expect(watch.problems()).toEqual([]);
      });
    }
  });
}
