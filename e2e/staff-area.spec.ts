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

/**
 * Staff pages, relative to the role prefix. Old addresses redirect to a tab of a section, so each
 * one is checked and so is the new section address. Keep in step with STAFF_PAGES in
 * src/test/StaffArea.test.tsx and the sections in src/lib/sections.ts.
 */
/** Builder-only pages: an employee is redirected to the index. */
const BUILDER_ONLY_PATHS = ["/matrix", "/growth-dashboard", "/operating-costs", "/creative/matrix", "/admin/growth", "/admin/operating-costs"];

/** The new section addresses (one tab each is enough to show the section loads). */
const SECTION_PATHS = [
  "/production/calendar",
  "/production/crew",
  "/talent/creators",
  "/talent/pipeline",
  "/creative/overview",
  "/creative/analytics",
  "/creative/vault",
  "/knowledge/shared",
  "/knowledge/meetings",
  "/admin/team",
  "/admin/support",
  "/creative/matrix",
];

const STAFF_PATHS = [
  "/staff",
  ...SECTION_PATHS,
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
  "/admin/ad-name-generator",
  "/tools/ad-name-generator",
  "/integration-health",
  "/meeting-recaps",
  "/knowledge",
  "/follow-ups",
  "/creator-pipeline",
  "/clients/demo-glowdrip",
  "/clients/demo-glowdrip/work",
  "/clients/demo-glowdrip/performance",
  "/clients/demo-glowdrip/brand-doc",
  "/clients/demo-glowdrip/scope/engagements",
  "/clients",
  "/approval-boards",
  "/locations",
  "/props",
  "/crew",
  "/shipments",
  "/production-calendar",
  "/casting",
  "/call-sheets",
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
  "/operating-costs",
  "/support",
  "/bids",
  "/team",
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
        await expect(page.getByRole("heading", { name: "Home", exact: true })).toHaveCount(0);
        await expect(page.getByText("Moving in", { exact: true })).toHaveCount(0);
        // And a client never gets the staff sidebar entries or the client switcher.
        for (const name of ["Clients", "Production", "Talent", "Creative", "Knowledge", "Tools", "Admin"]) {
          await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
        }
        await expect(page.getByTestId("client-switcher")).toHaveCount(0);
      });
    }
  }
});

test.describe("employee reaches staff pages", () => {
  test.use({ storageState: "e2e/.auth/employee.json" });
  test.skip(!hasEmployeeCreds, "Set PLAYWRIGHT_EMPLOYEE_EMAIL and PLAYWRIGHT_EMPLOYEE_PASSWORD to run");

  test("Home loads without Go to cards, outside-app cards or builder-only entries", async ({ page }) => {
    await page.goto("/employee/staff");
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname.replace(/\/$/, "")).toBe("/employee");
    await expect(page.getByTestId("home-card-production")).toHaveCount(0);
    await expect(page.getByTestId("home-app-goodo-time")).toHaveCount(0);
    await expect(page.getByTestId("home-app-old-dashboard-public")).toHaveCount(0);
    await expect(page.getByText("Growth Dashboard")).toHaveCount(0); // builder only
  });

  test("the sidebar has the eight staff menu items, and the client switcher shows on Creative only", async ({ page }) => {
    await page.goto("/employee/");
    for (const name of ["Home", "Clients", "Production", "Talent", "Creative", "Knowledge", "Tools", "Admin"]) {
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true })).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByRole("link", { name: "Staff menu" })).toHaveCount(0);
    await expect(page.getByTestId("client-switcher")).toHaveCount(0);
    await page.goto("/employee/creative/agency");
    await expect(page.getByTestId("client-switcher").getByRole("combobox", { name: "Client", exact: true })).toBeVisible({ timeout: 30_000 });
  });

  for (const path of STAFF_PATHS.filter((p) => !BUILDER_ONLY_PATHS.includes(p) && !p.includes("/build"))) {
    test(`/employee${path} loads a staff page`, async ({ page }) => {
      await page.goto(`/employee${path}`);
      await page.waitForLoadState("networkidle");
      // Old addresses redirect to a section tab, so the address may differ; it is never the index or a 404.
      const now = new URL(page.url()).pathname.replace(/\/$/, "");
      if (path !== "/staff") expect(now).not.toBe("/employee");
      expect(now.startsWith("/employee")).toBe(true);
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
