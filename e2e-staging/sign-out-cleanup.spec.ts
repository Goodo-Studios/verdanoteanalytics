/**
 * Sign-out cleanup in a real browser on staging (audit plan item 3.1).
 *
 * Both tests sign in through the login form in a fresh browser context and switch users in the
 * same tab, the way a shared computer is used:
 *  - a builder's "preview as client" must not carry over to the next person who signs in;
 *  - a slow response for client A that lands after A signs out must not show A's accounts to
 *    client B (client-b@staging.verdanote.test has no linked accounts).
 */
import { test, expect, type Page } from "@playwright/test";
import { hasLogins, LOGINS, NEEDS_PASSWORD, TEST_PASSWORD } from "./support";

const CLIENT_B = "client-b@staging.verdanote.test";

// The first sign-in opens /login. Later sign-ins reuse the login page the app shows after sign-out,
// with no page load in between: a reload would reset in-memory state and hide the problem.
async function signIn(page: Page, email: string, { load = true } = {}) {
  if (load) await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(builder|employee|client)(\/|$)/, { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
}

test.describe("sign-out cleanup", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("a builder's client preview does not carry over to the next login", async ({ page }) => {
    await signIn(page, LOGINS.builder);
    await page.getByRole("button", { name: "client", exact: true }).click();
    await expect(page.getByText(/Client Preview Mode/)).toBeVisible();
    await signOut(page);
    await signIn(page, LOGINS.employee, { load: false });
    await expect(page).toHaveURL(/\/employee(\/|$)/);
    await expect(page.getByText(/Preview Mode/)).toHaveCount(0);
  });

  test("a slow response for client A never shows A's accounts to client B", async ({ page }) => {
    // Read client A's account names from its own accounts list as it arrives.
    const names = new Set<string>();
    const collect = async (r: import("@playwright/test").Response) => {
      if (!r.url().includes("/functions/v1/accounts") || !r.ok()) return;
      const rows = await r.json().catch(() => null);
      for (const row of Array.isArray(rows) ? rows : []) if (typeof row?.name === "string" && row.name.length > 3) names.add(row.name);
    };
    page.on("response", collect);
    await signIn(page, LOGINS.client);
    await expect.poll(() => names.size, { message: "client A should have at least one linked account on staging" }).toBeGreaterThan(0);
    page.off("response", collect);

    // Hold every data request that client A starts from here on for 6 seconds.
    let delayA = true;
    await page.route(/\/(functions|rest)\/v1\//, async (route) => {
      if (delayA) await new Promise((r) => setTimeout(r, 6_000));
      await route.continue();
    });
    await page.goto("/client/reports");
    await page.waitForTimeout(500);
    await signOut(page);
    delayA = false;

    await signIn(page, CLIENT_B, { load: false });
    // Let every held response for client A arrive while client B is signed in.
    await page.waitForTimeout(8_000);
    const body = await page.locator("body").innerText();
    for (const name of names) expect(body, `client B must not see client A's account "${name}"`).not.toContain(name);
  });
});
