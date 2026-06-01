/**
 * Content Pipeline E2E (US-005) — the live Coda→Verdanote pipeline surface.
 *
 * This is the truth signal for the coda-pipeline-live-sync project: it proves
 * that the once-DARK /pipeline page now renders LIVE task data sourced from the
 * 4-hourly `sync-coda-tasks` edge function into the `coda_tasks` table, for both
 * the client (brand owner) surface and the staff/agency surface.
 *
 * What it asserts end-to-end against the running app + prod data:
 *   1. CLIENT: signs in as a real client-role user, opens /pipeline, and sees the
 *      populated Content Pipeline (NOT the empty "Nothing in production" state and
 *      NOT the "Select an account" prompt). At least one task renders, and every
 *      rendered task carries one of the canonical display stages produced by the
 *      sync's STAGE_MAP (Planning | Production | Review | Your Review | Complete).
 *   2. CLIENT read-only invariant: the surface exposes no comment / approve /
 *      request-changes / upload controls and never leaks the internal coda.io URL.
 *   3. STAFF/AGENCY: signs in as a builder, opens /pipeline, and — selecting
 *      accounts via the account switcher — confirms at least one account renders a
 *      populated pipeline with live tasks. This proves staff see the same live
 *      pipeline data across client accounts.
 *
 * Authenticated checks require real test accounts in env (tests skip otherwise,
 * never silently pass):
 *   PLAYWRIGHT_CLIENT_EMAIL / PLAYWRIGHT_CLIENT_PASSWORD   (a client-role user
 *       whose linked account has resolvable live Coda tasks — see US-002)
 *   PLAYWRIGHT_TEST_EMAIL   / PLAYWRIGHT_TEST_PASSWORD     (a builder/staff user)
 *   PLAYWRIGHT_BASE_URL                                    (local dev or staging)
 */
import { test, expect, type Page } from "@playwright/test";

const CLIENT_EMAIL = process.env.PLAYWRIGHT_CLIENT_EMAIL || "";
const CLIENT_PASSWORD = process.env.PLAYWRIGHT_CLIENT_PASSWORD || "";
const hasClientCreds = !!CLIENT_EMAIL && !!CLIENT_PASSWORD;

const STAFF_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL || "";
const STAFF_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD || "";
const hasStaffCreds = !!STAFF_EMAIL && !!STAFF_PASSWORD;

/** The canonical display stages produced by the sync's STAGE_MAP. */
const DISPLAY_STAGES = new Set(["Planning", "Production", "Review", "Your Review", "Complete"]);

/**
 * No-login navigation: the role session is restored from the storageState saved
 * once by the `setup` project (e2e/auth.setup.ts), so we just navigate to the
 * app root and wait for the post-auth role redirect. This removes the per-test
 * /login submission that previously caused login-throttling flakiness when the
 * authenticated specs ran serially.
 */
async function gotoRoleHome(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/(builder|employee|client)\//, { timeout: 30_000 });
}

/** The role prefix (e.g. "/client") derived from the post-login URL. */
function rolePrefix(page: Page): string {
  return page.url().match(/\/(builder|employee|client)/)?.[0] ?? "/client";
}

/**
 * Assert that the populated Content Pipeline rendered for the currently-selected
 * account: at least one task row, and every task carries a canonical display
 * stage. Returns the set of distinct stages seen (always non-empty on success).
 */
async function expectPopulatedPipeline(page: Page): Promise<Set<string>> {
  const panel = page.locator('[data-testid="content-pipeline"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // The pipeline must NOT have degraded to the empty/onboarding state.
  await expect(page.locator('[data-testid="pipeline-empty"]')).toHaveCount(0);

  const tasks = page.locator('[data-testid="pipeline-task"]');
  const count = await tasks.count();
  expect(count, "expected the pipeline to render at least one live task").toBeGreaterThan(0);

  const stages = new Set<string>();
  for (let i = 0; i < count; i++) {
    const stage = await tasks.nth(i).getAttribute("data-stage");
    expect(stage, `task #${i} must carry a stage`).toBeTruthy();
    expect(
      DISPLAY_STAGES.has(stage as string),
      `task #${i} stage "${stage}" must be a canonical display stage`
    ).toBeTruthy();
    stages.add(stage as string);
  }
  // At least one task in an expected display column (matching its Coda stage).
  expect(stages.size, "expected at least one populated display stage").toBeGreaterThan(0);
  return stages;
}

test.describe("Content Pipeline — live Coda sync (US-005)", () => {
  test.describe("client surface", () => {
    test.skip(!hasClientCreds, "Set PLAYWRIGHT_CLIENT_EMAIL and PLAYWRIGHT_CLIENT_PASSWORD to run");
    // Reuse the client session authenticated once by the `setup` project.
    test.use({ storageState: "e2e/.auth/client.json" });

    test("client sees live pipeline tasks in display stages on /pipeline", async ({ page }) => {
      await gotoRoleHome(page);
      const prefix = rolePrefix(page);

      await page.goto(`${prefix}/pipeline`);

      // Populated pipeline with canonical display stages. We await this FIRST so
      // the account has fully resolved before we assert on the empty/onboarding
      // prompt — checking the prompt before the pipeline settles would race the
      // accounts-loading window.
      const stages = await expectPopulatedPipeline(page);

      // The client's single linked account auto-selects, so the "Select an
      // account" prompt must NOT appear once the pipeline has rendered.
      await expect(
        page.getByText(/select an account to view the content pipeline/i)
      ).toHaveCount(0);
      // Sanity: every observed stage is one the client UI knows how to colour.
      for (const s of stages) expect(DISPLAY_STAGES.has(s)).toBeTruthy();

      // Read-only invariant: no write/interaction affordances on the surface.
      const panel = page.locator('[data-testid="content-pipeline"]');
      await expect(
        panel.getByRole("button", { name: /comment|approve|request changes|upload/i })
      ).toHaveCount(0);
      // The internal Coda URL must never be surfaced to the client.
      await expect(panel.locator('a[href*="coda.io"]')).toHaveCount(0);
    });
  });

  test.describe("staff / agency surface", () => {
    test.skip(!hasStaffCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");
    // Reuse the staff session authenticated once by the `setup` project.
    test.use({ storageState: "e2e/.auth/staff.json" });

    test("staff sees live pipeline tasks for client accounts on /pipeline", async ({ page }) => {
      // TEMP-DIAG: capture the accounts API + role-resolution responses so we can
      // see whether the staff user is recognized as staff in prod.
      page.on("response", async (res) => {
        const u = res.url();
        if (u.includes("/functions/v1/accounts") || u.includes("/rpc/get_user_role")) {
          let body = "";
          try { body = (await res.text()).slice(0, 300); } catch { /* ignore */ }
          let req = "";
          try { req = (res.request().postData() || "").slice(0, 300); } catch { /* ignore */ }
          console.log(`[DIAG staff] ${res.status()} ${u.replace(/https?:\/\/[^/]+/, "")} req=${req} body=${body}`);
        }
      });

      await gotoRoleHome(page);
      const prefix = rolePrefix(page);
      console.log(`[DIAG staff] resolved prefix=${prefix} url=${page.url()}`);

      await page.goto(`${prefix}/pipeline`);
      await page.waitForTimeout(4000);

      // The account switcher (Radix Select, role=combobox) lets staff pick a
      // specific client account. Enumerate the real account options (excluding
      // the "Agency View" aggregate) and select each until one renders a
      // populated pipeline — proving staff see live data across client accounts.
      const switcher = page.getByRole("combobox").first();
      await expect(switcher).toBeVisible({ timeout: 15_000 });
      await switcher.click();

      const optionEls = page.getByRole("option");
      await expect(optionEls.first()).toBeVisible({ timeout: 10_000 });
      const allNames = await optionEls.allInnerTexts();
      // Close the dropdown before iterating (we'll reopen per selection).
      await page.keyboard.press("Escape");

      const accountNames = allNames
        .map((n) => n.trim())
        .filter((n) => n && !/agency view/i.test(n));
      expect(accountNames.length, "expected staff to see selectable client accounts").toBeGreaterThan(0);

      // Bounded scan: most active clients have live tasks, so a populated
      // account is found quickly. Cap the scan so the test stays well within
      // the suite timeout even if early accounts happen to be empty.
      const MAX_SCAN = Math.min(accountNames.length, 8);
      let populated = false;
      for (let i = 0; i < MAX_SCAN && !populated; i++) {
        await switcher.click();
        await page.getByRole("option", { name: accountNames[i], exact: true }).click();

        // Wait for the pipeline to resolve to either populated or empty for the
        // newly-selected account.
        const panel = page.locator('[data-testid="content-pipeline"]');
        const empty = page.locator('[data-testid="pipeline-empty"]');
        await expect(panel.or(empty).first()).toBeVisible({ timeout: 15_000 });

        if ((await panel.count()) > 0 && (await page.locator('[data-testid="pipeline-task"]').count()) > 0) {
          populated = true;
        }
      }

      expect(
        populated,
        `expected at least one of the first ${MAX_SCAN} client accounts to render live pipeline tasks for staff`
      ).toBeTruthy();

      // Re-assert the full populated-pipeline invariant on the account we landed on.
      await expectPopulatedPipeline(page);
    });
  });
});
