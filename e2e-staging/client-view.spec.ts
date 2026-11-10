/**
 * The client login on the deployed staging site (client-a@staging.verdanote.test): it sees only
 * its five menu items, is sent away from every staff route, and its pipeline page shows work
 * grouped by cycle or the plain empty state.
 */
import { test, expect } from "@playwright/test";
import { SECTIONS } from "../src/lib/sections";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

const CLIENT_ITEMS = ["Overview", "Creatives", "Analytics", "Content Pipeline", "Reports"];
const STAFF_ITEMS = ["Home", "Clients", "Production", "Talent", "Creative", "Knowledge", "Admin"];

test.describe("client: the wall in a real browser", () => {
  test.use({ storageState: storagePath("client") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("the menu has exactly the five client items and no staff tools", async ({ page }) => {
    await page.goto("/client/");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of CLIENT_ITEMS) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link")).toHaveCount(CLIENT_ITEMS.length);
    for (const name of STAFF_ITEMS) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId("client-switcher")).toHaveCount(0);
    await expect(page.getByTestId("command-palette-button")).toHaveCount(0);
  });

  test("Ctrl+K does nothing for a client", async ({ page }) => {
    await page.goto("/client/");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview", exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
  });

  // One tab of every section, plus the clients list, a client hub, the work page and the admin
  // tools: each lands on the client home, never on the staff page.
  const staffRoutes = [
    ...new Set([
      "/clients",
      "/clients/demo-glowdrip",
      "/work",
      ...SECTIONS.map((s) => `/${s.id}/${s.tabs[0].slug}`),
      "/admin/notifications",
      "/knowledge/bids",
    ]),
  ];
  for (const route of staffRoutes) {
    test(`${route} sends the client to its own home`, async ({ page }) => {
      await page.goto(`/client${route}`);
      await page.waitForURL((u) => u.pathname.replace(/\/$/, "") === "/client");
      for (const name of STAFF_ITEMS) {
        await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true })).toHaveCount(0);
      }
    });
  }

  test("the pipeline page shows a cycle group or the empty state, and no console error", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/client/pipeline");
    const cycle = page.getByTestId("pipeline-cycle").first();
    const empty = page.getByTestId("pipeline-empty");
    await expect(cycle.or(empty)).toBeVisible();
    if (await cycle.isVisible()) {
      await expect(page.getByTestId("pipeline-cycle-label").first()).not.toBeEmpty();
      await expect(page.getByTestId("pipeline-cycle-count").first()).toContainText(/\d+ of \d+ delivered/);
    }
    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });
});
