/**
 * Staff area E2E: a client cannot load any staff page, and an employee can.
 *
 * Runs in a real browser against a running app whose backend is the STAGING Supabase
 * project (never production). Sessions come from the storage states saved by
 * e2e/auth.setup.ts.
 *
 * Required env (the matching tests skip when it is missing, as in the other specs):
 *   PLAYWRIGHT_CLIENT_EMAIL / PLAYWRIGHT_CLIENT_PASSWORD      client-a@staging.verdanote.test
 *   PLAYWRIGHT_EMPLOYEE_EMAIL / PLAYWRIGHT_EMPLOYEE_PASSWORD  employee@staging.verdanote.test
 *   PLAYWRIGHT_BASE_URL                                       a local dev server pointed at staging,
 *                                                             or the staging site
 * See docs/staging.md for the one command that sets all of this up from the vault.
 */
import { test, expect } from "@playwright/test";

const hasClientCreds = !!process.env.PLAYWRIGHT_CLIENT_EMAIL && !!process.env.PLAYWRIGHT_CLIENT_PASSWORD;
const hasEmployeeCreds = !!process.env.PLAYWRIGHT_EMPLOYEE_EMAIL && !!process.env.PLAYWRIGHT_EMPLOYEE_PASSWORD;

/** Staff pages, relative to the role prefix. Keep in step with STAFF_PAGES in src/test/StaffArea.test.tsx. */
/** Builder-only pages: an employee is redirected to the index. */
const BUILDER_ONLY_PATHS = ["/matrix", "/growth-dashboard"];

const STAFF_PATHS = [
  "/staff",
  "/agency",
  "/creative-library",
  "/tagging",
  "/briefs",
  "/landing-pages",
  "/creative-rotation",
  "/entities",
  "/matrix",
  "/growth-dashboard",
  "/ad-name-generator",
  "/integration-health",
  "/meeting-recaps",
  "/knowledge",
  "/follow-ups",
  "/creator-pipeline",
  "/clients/demo-glowdrip",
  "/clients",
  "/approval-boards",
  "/locations",
  "/props",
  "/crew",
  "/shipments",
  "/production-calendar",
  "/casting",
  "/applications",
  "/applications/creators/de5a0000-0000-4000-8000-000000000700",
  "/actors",
  "/actors/de5a0000-0000-4000-8000-000000000500",
  "/creators",
  "/creators/de5a0000-0000-4000-8000-000000000300",
  "/engagements",
  "/deliverables",
  "/qa-gates",
  "/handoffs",
  "/agent-evaluations",
  "/operations",
  "/learning",
  "/scope-changes",
  "/recommendations",
  "/strategy",
  "/ad-library",
  "/ad-library/boards",
  "/ad-library/hooks",
  "/reports/00000000-0000-0000-0000-000000000000/build",
];

test.describe("client cannot load staff pages", () => {
  test.use({ storageState: "e2e/.auth/client.json" });
  test.skip(!hasClientCreds, "Set PLAYWRIGHT_CLIENT_EMAIL and PLAYWRIGHT_CLIENT_PASSWORD to run");

  for (const path of STAFF_PATHS) {
    for (const prefix of ["/client", "/builder", "/employee"]) {
      test(`${prefix}${path} lands on the client home`, async ({ page }) => {
        await page.goto(`${prefix}${path}`);
        // The app corrects the prefix and redirects guarded pages to the client index.
        await page.waitForURL((u) => u.pathname.replace(/\/$/, "") === "/client", { timeout: 15_000 });
        // Whatever loaded, the staff menu and builder controls are not on screen.
        await expect(page.getByRole("heading", { name: "Staff menu" })).toHaveCount(0);
        await expect(page.getByText("Moving in", { exact: true })).toHaveCount(0);
        // And a client never gets the staff sidebar entry.
        await expect(page.getByRole("link", { name: "Staff menu" })).toHaveCount(0);
      });
    }
  }
});

test.describe("employee reaches staff pages", () => {
  test.use({ storageState: "e2e/.auth/employee.json" });
  test.skip(!hasEmployeeCreds, "Set PLAYWRIGHT_EMPLOYEE_EMAIL and PLAYWRIGHT_EMPLOYEE_PASSWORD to run");

  test("staff menu loads with links and slots", async ({ page }) => {
    await page.goto("/employee/staff");
    await expect(page.getByRole("heading", { name: "Staff menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /Goodo Time/ })).toHaveAttribute("href", /goodo-time/);
    await expect(page.getByRole("link", { name: /Attio/ })).toHaveAttribute("href", /attio\.com/);
    await expect(page.getByRole("link", { name: /Old dashboard public pages/ })).toHaveAttribute("href", /goodostudios-production/);
    await expect(page.getByText("Growth Dashboard")).toHaveCount(0); // builder only
    // Live now, so it is a link on the menu (the sidebar has one too, hence the test id).
    await expect(page.getByTestId("staff-menu-ad-name-generator")).toHaveAttribute("href", "/employee/ad-name-generator");
  });

  test("the sidebar offers the staff menu", async ({ page }) => {
    await page.goto("/employee/");
    await expect(page.getByRole("link", { name: "Staff menu" })).toBeVisible({ timeout: 30_000 });
  });

  for (const path of STAFF_PATHS.filter((p) => !BUILDER_ONLY_PATHS.includes(p) && !p.includes("/build"))) {
    test(`/employee${path} stays on the staff page`, async ({ page }) => {
      await page.goto(`/employee${path}`);
      await page.waitForLoadState("networkidle");
      expect(new URL(page.url()).pathname.replace(/\/$/, "")).toBe(`/employee${path}`);
      await expect(page.getByText(/page not found/i)).toHaveCount(0);
    });
  }

  for (const path of BUILDER_ONLY_PATHS) {
    test(`/employee${path} is builder only and redirects to the index`, async ({ page }) => {
      await page.goto(`/employee${path}`);
      await page.waitForURL(/\/employee\/?$/, { timeout: 30_000 });
    });
  }
});
