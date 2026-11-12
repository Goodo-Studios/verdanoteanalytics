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
vi.mock("@/features/brain/BrainPage", () => marker("brain"));
vi.mock("@/features/learning/LearningPage", () => marker("learning"));
vi.mock("@/features/agent-evaluations/AgentEvaluationsPage", () => marker("agent-evaluations"));
vi.mock("@/features/admin/EarlyPagesPage", () => marker("early-pages"));

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
  it("has the six tabbed sections with the agreed tabs", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(["Production", "Talent", "Creative", "Knowledge", "Tools", "Admin"]);
    const labels = (id: string) => SECTIONS.find((s) => s.id === id)!.tabs.map((t) => t.label);
    expect(labels("production")).toEqual(["Production calendar", "Call sheets", "Casting", "Crew", "Locations", "Props", "Shipments"]);
    expect(labels("talent")).toEqual(["Creators", "Actors", "Applications", "Creator pipeline", "Follow-ups", "Approval boards"]);
    expect(labels("creative")).toEqual([
      "Overview", "Agency overview", "Creatives", "Analytics", "Creative Rotation", "Creative Diversity", "Landing Pages",
      "Creative Library", "Vault", "Boards", "Hooks", "Tagging", "Matrix", "Reports", "Briefs",
    ]);
    expect(labels("knowledge")).toEqual(["Knowledge", "Brain", "Learning", "Meeting recaps", "Client BIDs"]);
    expect(labels("tools")).toEqual(["Ad Name Generator"]);
    expect(labels("admin")).toEqual([
      "Team and settings", "Integration health", "Notifications", "Operations", "Early pages", "Operating costs", "Agent evaluations", "Growth Dashboard", "Support inbox",
    ]);
  });

  it("shows an employee five Admin items or fewer, and the Ad Name Generator under Tools (OS-002)", () => {
    const admin = tabsFor(SECTIONS.find((s) => s.id === "admin")!, false).map((t) => t.label);
    expect(admin.length).toBeLessThanOrEqual(5);
    expect(admin).not.toContain("Ad Name Generator");
    const tools = tabsFor(SECTIONS.find((s) => s.id === "tools")!, false).map((t) => t.label);
    expect(tools).toEqual(["Ad Name Generator"]);
  });

  it("marks exactly the Matrix, Operating costs, Growth Dashboard and Early pages builder only", () => {
    const builderOnly = SECTIONS.flatMap((s) => s.tabs.filter((t) => t.builderOnly).map((t) => t.label));
    expect(builderOnly.sort()).toEqual(["Early pages", "Growth Dashboard", "Matrix", "Operating costs"]);
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
  it("Creative shows four groups and only the open group's tabs (OS-003)", async () => {
    renderAt("/builder/creative/overview");
    const groups = within(screen.getByRole("navigation", { name: "Creative groups" })).getAllByRole("link").map((a) => a.textContent);
    expect(groups).toEqual(["Performance", "Library", "Tagging", "Reports"]);
    expect(tabNames("Performance")).toEqual([
      "Overview", "Agency overview", "Creatives", "Analytics", "Creative Rotation", "Creative Diversity", "Landing Pages",
    ]);
    expect(screen.queryByRole("navigation", { name: "Library tabs" })).toBeNull();
    expect(await screen.findByTestId("page-overview")).toBeTruthy();
  });

  it("each group link opens its first tab, and a tab opens inside its own group", () => {
    renderAt("/builder/creative/vault-hooks");
    const groupLinks = within(screen.getByRole("navigation", { name: "Creative groups" })).getAllByRole("link");
    expect(groupLinks.map((a) => a.getAttribute("href"))).toEqual([
      "/builder/creative/overview", "/builder/creative/library", "/builder/creative/tagging", "/builder/creative/reports",
    ]);
    expect(groupLinks.find((a) => a.textContent === "Library")?.getAttribute("aria-current")).toBe("true");
    expect(tabNames("Library")).toEqual(["Creative Library", "Vault", "Boards", "Hooks"]);
  });

  it("no Creative row has more than seven tabs, so nothing scrolls sideways", () => {
    const creative = SECTIONS.find((s) => s.id === "creative")!;
    for (const g of creative.groups!) {
      expect(creative.tabs.filter((t) => t.group === g).length, g).toBeLessThanOrEqual(7);
    }
    expect(creative.tabs.every((t) => creative.groups!.includes(t.group!))).toBe(true);
  });

  it("a builder sees the Matrix under Tagging", () => {
    renderAt("/builder/creative/tagging");
    expect(tabNames("Tagging")).toEqual(["Tagging", "Matrix"]);
  });

  it("an employee does not see the builder-only Matrix", () => {
    setRole("employee");
    renderAt("/employee/creative/tagging");
    expect(tabNames("Tagging")).toEqual(["Tagging"]);
  });

  it("an employee sees Admin, without Operating costs or the Growth Dashboard", async () => {
    setRole("employee");
    renderAt("/employee/admin/team");
    expect(await screen.findByTestId("page-team")).toBeTruthy();
    const names = tabNames("Admin");
    expect(names).toContain("Team and settings");
    expect(names).not.toContain("Operating costs");
    expect(names).not.toContain("Growth Dashboard");
    expect(names).not.toContain("Early pages");
    expect(names).not.toContain("Agent evaluations");
    expect(names).toContain("Notifications");
    expect(names).not.toContain("Ad Name Generator");
    expect(names).toHaveLength(5);
  });

  it("a builder sees eight Admin tabs: Early pages in, Agent evaluations out", async () => {
    renderAt("/builder/admin/team");
    await screen.findByTestId("page-team");
    const names = tabNames("Admin");
    expect(names).toHaveLength(8);
    expect(names).toContain("Early pages");
    expect(names).not.toContain("Agent evaluations");
  });

  it("Learning is not a Knowledge tab, but a builder opens it by its address", async () => {
    renderAt("/builder/knowledge/shared");
    await screen.findByTestId("page-knowledge");
    expect(tabNames("Knowledge")).not.toContain("Learning");
    renderAt("/builder/knowledge/learning");
    expect(await screen.findByTestId("page-learning")).toBeTruthy();
  });

  it("a builder opens Agent evaluations and Early pages by their addresses", async () => {
    renderAt("/builder/admin/agent-evaluations");
    expect(await screen.findByTestId("page-agent-evaluations")).toBeTruthy();
    renderAt("/builder/admin/early-pages");
    expect(await screen.findByTestId("page-early-pages")).toBeTruthy();
  });

  it.each(["/employee/knowledge/learning", "/employee/admin/agent-evaluations", "/employee/admin/early-pages"])("an employee typing %s is sent to the index", async (path) => {
    setRole("employee");
    renderAt(path);
    expect(await screen.findByTestId("index")).toBeTruthy();
    expect(screen.queryByTestId("page-learning")).toBeNull();
    expect(screen.queryByTestId("page-agent-evaluations")).toBeNull();
    expect(screen.queryByTestId("page-early-pages")).toBeNull();
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
