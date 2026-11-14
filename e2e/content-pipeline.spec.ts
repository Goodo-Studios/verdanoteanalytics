/**
 * Content Pipeline E2E (US-005) — the live ClickUp→Verdanote pipeline surface.
 *
 * This is the truth signal for the pipeline sync: it proves
 * that the once-DARK /pipeline page now renders LIVE task data sourced from the
 * 4-hourly `sync-clickup-tasks` edge function into the `pipeline_tasks` table, for both
 * the client (brand owner) surface and the staff/agency surface.
 *
 * What it asserts end-to-end against the running app + prod data:
 *   1. CLIENT: signs in as a real client-role user, opens /pipeline, and sees the
 *      populated Content Pipeline (NOT the empty "Nothing in production" state and
 *      NOT the "Select an account" prompt). At least one task renders, and every
 *      rendered task carries one of the canonical display stages produced by the
 *      sync's STAGE_MAP (Preparing Content | Production | Editing | Client
 *      Review | Ready to Launch — the five-column model reconciled 2026-06-02).
 *   2. CLIENT interaction invariant: the surface exposes no comment / upload
 *      controls, Approve and Request changes appear only inside a decision panel
 *      (Client Review and delivered cards), and no internal ClickUp URL leaks.
 *   3. STAFF/AGENCY: signs in as a builder, reads the Clients list for clients
 *      with content-board cards, and confirms their Work tab (/clients/<slug>/work)
 *      renders the live board with canonical stages. Staff have no separate
 *      /pipeline page; it redirects to the Clients list.
 *
 * Authenticated checks require real test accounts in env (tests skip otherwise,
 * never silently pass):
 *   PLAYWRIGHT_CLIENT_EMAIL / PLAYWRIGHT_CLIENT_PASSWORD   (a client-role user
 *       whose linked account has asset tasks in its ClickUp client folder)
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

/**
 * The canonical display stages produced by the sync's STAGE_MAP. Reconciled
 * 2026-06-02 with the column-model change (PR #17): the board now mirrors the
 * delivery workflow as five client-facing columns. These MUST stay in lockstep
 * with the STAGE_MAP values in
 * supabase/functions/_shared/clickup-pipeline.ts — a drift here is what silently
 * red-lined this spec after PR #17 (the old collapsed buckets — Planning /
 * Review / Your Review / Complete — no longer exist in synced data).
 */
const DISPLAY_STAGES = new Set([
  "Preparing Content",
  "Production",
  "Editing",
  "Client Review",
  "Ready to Launch",
]);

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
  // At least one task in an expected display column (mapped from its ClickUp status).
  expect(stages.size, "expected at least one populated display stage").toBeGreaterThan(0);
  return stages;
}

test.describe("Content Pipeline — live ClickUp sync (US-005)", () => {
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

      // A client login loads its own board without choosing an account (rows of
      // its linked ad accounts or of its own clients by client_slug), so the
      // "Select an account" prompt must NOT appear.
      await expect(
        page.getByText(/select an account to view the content pipeline/i)
      ).toHaveCount(0);
      // Sanity: every observed stage is one the client UI knows how to colour.
      for (const s of stages) expect(DISPLAY_STAGES.has(s)).toBeTruthy();

      // Interaction invariant. Phase 5b gave the client Approve and Request changes on cards in
      // Client Review and on delivered work, so those two buttons are expected. They must live only
      // inside a decision panel. Comment and upload controls must still never appear.
      const panel = page.locator('[data-testid="content-pipeline"]');
      await expect(panel.getByRole("button", { name: /comment|upload/i })).toHaveCount(0);
      const decisionButtons = /approve|request changes/i;
      const allDecisionButtons = await panel.getByRole("button", { name: decisionButtons }).count();
      const panelDecisionButtons = await panel
        .locator('[data-testid="decision-panel"]')
        .getByRole("button", { name: decisionButtons })
        .count();
      expect(
        allDecisionButtons,
        "Approve and Request changes may only appear inside a decision panel"
      ).toBe(panelDecisionButtons);
      // No internal task-system URL may be surfaced to the client.
      await expect(panel.locator('a[href*="clickup.com"]')).toHaveCount(0);
      await expect(panel.locator('a[href*="coda.io"]')).toHaveCount(0);
    });
  });

  test.describe("staff / agency surface", () => {
    test.skip(!hasStaffCreds, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");
    // Reuse the staff session authenticated once by the `setup` project.
    test.use({ storageState: "e2e/.auth/staff.json" });

    test("staff sees live pipeline tasks for client accounts on /pipeline", async ({ page }) => {
      await gotoRoleHome(page);
      const prefix = rolePrefix(page);

      // Staff no longer have a separate /pipeline page: the board is the Work tab of each
      // client's hub (/clients/<slug>/work), and /pipeline redirects to the Clients list. The
      // Clients list shows each client's content board as "N cards". Find the clients that
      // have cards and check that their Work tab renders the live board.
      await page.goto(`${prefix}/clients`);
      const clientLinks = page.locator('a[href*="/clients/"]');
      await expect(clientLinks.first()).toBeVisible({ timeout: 20_000 });

      const withCards: string[] = [];
      for (const link of await clientLinks.all()) {
        const text = (await link.innerText()).replace(/\s+/g, " ");
        const href = (await link.getAttribute("href")) || "";
        const m = text.match(/Content board\s+(\d+) cards?/i);
        const slug = href.match(/\/clients\/([^/?#]+)$/)?.[1];
        if (m && Number(m[1]) > 0 && slug) withCards.push(slug);
      }
      expect(
        withCards.length,
        "expected staff to see at least one client with cards on its content board"
      ).toBeGreaterThan(0);

      // Bounded scan, same reason as before: keep the test inside the suite timeout.
      const MAX_SCAN = Math.min(withCards.length, 5);
      let populated = false;
      for (let i = 0; i < MAX_SCAN && !populated; i++) {
        await page.goto(`${prefix}/clients/${withCards[i]}/work`);
        const board = page.locator('[data-testid="client-work"]');
        await expect(board).toBeVisible({ timeout: 15_000 });
        const cards = page.locator('[data-testid="client-work-card"]');
        const empty = page.locator('[data-testid="client-work-empty"]');
        await expect(cards.first().or(empty)).toBeVisible({ timeout: 15_000 });
        if ((await cards.count()) > 0) {
          populated = true;
          for (let c = 0; c < (await cards.count()); c++) {
            const stage = await cards.nth(c).getAttribute("data-stage");
            expect(
              DISPLAY_STAGES.has(stage as string),
              `work card #${c} stage "${stage}" must be a canonical display stage`
            ).toBeTruthy();
          }
        }
      }

      expect(
        populated,
        `expected at least one of the first ${MAX_SCAN} clients with cards to render its live work board for staff`
      ).toBeTruthy();
    });
  });
});
