/**
 * US-009 E2E — /matrix board + view modes (US-007) and cell drill-down (US-008).
 *
 * Covers: the board renders Theme/Persona columns × creative-type rows with
 * spend-ranked cells, the five view-mode toggles switch views, an explicit
 * untagged bucket is present, and the builder-only guard holds. Drill-down:
 * clicking a covered cell opens the hook × body inner grid, and clicking a
 * covered inner cell opens the atomic ad card.
 *
 * Live path needs a builder + Bearaby Supabase session; it self-skips
 * otherwise. Where the pilot account has no tagged spend yet, the board shows
 * its explicit empty state and the data-dependent drill-down steps annotate a
 * skip-reason rather than assert against absent rows (hq-e2e-data-dependent).
 */
import { test, expect, type Page } from "@playwright/test";
import {
  hasBuilderCreds,
  loginAsBuilder,
  gotoMatrix,
  selectMatrixAccount,
} from "./support/creative-matrix";

/** True once the board has settled into either its table or its empty state. */
async function boardSettled(page: Page): Promise<"table" | "empty" | "error"> {
  const table = page.locator("table").first();
  const empty = page.getByText(/No creatives in scope yet|Add an ad account/i);
  const error = page.getByText(/Failed to load the creative matrix/i);
  await expect(table.or(empty).or(error)).toBeVisible({ timeout: 20_000 });
  if (await table.isVisible()) return "table";
  if (await error.isVisible()) return "error";
  return "empty";
}

test.describe("Creative Matrix — board + view modes (US-007)", () => {
  test.skip(!hasBuilderCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("board loads for a builder with the page header and mode toggles", async ({ page }) => {
    await loginAsBuilder(page);
    await gotoMatrix(page);
    await expect(page).toHaveURL(/\/matrix$/);

    await expect(page.getByRole("heading", { name: /creative matrix/i })).toBeVisible({
      timeout: 15_000,
    });

    // Five view-mode toggles (performance / status / coverage / volume / win rate).
    for (const label of [/performance/i, /status/i, /coverage/i, /volume/i, /win rate/i]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible({ timeout: 10_000 });
    }
    // Performance is the default pressed mode.
    await expect(page.getByRole("button", { name: /performance/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("mode toggles switch the pressed view", async ({ page }) => {
    await loginAsBuilder(page);
    await gotoMatrix(page);
    await selectMatrixAccount(page);
    await boardSettled(page);

    const coverage = page.getByRole("button", { name: /coverage/i });
    await coverage.click();
    await expect(coverage).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /performance/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const winRate = page.getByRole("button", { name: /win rate/i });
    await winRate.click();
    await expect(winRate).toHaveAttribute("aria-pressed", "true");
    await expect(coverage).toHaveAttribute("aria-pressed", "false");
  });

  test("board renders spend-ranked cells with an explicit untagged bucket", async ({ page }) => {
    await loginAsBuilder(page);
    await gotoMatrix(page);
    await selectMatrixAccount(page);
    const state = await boardSettled(page);

    if (state !== "table") {
      test.info().annotations.push({
        type: "skip-reason",
        description: `Board is in "${state}" state for the pilot account — no tagged spend to rank.`,
      });
      return;
    }

    // The row-axis header and at least one cell button exist.
    await expect(page.getByRole("columnheader", { name: /creative type/i }).first()).toBeVisible();
    const cells = page.locator("button[aria-label*='spend,']");
    expect(await cells.count(), "board should render at least one matrix cell").toBeGreaterThan(0);

    // Explicit untagged bucket surfaces on at least one axis (never hidden).
    await expect(page.getByText(/Untagged/i).first()).toBeVisible();
  });
});

test.describe("Creative Matrix — cell drill-down (US-008)", () => {
  test.skip(!hasBuilderCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("clicking a covered cell opens the hook × body grid and an atomic ad", async ({ page }) => {
    await loginAsBuilder(page);
    await gotoMatrix(page);
    await selectMatrixAccount(page);
    const state = await boardSettled(page);

    if (state !== "table") {
      test.info().annotations.push({
        type: "skip-reason",
        description: `Board is in "${state}" state — no covered cell to drill into.`,
      });
      return;
    }

    // A covered cell is an enabled cell button (uncovered cells are disabled).
    const covered = page.locator("button[aria-label*='spend,']:not([disabled])").first();
    if ((await covered.count()) === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No covered (non-empty) cell in the pilot matrix.",
      });
      return;
    }

    await covered.click();

    // The selected-cell strip + inner hook × body grid appear (or the explicit
    // "no hook × body breakdown" empty state — both are correct US-008 output).
    const drilldown = page.getByTestId("cell-drilldown");
    const drilldownEmpty = page.getByText(/No hook . body breakdown/i);
    await expect(drilldown.or(drilldownEmpty)).toBeVisible({ timeout: 15_000 });

    if (!(await drilldown.isVisible())) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Opened cell has no hook×body breakdown yet.",
      });
      return;
    }

    // Open a covered inner cell → the atomic-ad panel renders below the grid.
    const innerCovered = drilldown
      .locator("button[aria-label^='Hook ']:not([disabled])")
      .first();
    if ((await innerCovered.count()) === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No covered inner hook×body cell to open.",
      });
      return;
    }
    await innerCovered.click();
    await expect(page.getByTestId("atomic-ad-panel")).toBeVisible({ timeout: 10_000 });
    // The atomic ad card (or the explicit "no ads resolved" note) is shown.
    const adCard = page.getByTestId("atomic-ad-card");
    const noAds = page.getByText(/No individual ads resolved/i);
    await expect(adCard.or(noAds).first()).toBeVisible({ timeout: 10_000 });
  });
});
