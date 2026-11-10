/**
 * The two staff tools in the top bar on the deployed staging site: the client switcher and the
 * Cmd/Ctrl+K jump-to search.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath } from "./support";

test.describe("builder: top bar tools", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("the client switcher changes the client and keeps it when the page changes", async ({ page }) => {
    await page.goto("/builder/work");
    // The Work page has its own "Client" filter, so the switcher is found by its test id.
    const switcher = page.getByTestId("client-switcher").getByRole("combobox", { name: "Client", exact: true });
    await expect(switcher).toBeVisible();
    // Wait for the list to load: "All clients" plus at least two clients.
    await expect(switcher.locator("option")).not.toHaveCount(0);
    await expect.poll(async () => await switcher.locator("option").count(), { timeout: 20_000 }).toBeGreaterThan(2);
    const values = (await switcher.locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))).filter(Boolean);

    await switcher.selectOption(values[0]);
    await expect(switcher).toHaveValue(values[0]);
    await switcher.selectOption(values[1]);
    await expect(switcher).toHaveValue(values[1]);

    // The choice follows the person to another page.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Production", exact: true }).click();
    await expect(page).toHaveURL(/\/builder\/production\//);
    await expect(switcher).toHaveValue(values[1]);

    // And back to every client.
    await switcher.selectOption("");
    await expect(switcher).toHaveValue("");
  });

  test("Ctrl+K opens the search, it finds a page, and Enter opens it", async ({ page }) => {
    await page.goto("/builder/");
    await expect(page.getByTestId("command-palette-button")).toBeVisible();
    await page.keyboard.press("Control+k");
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill("call sheets");
    await expect(page.getByTestId("command-palette-item").first()).toContainText("Call sheets");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/builder\/production\/call-sheets/);
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
  });

  test("Escape closes the search and the button opens it again", async ({ page }) => {
    await page.goto("/builder/");
    // The shortcut is listening once the button is on screen.
    await expect(page.getByTestId("command-palette-button")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await page.getByTestId("command-palette-button").click();
    await expect(page.getByTestId("command-palette-input")).toBeVisible();
  });
});
