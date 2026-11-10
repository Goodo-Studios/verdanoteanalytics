/**
 * Section pages (Production, Talent, Creative, Knowledge, Admin): one page each with tabs, and the
 * existing page for the open tab rendered unchanged.
 *  - Role gating: a builder sees every tab, an employee does not see the builder-only ones
 *    (Matrix, Growth Dashboard, Operating costs) and is sent away if they type the address, and a client,
 *    or a builder previewing the client view, never gets a section.
 *  - The Creative section's analytics tabs say so plainly when the selected client has no ad account.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";

const marker = (name: string) => ({ default: () => <div data-testid={`page-${name}`}>{name}</div> });
vi.mock("@/features/dashboard/ProductionCalendarPage", () => marker("production-calendar"));
vi.mock("@/features/dashboard/CastingPage", () => marker("casting"));
vi.mock("@/pages/OverviewPage", () => marker("overview"));
vi.mock("@/pages/AnalyticsPage", () => marker("analytics"));
vi.mock("@/pages/LandingPagesPage", () => marker("landing-pages"));
vi.mock("@/features/matrix/board/MatrixBoardPage", () => marker("matrix"));
vi.mock("@/features/vault/LibraryPage", () => marker("vault-library"));
vi.mock("@/features/vault/HooksPage", () => marker("vault-hooks"));
vi.mock("@/features/team/TeamPage", () => marker("team"));
vi.mock("@/features/operating-costs/OperatingCostsPage", () => marker("operating-costs"));
vi.mock("@/features/growth-dashboard/GrowthDashboardPage", () => marker("growth"));
vi.mock("@/features/knowledge/KnowledgePage", () => marker("knowledge"));

const h = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  preview: { isClientPreview: false, isEmployeePreview: false } as Record<string, unknown>,
  selectedAccountId: "act_a" as string,
  selection: { selectedSlug: "", selectedClient: null, noAccount: false } as Record<string, unknown>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ accounts: [], selectedAccountId: h.selectedAccountId, setSelectedAccountId: () => {} }),
}));
vi.mock("@/contexts/ClientSelectionContext", () => ({
  useClientSelection: () => ({ clients: [], setSelectedSlug: () => {}, linkedAccounts: [], isLoading: false, loadError: null, ...h.selection }),
  useSelectedClientSlug: () => h.selection.selectedSlug,
}));

import { SectionPage } from "@/components/sections/SectionPage";
import { SECTIONS, tabsFor } from "@/lib/sections";

type Role = "builder" | "employee" | "client";
function setRole(role: Role, opts: { clientPreview?: boolean } = {}) {
  h.auth = { user: { id: "u1" }, role, isBuilder: role === "builder", isEmployee: role === "employee", isClient: role === "client" };
  h.preview = { isClientPreview: !!opts.clientPreview, isEmployeePreview: false };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:role" element={<div data-testid="index">index</div>} />
        <Route path="/:role/" element={<div data-testid="index">index</div>} />
        {SECTIONS.flatMap((s) => [
          <Route key={s.id} path={`/:role/${s.id}`} element={<SectionPage section={s} />} />,
          <Route key={`${s.id}-tab`} path={`/:role/${s.id}/:tab`} element={<SectionPage section={s} />} />,
        ])}
        <Route path="*" element={<Navigate to="/builder" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tabNames = (section: string) =>
  within(screen.getByRole("navigation", { name: `${section} tabs` }))
    .getAllByRole("link")
    .map((a) => a.textContent);

beforeEach(() => {
  setRole("builder");
  h.selectedAccountId = "act_a";
  h.selection = { selectedSlug: "", selectedClient: null, noAccount: false };
});

describe("section model", () => {
  it("has the five tabbed sections with the agreed tabs", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(["Production", "Talent", "Creative", "Knowledge", "Admin"]);
    const labels = (id: string) => SECTIONS.find((s) => s.id === id)!.tabs.map((t) => t.label);
    expect(labels("production")).toEqual(["Production calendar", "Call sheets", "Casting", "Crew", "Locations", "Props", "Shipments"]);
    expect(labels("talent")).toEqual(["Creators", "Actors", "Applications", "Creator pipeline", "Follow-ups", "Approval boards"]);
    expect(labels("creative")).toEqual([
      "Overview", "Agency overview", "Creatives", "Creative Library", "Analytics", "Matrix", "Tagging", "Briefs", "Reports", "Landing Pages",
      "Creative Rotation", "Creative Diversity", "Library", "Boards", "Hooks",
    ]);
    expect(labels("knowledge")).toEqual(["Knowledge", "Learning", "Meeting recaps", "Client BIDs"]);
    expect(labels("admin")).toEqual([
      "Team and settings", "Integration health", "Notifications", "Operations", "Operating costs", "Agent evaluations", "Growth Dashboard", "Ad Name Generator", "Support inbox",
    ]);
  });

  it("marks exactly the Matrix, Operating costs and Growth Dashboard builder only", () => {
    const builderOnly = SECTIONS.flatMap((s) => s.tabs.filter((t) => t.builderOnly).map((t) => t.label));
    expect(builderOnly.sort()).toEqual(["Growth Dashboard", "Matrix", "Operating costs"]);
    const creative = SECTIONS.find((s) => s.id === "creative")!;
    expect(tabsFor(creative, false).map((t) => t.label)).not.toContain("Matrix");
    expect(tabsFor(creative, true).map((t) => t.label)).toContain("Matrix");
  });

  it("uses no em dash and the word client, not brand or account, in tab labels", () => {
    for (const s of SECTIONS) for (const t of s.tabs) {
      expect(t.label).not.toMatch(/\u2014|brand|account/i);
    }
  });
});

describe("role gating", () => {
  it("a builder sees every Creative tab, including the Matrix, and the Vault group", async () => {
    renderAt("/builder/creative/overview");
    expect(tabNames("Creative")).toContain("Matrix");
    expect(tabNames("Creative")).toHaveLength(15);
    expect(screen.getByText("Vault")).toBeTruthy();
    expect(await screen.findByTestId("page-overview")).toBeTruthy();
  });

  it("an employee does not see the builder-only Creative tab", () => {
    setRole("employee");
    renderAt("/employee/creative/overview");
    expect(tabNames("Creative")).not.toContain("Matrix");
    expect(tabNames("Creative")).toHaveLength(14);
  });

  it("an employee sees Admin, without Operating costs or the Growth Dashboard", async () => {
    setRole("employee");
    renderAt("/employee/admin/team");
    expect(await screen.findByTestId("page-team")).toBeTruthy();
    const names = tabNames("Admin");
    expect(names).toContain("Team and settings");
    expect(names).not.toContain("Operating costs");
    expect(names).not.toContain("Growth Dashboard");
    expect(names).toContain("Notifications");
    expect(names).toHaveLength(7);
  });

  it("a builder sees all nine Admin tabs", async () => {
    renderAt("/builder/admin/team");
    await screen.findByTestId("page-team");
    expect(tabNames("Admin")).toHaveLength(9);
  });

  it.each(["/employee/creative/matrix", "/employee/admin/growth", "/employee/admin/operating-costs"])("an employee typing %s is sent to the index", async (path) => {
    setRole("employee");
    renderAt(path);
    expect(await screen.findByTestId("index")).toBeTruthy();
    expect(screen.queryByTestId("page-matrix")).toBeNull();
    expect(screen.queryByTestId("page-growth")).toBeNull();
    expect(screen.queryByTestId("page-operating-costs")).toBeNull();
  });

  it("a builder reaches the builder-only tabs", async () => {
    renderAt("/builder/creative/matrix");
    expect(await screen.findByTestId("page-matrix")).toBeTruthy();
    renderAt("/builder/admin/growth");
    expect(await screen.findByTestId("page-growth")).toBeTruthy();
  });

  it.each([
    ["a client", "client", false],
    ["a builder previewing the client view", "builder", true],
  ] as const)("%s never gets a section", async (_label, role, preview) => {
    setRole(role, { clientPreview: preview });
    for (const path of ["/production/calendar", "/creative/analytics", "/admin/team", "/knowledge/shared"]) {
      const { unmount } = renderAt(`/${role === "client" ? "client" : "builder"}${path}`);
      expect(await screen.findByTestId("index")).toBeTruthy();
      expect(screen.queryByTestId("page-production-calendar")).toBeNull();
      expect(screen.queryByTestId("page-analytics")).toBeNull();
      expect(screen.queryByTestId("page-team")).toBeNull();
      unmount();
    }
  });
});

describe("tabs", () => {
  it("opens the first tab from the section address and from an unknown tab", async () => {
    renderAt("/builder/production");
    expect(await screen.findByTestId("page-production-calendar")).toBeTruthy();
    renderAt("/builder/production/not-a-tab");
    expect(await screen.findAllByTestId("page-production-calendar")).toBeTruthy();
  });

  it("marks the open tab and links each tab to its address", async () => {
    renderAt("/builder/production/casting");
    await screen.findByTestId("page-casting");
    const nav = screen.getByRole("navigation", { name: "Production tabs" });
    expect(within(nav).getByRole("link", { name: "Casting" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Crew" }).getAttribute("href")).toBe("/builder/production/crew");
    expect(within(nav).getByRole("link", { name: "Crew" }).getAttribute("aria-current")).toBeNull();
  });

  it("renders a page that needs one account for the selected client", async () => {
    renderAt("/builder/creative/landing-pages");
    expect(await screen.findByTestId("page-landing-pages")).toBeTruthy();
  });
});

describe("a client with no ad account", () => {
  beforeEach(() => {
    h.selection = { selectedSlug: "none", selectedClient: { slug: "none", name: "No Account Inc", active: true }, noAccount: true };
  });

  it("says so plainly on the analytics tabs instead of showing another client's numbers", async () => {
    renderAt("/builder/creative/analytics");
    const notice = await screen.findByTestId("no-ad-account");
    expect(notice.textContent).toContain("No Account Inc has no ad account linked yet.");
    expect(within(notice).getByRole("link", { name: "Open No Account Inc" }).getAttribute("href")).toBe("/builder/clients/none");
    expect(screen.queryByTestId("page-analytics")).toBeNull();
  });

  it("still shows tabs that do not read an ad account, like the Vault and Production", async () => {
    renderAt("/builder/creative/vault-hooks");
    expect(await screen.findByTestId("page-vault-hooks")).toBeTruthy();
    expect(screen.queryByTestId("no-ad-account")).toBeNull();
    renderAt("/builder/production/calendar");
    expect(await screen.findAllByTestId("page-production-calendar")).toBeTruthy();
  });
});
