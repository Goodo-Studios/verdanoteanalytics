/**
 * Sign in once per role on the deployed staging site and save the session for the specs.
 * Same idea as e2e/auth.setup.ts, with fixed staging emails and one shared password.
 */
import { test as setup } from "@playwright/test";
import fs from "node:fs";
import { AUTH_DIR, hasLogins, LOGINS, NEEDS_PASSWORD, storagePath, TEST_PASSWORD, type Role } from "./support";

for (const role of Object.keys(LOGINS) as Role[]) {
  setup(`sign in as the staging ${role}`, async ({ page }) => {
    setup.skip(!hasLogins, NEEDS_PASSWORD);
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await page.goto("/login");
    await page.fill("#email", LOGINS[role]);
    await page.fill("#password", TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(builder|employee|client)(\/|$)/, { timeout: 30_000 });
    await page.context().storageState({ path: storagePath(role) });
  });
}
