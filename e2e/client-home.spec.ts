/**
 * Client surface E2E (US-009, updated for the client-analytics-nav change).
 *
 * As of PR #25 the client hub was changed: clients no longer land on the
 * purpose-built ClientHomePage (now retired). Instead a client gets the core
 * analytics surface — they land on the shared Overview dashboard and can open
 * Creatives and Analytics with full access (including performance metrics:
 * CPA / CTR / CPM / ROAS / spend / grades — this is intentional "full access").
 *
 * What is still guaranteed for a client, and asserted here end-to-end:
 *   1. The client lands on the Overview dashboard at `${prefix}/` — NOT the
 *      retired ClientHome (its `performance-snapshot` section never renders).
 *   2. The client can reach Creatives and Analytics (no redirect).
 *   3. The deeper strategist surfaces (/tagging, /briefs, /ad-library,
 *      /viral-feed) STILL redirect the client back to the Overview index.
 *   4. Internal SYNC controls never render for a client — no "Sync" button on
 *      Overview/Creatives and no sync/media-refresh progress banner (the
 *      self-gated SyncStatusBanner / MediaRefreshBanner). This is the
 *      client-facing guarantee behind the hide-sync-from-clients fix.
 *   5. The retired draft-narrative authoring controls never render for a client.
 *
 * NOTE: cost metrics (CPA/CTR/CPM) are deliberately NOT forbidden anymore —
 * clients have full Creatives/Analytics access. Kill/Scale recommendations live
 * on Analytics and are visible to clients under full access; gating those is a
 * separate product decision, not asserted here.
 *
 * Authenticated checks require a real CLIENT-role test account in env:
 *   PLAYWRIGHT_CLIENT_EMAIL=client@example.com
 *   PLAYWRIGHT_CLIENT_PASSWORD=your-client-test-password
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080   (or staging URL)
 */
import { test, expect, type Page } from "@playwright/test";

const TEST_EMAIL = process.env.PLAYWRIGHT_CLIENT_EMAIL || "";
const TEST_PASSWORD = process.env.PLAYWRIGHT_CLIENT_PASSWORD || "";
const hasCredentials = !!TEST_EMAIL && !!TEST_PASSWORD;

/**
 * No-login navigation: the client session is restored from the storageState
 * saved once by the `setup` project (e2e/auth.setup.ts), so we just navigate to
 * the app root and wait for the post-auth role redirect to /:role/.
 */
async function gotoRoleHome(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/(builder|employee|client)\//, { timeout: 30_000 });
}

/** The role prefix (e.g. "/client") derived from the post-login URL. */
function rolePrefix(page: Page): string {
  return page.url().match(/\/(builder|employee|client)/)?.[0] ?? "/client";
}

/** Assert no internal Sync control is present on the current client surface. */
async function expectNoSyncControls(page: Page) {
  // No "Sync" action button (gated by effectiveClient on Overview + Creatives).
  await expect(page.getByRole("button", { name: /^sync$/i })).toHaveCount(0);
  // No sync / media-refresh progress banner (both self-gate for client views).
  await expect(page.getByText(/^Syncing\b/)).toHaveCount(0);
  await expect(page.getByText(/^Refreshing media\b/)).toHaveCount(0);
}

test.describe("Client surface (US-009)", () => {
  test.skip(!hasCredentials, "Set PLAYWRIGHT_CLIENT_EMAIL and PLAYWRIGHT_CLIENT_PASSWORD to run");
  // Reuse the client session authenticated once by the `setup` project.
  test.use({ storageState: "e2e/.auth/client.json" });

  test("client lands on the Overview dashboard, not the retired Client Home", async ({ page }) => {
    await gotoRoleHome(page);
    const prefix = rolePrefix(page);

    await page.goto(`${prefix}/`);
    await expect(page).toHaveURL(new RegExp(`${prefix}/?(\\?.*)?$`));

    // No full-page error boundary.
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 5_000 });

    // Overview dashboard renders its headline metric cards.
    await expect(page.getByText("Total Spend")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText("Avg ROAS")).toBeVisible();

    // The retired ClientHome surface must NOT be what renders.
    await expect(page.locator('[data-section="performance-snapshot"]')).toHaveCount(0);

    // No internal sync controls on the client's landing page.
    await expectNoSyncControls(page);
  });

  test("client can open Creatives and Analytics (full access, no redirect)", async ({ page }) => {
    await gotoRoleHome(page);
    const prefix = rolePrefix(page);

    // Creatives — reachable; URL stays on /creatives (a denied route would bounce
    // back to the index and this waitForURL would time out).
    await page.goto(`${prefix}/creatives`);
    await page.waitForURL(new RegExp(`${prefix}/creatives`), { timeout: 10_000 });
    await expect(
      page.getByText(/View and manage your ad creatives/i)
    ).toBeVisible({ timeout: 12_000 });
    await expectNoSyncControls(page);

    // Analytics — reachable; URL stays on /analytics.
    await page.goto(`${prefix}/analytics`);
    await page.waitForURL(new RegExp(`${prefix}/analytics`), { timeout: 10_000 });
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 5_000 });
  });

  test("deeper strategist routes still redirect the client to the Overview index", async ({
    page,
  }) => {
    await gotoRoleHome(page);
    const prefix = rolePrefix(page);

    // These remain client-gated and must bounce back to `${prefix}/`.
    const guardedPaths = ["/tagging", "/briefs", "/ad-library", "/viral-feed"];

    for (const path of guardedPaths) {
      await page.goto(`${prefix}${path}`);
      await page.waitForURL(new RegExp(`${prefix}/?(\\?.*)?$`), { timeout: 10_000 });
      expect(page.url(), `expected ${path} to redirect to the Overview index`).toMatch(
        new RegExp(`${prefix}/?(\\?.*)?$`)
      );
    }
  });

  test("client surface never exposes internal sync or draft-authoring controls", async ({
    page,
  }) => {
    await gotoRoleHome(page);
    const prefix = rolePrefix(page);
    await page.goto(`${prefix}/`);
    await expect(page.getByText("Total Spend")).toBeVisible({ timeout: 12_000 });

    // Sync controls absent on Overview...
    await expectNoSyncControls(page);

    // ...and on Creatives.
    await page.goto(`${prefix}/creatives`);
    await expect(page.getByText(/View and manage your ad creatives/i)).toBeVisible({
      timeout: 12_000,
    });
    await expectNoSyncControls(page);

    // The strategist draft-narrative authoring controls (retired with ClientHome,
    // and gated behind isAuthor regardless) must be absent from the client DOM.
    await expect(page.locator('[data-testid="highlights-author-controls"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Publish$/ })).toHaveCount(0);
    await expect(page.getByText(/Generate draft/i)).toHaveCount(0);

    // The Tagging strategist surface is not linked in the client nav.
    await expect(page.getByRole("link", { name: /^Tagging$/ })).toHaveCount(0);
  });
});
