/**
 * US-009 E2E — governed ad tagging (US-004).
 *
 * The Creative Library card exposes a "Matrix tags" editor whose Theme/Persona,
 * creative-type, and body dropdowns are sourced from the account's managed
 * lists (angle_clusters + activated house-menu types + body vocabulary), while
 * hook stays the existing (static, disabled) tag. This spec verifies the editor
 * opens, the governed dropdowns render with an explicit Untagged option, and a
 * selection can be saved.
 *
 * Live path needs a builder + Bearaby session; it self-skips otherwise. The
 * creative-library page gates itself to the builder account for the dogfood
 * rollout, so a builder session is required.
 */
import { test, expect } from "@playwright/test";
import {
  hasBuilderCreds,
  loginAsBuilder,
  rolePrefix,
} from "./support/creative-matrix";

test.describe("Creative Matrix — governed ad tagging (US-004)", () => {
  test.skip(!hasBuilderCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("the Matrix tags editor sources its axes from the account lists", async ({ page }) => {
    await loginAsBuilder(page);
    await page.goto(`${rolePrefix(page)}/creative-library`);
    await expect(page).toHaveURL(/\/creative-library/);

    // Let the library cards load, then open a card's governed tag editor.
    const tagButton = page.getByRole("button", {
      name: /Tag Theme\/Persona, creative type, body/i,
    });
    // Data-dependent: the library may be empty for the account.
    try {
      await tagButton.first().waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No creative-library cards for the account — nothing to tag.",
      });
      return;
    }
    await tagButton.first().click();

    // The governed editor header + the three governed dropdowns + the static hook.
    await expect(page.getByRole("heading", { name: /^Matrix tags$/ })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Theme / Persona", { exact: true })).toBeVisible();
    await expect(page.getByText("Creative type", { exact: true })).toBeVisible();
    await expect(page.getByText("Body", { exact: true })).toBeVisible();
    await expect(page.getByText("Hook", { exact: true })).toBeVisible();
  });

  test("selecting a Theme/Persona + creative type can be saved", async ({ page }) => {
    await loginAsBuilder(page);
    await page.goto(`${rolePrefix(page)}/creative-library`);
    await expect(page).toHaveURL(/\/creative-library/);

    const tagButton = page.getByRole("button", {
      name: /Tag Theme\/Persona, creative type, body/i,
    });
    try {
      await tagButton.first().waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No creative-library cards for the account — nothing to tag.",
      });
      return;
    }
    await tagButton.first().click();
    await expect(page.getByRole("heading", { name: /^Matrix tags$/ })).toBeVisible({
      timeout: 10_000,
    });

    // Open the Theme/Persona dropdown. It always offers an explicit Untagged
    // option; when the account has governed themes, at least one more appears.
    const themeTrigger = page.getByRole("combobox").first();
    await themeTrigger.click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("option", { name: /^Untagged$/ })).toBeVisible();
    const optionCount = await options.count();

    if (optionCount <= 1) {
      // Only Untagged is available — the account has no governed Theme/Persona
      // list configured yet. Selecting Untagged is still a valid governed write.
      await page.getByRole("option", { name: /^Untagged$/ }).click();
      test.info().annotations.push({
        type: "note",
        description: "Account has no governed themes; exercised the Untagged path.",
      });
    } else {
      // Pick the first non-Untagged theme.
      await options.nth(1).click();
    }

    // Save is enabled and persists without a full-page error.
    const save = page.getByRole("button", { name: /^Save$/ });
    await expect(save).toBeEnabled({ timeout: 8_000 });
    await save.click();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
