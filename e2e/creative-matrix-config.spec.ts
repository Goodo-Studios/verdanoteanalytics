/**
 * US-009 E2E — per-account taxonomy config surface (US-003).
 *
 * Taxonomy lives in the client hub (/clients/:slug/taxonomy). The old Settings "Taxonomy" tab is a
 * pointer to it. Covers the builder-only Taxonomy tab of a client: add / rename / archive a
 * Theme/Persona and persistence across a reload. Also asserts the builder-only guard: a client
 * session has no Taxonomy tab in Settings and cannot open a client hub.
 *
 * Live path needs a builder + Bearaby Supabase session
 * (PLAYWRIGHT_TEST_EMAIL / _PASSWORD); it self-skips otherwise. The guard spec
 * needs client creds (PLAYWRIGHT_CLIENT_EMAIL / _PASSWORD).
 */
import { test, expect } from "@playwright/test";
import {
  hasBuilderCreds,
  hasClientCreds,
  loginAsBuilder,
  loginAsClient,
  gotoSettings,
  openClientTaxonomy,
  openTaxonomyTab,
  rolePrefix,
} from "./support/creative-matrix";

test.describe("Creative Matrix — taxonomy config surface (US-003)", () => {
  test.skip(!hasBuilderCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("the old Settings Taxonomy tab points to the client's Taxonomy tab", async ({ page }) => {
    await loginAsBuilder(page);
    await gotoSettings(page);
    expect(await openTaxonomyTab(page), "builder must see the Taxonomy pointer in Settings").toBeTruthy();
    await expect(page.getByRole("heading", { name: /taxonomy now lives with each client/i })).toBeVisible();
    await page.getByRole("link", { name: /^Go to Clients$/ }).click();
    await expect(page).toHaveURL(/\/clients$/);
  });

  test("Taxonomy tab renders the account taxonomy panels", async ({ page }) => {
    await loginAsBuilder(page);
    expect(await openClientTaxonomy(page), "builder must see the client's Taxonomy tab").toBeTruthy();

    await expect(page.getByRole("heading", { name: /account taxonomy/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("heading", { name: /theme \/ persona list/i })).toBeVisible();
    // The 90-type creative-type activation panel is retired: Creative Type is
    // now the fixed four-value list from the ad naming convention.
    await expect(page.getByRole("heading", { name: /^creative types$/i })).toHaveCount(0);
  });

  test("add → rename → archive a Theme/Persona persists across reload", async ({ page }) => {
    await loginAsBuilder(page);
    expect(await openClientTaxonomy(page)).toBeTruthy();

    // Unique name so re-runs never collide with a prior entry.
    const original = `E2E Theme ${Date.now()}`;
    const renamed = `${original} (renamed)`;

    const input = page.getByPlaceholder(/New Theme\/Persona/i);
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(original);
    await page.getByRole("button", { name: /^Add$/ }).click();

    // The new row appears in the live list.
    await expect(page.getByText(original, { exact: true })).toBeVisible({ timeout: 10_000 });

    // Rename it via the row's pencil action, then save.
    await page.getByRole("button", { name: new RegExp(`^Rename ${escapeRegExp(original)}$`) }).click();
    // The rename input is autofocused and pre-filled; overwrite it.
    await page.locator("input:focus").fill(renamed);
    await page.getByRole("button", { name: /^Save name$/ }).click();
    await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 10_000 });

    // Archive it — it drops into the "Archived" group. The ThemeRow root carries
    // the `group` class, so scope to that row rather than a broad div match.
    const row = page.locator("div.group").filter({ hasText: renamed }).first();
    await row.getByRole("button", { name: /^Archive$/ }).click();
    await expect(page.getByText(/Archived \(/i)).toBeVisible({ timeout: 10_000 });

    // Persistence: reload (the address is the client's Taxonomy tab) and confirm the archived
    // entry survived the round-trip through the read RPC (not just optimistic UI state).
    await page.reload();
    await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("no creative-type activation toggles remain on the Taxonomy tab", async ({ page }) => {
    await loginAsBuilder(page);
    expect(await openClientTaxonomy(page)).toBeTruthy();

    await expect(page.getByRole("heading", { name: /theme \/ persona list/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("switch")).toHaveCount(0);
  });
});

test.describe("Creative Matrix — config surface builder-only guard (US-003)", () => {
  test.skip(!hasClientCreds, "Set PLAYWRIGHT_CLIENT_EMAIL and PLAYWRIGHT_CLIENT_PASSWORD to run");

  test("a client session has no Taxonomy tab in Settings and cannot open a client hub", async ({ page }) => {
    await loginAsClient(page);
    await gotoSettings(page);
    // The builder-only tab must be absent for a client.
    expect(await openTaxonomyTab(page), "client must NOT see the Taxonomy tab").toBeFalsy();
    await expect(page.getByRole("button", { name: /^Taxonomy$/ })).toHaveCount(0);
    // The hub is staff only: a client is sent to its own home.
    await page.goto(`${rolePrefix(page)}/clients/any-client/taxonomy`);
    await expect(page).not.toHaveURL(/\/clients\//, { timeout: 10_000 });
  });

  test("a client cannot land on /matrix (redirected to their index)", async ({ page }) => {
    await loginAsClient(page);
    const prefix = rolePrefix(page);
    await page.goto(`${prefix}/matrix`);
    // effectiveBuilder gate in App.tsx redirects non-builders to `${prefix}/`.
    await expect(page).not.toHaveURL(/\/matrix$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /creative matrix/i })).toHaveCount(0);
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
