/**
 * Client wall, pages: a client cannot load any staff page, and staff can.
 *
 * Mounts the real route table (App's RoleGuardedRoutes) at every staff path and
 * observes which page element mounts. A guarded route sends the client to the index
 * (the Overview marker) and never mounts the staff page marker.
 *
 * The list of staff paths is every old address (they redirect to a section tab), every
 * section tab address (src/lib/sections.ts), and the detail pages that have no tab. A tab
 * or redirect added without a row here fails the coverage tests, so a new page cannot
 * ship unchecked.
 *
 * The same paths are checked in a real browser, signed in as the staging client and
 * employee accounts, by e2e/staff-area.spec.ts.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const pageMock = (name: string) => ({
  default: () => <div data-testid={`page-${name}`}>{name}</div>,
});
vi.mock("@/pages/OverviewPage", () => pageMock("overview"));
vi.mock("@/pages/CreativesPage", () => pageMock("creatives"));
vi.mock("@/pages/AnalyticsPage", () => pageMock("analytics"));
vi.mock("@/pages/ComparePage", () => pageMock("compare"));
vi.mock("@/pages/TaggingPage", () => pageMock("tagging"));
vi.mock("@/pages/ReportsPage", () => pageMock("reports"));
vi.mock("@/pages/ClientReportsPage", () => pageMock("client-reports"));
vi.mock("@/pages/ReportDetailPage", () => pageMock("report-detail"));
vi.mock("@/pages/ReportBuilderPage", () => pageMock("report-builder"));
vi.mock("@/pages/SettingsPage", () => pageMock("settings"));
vi.mock("@/pages/BriefsPage", () => pageMock("briefs"));
vi.mock("@/pages/AgencyDashboardPage", () => pageMock("agency"));
vi.mock("@/pages/HomePage", () => pageMock("staff-home"));
vi.mock("@/pages/ContentPipelinePage", () => pageMock("pipeline"));
vi.mock("@/pages/LandingPagesPage", () => pageMock("landing-pages"));
vi.mock("@/pages/CreativeRotationPage", () => pageMock("creative-rotation"));
vi.mock("@/pages/EntityReportPage", () => pageMock("entities"));
vi.mock("@/features/creative-library/CreativeLibraryPage", () => pageMock("creative-library"));
vi.mock("@/features/matrix/board/MatrixBoardPage", () => pageMock("matrix"));
vi.mock("@/features/growth-dashboard/GrowthDashboardPage", () => pageMock("growth-dashboard"));
vi.mock("@/features/ad-name-generator/AdNameGeneratorPage", () => pageMock("ad-name-generator"));
vi.mock("@/features/integration-health/IntegrationHealthPage", () => pageMock("integration-health"));
vi.mock("@/features/meeting-recaps/MeetingRecapsPage", () => pageMock("meeting-recaps"));
vi.mock("@/features/knowledge/KnowledgePage", () => pageMock("knowledge"));
vi.mock("@/features/dashboard/FollowUpsPage", () => pageMock("follow-ups"));
vi.mock("@/features/dashboard/CreatorPipelinePage", () => pageMock("creator-pipeline"));
vi.mock("@/features/dashboard/ClientDetailPage", () => pageMock("clientDetail"));
vi.mock("@/features/dashboard/OverviewPage", () => pageMock("client-overview"));
vi.mock("@/features/dashboard/ApprovalBoardsPage", () => pageMock("approval-boards"));
vi.mock("@/features/dashboard/LocationsPage", () => pageMock("locations"));
vi.mock("@/features/dashboard/PropsPage", () => pageMock("props"));
vi.mock("@/features/dashboard/CrewPage", () => pageMock("crew"));
vi.mock("@/features/dashboard/ShipmentsPage", () => pageMock("shipments"));
vi.mock("@/features/dashboard/ProductionCalendarPage", () => pageMock("production-calendar"));
vi.mock("@/features/dashboard/CastingPage", () => pageMock("casting"));
vi.mock("@/features/dashboard/CallSheetsPage", () => pageMock("call-sheets"));
vi.mock("@/features/dashboard/ApplicationsPage", () => pageMock("applications"));
vi.mock("@/features/dashboard/ApplicationDetailPage", () => pageMock("applicationDetail"));
vi.mock("@/features/dashboard/ActorsPage", () => pageMock("actors"));
vi.mock("@/features/dashboard/ActorDetailPage", () => pageMock("actorDetail"));
vi.mock("@/features/dashboard/CreatorsPage", () => pageMock("creators"));
vi.mock("@/features/dashboard/CreatorDetailPage", () => pageMock("creatorDetail"));
vi.mock("@/features/engagements/EngagementsPage", () => pageMock("engagements"));
vi.mock("@/features/deliverables/DeliverablesPage", () => pageMock("deliverables"));
vi.mock("@/features/qa-gates/QaGatesPage", () => pageMock("qa-gates"));
vi.mock("@/features/handoffs/HandoffsPage", () => pageMock("handoffs"));
vi.mock("@/features/agent-evaluations/AgentEvaluationsPage", () => pageMock("agent-evaluations"));
vi.mock("@/features/operations/OperationsPage", () => pageMock("operations"));
vi.mock("@/features/operating-costs/OperatingCostsPage", () => pageMock("operating-costs"));
vi.mock("@/features/support/SupportInboxPage", () => pageMock("support"));
vi.mock("@/features/bids/BidViewerPage", () => pageMock("bids"));
vi.mock("@/features/team/TeamPage", () => pageMock("team"));
vi.mock("@/features/learning/LearningPage", () => pageMock("learning"));
vi.mock("@/features/scope-changes/ScopeChangesPage", () => pageMock("scope-changes"));
vi.mock("@/features/recommendations/RecommendationsPage", () => pageMock("recommendations"));
vi.mock("@/features/strategy/StrategyPage", () => pageMock("strategy"));
vi.mock("@/features/vault/LibraryPage", () => pageMock("ad-library"));
vi.mock("@/features/vault/ItemDetailPage", () => pageMock("vault-item"));
vi.mock("@/features/vault/BoardsPage", () => pageMock("boards"));
vi.mock("@/features/vault/BoardDetailPage", () => pageMock("board-detail"));
vi.mock("@/features/vault/HooksPage", () => pageMock("hooks"));
vi.mock("@/pages/NotFound", () => pageMock("not-found"));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ClientPreviewBanner", () => ({ ClientPreviewBanner: () => null }));
vi.mock("@/contexts/AccountContext", () => ({
  AccountProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAccountContext: () => ({}),
}));

type Role = "builder" | "employee" | "client";
let authValue: Record<string, unknown>;
let previewValue: { isClientPreview: boolean; isEmployeePreview: boolean };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({
  useClientPreview: () => previewValue,
  ClientPreviewContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  useClientPreviewMode: () => previewValue,
}));

import { RoleGuardedRoutes } from "@/App";
import { clientNavItems, staffNavItems } from "@/components/AppSidebar";
import { SECTIONS, type PageKey } from "@/lib/sections";
import { LEGACY_REDIRECTS } from "@/lib/legacyRoutes";

function setRole(role: Role, opts: { clientPreview?: boolean } = {}) {
  authValue = {
    user: { id: "u1", email: `${role}@test.com` },
    role,
    isLoading: false,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
  };
  previewValue = { isClientPreview: !!opts.clientPreview, isEmployeePreview: false };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:role/*" element={<RoleGuardedRoutes />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Every staff page and the marker its mocked module renders. */
const STAFF_PAGES: Array<{ path: string; marker: string; builderOnly?: boolean }> = [
  { path: "/staff", marker: "staff-home" },
  { path: "/agency", marker: "agency" },
  { path: "/creative-library", marker: "creative-library" },
  { path: "/tagging", marker: "tagging" },
  { path: "/briefs", marker: "briefs" },
  { path: "/landing-pages", marker: "landing-pages" },
  { path: "/creative-rotation", marker: "creative-rotation" },
  { path: "/entities", marker: "entities" },
  { path: "/matrix", marker: "matrix", builderOnly: true },
  { path: "/growth-dashboard", marker: "growth-dashboard", builderOnly: true },
  { path: "/ad-name-generator", marker: "ad-name-generator" },
  { path: "/integration-health", marker: "integration-health" },
  { path: "/meeting-recaps", marker: "meeting-recaps" },
  { path: "/knowledge", marker: "knowledge" },
  { path: "/follow-ups", marker: "follow-ups" },
  { path: "/creator-pipeline", marker: "creator-pipeline" },
  { path: "/clients/demo-glowdrip", marker: "clientDetail" },
  { path: "/clients", marker: "client-overview" },
  { path: "/approval-boards", marker: "approval-boards" },
  { path: "/locations", marker: "locations" },
  { path: "/props", marker: "props" },
  { path: "/crew", marker: "crew" },
  { path: "/shipments", marker: "shipments" },
  { path: "/production-calendar", marker: "production-calendar" },
  { path: "/casting", marker: "casting" },
  { path: "/call-sheets", marker: "call-sheets" },
  { path: "/applications", marker: "applications" },
  { path: "/applications/creators/de5a0000-0000-4000-8000-000000000700", marker: "applicationDetail" },
  { path: "/actors", marker: "actors" },
  { path: "/actors/de5a0000-0000-4000-8000-000000000500", marker: "actorDetail" },
  { path: "/creators", marker: "creators" },
  { path: "/creators/de5a0000-0000-4000-8000-000000000300", marker: "creatorDetail" },
  { path: "/engagements", marker: "engagements" },
  { path: "/deliverables", marker: "deliverables" },
  { path: "/qa-gates", marker: "qa-gates" },
  { path: "/handoffs", marker: "handoffs" },
  { path: "/agent-evaluations", marker: "agent-evaluations" },
  { path: "/operations", marker: "operations" },
  { path: "/operating-costs", marker: "operating-costs", builderOnly: true },
  { path: "/support", marker: "support" },
  { path: "/bids", marker: "bids" },
  { path: "/team", marker: "team" },
  { path: "/learning", marker: "learning" },
  { path: "/scope-changes", marker: "scope-changes" },
  { path: "/recommendations", marker: "recommendations" },
  { path: "/strategy", marker: "strategy" },
  { path: "/ad-library", marker: "ad-library" },
  { path: "/viral-feed", marker: "ad-library" },
  { path: "/ad-library/viral", marker: "ad-library" },
  { path: "/ad-library/boards", marker: "boards" },
  { path: "/ad-library/boards/b1", marker: "board-detail" },
  { path: "/ad-library/hooks", marker: "hooks" },
  { path: "/ad-library/some-item", marker: "vault-item" },
  { path: "/reports/r1/build", marker: "report-builder" },
];

/** The marker each tab's page renders in these tests. A tab whose page has no marker fails below. */
const PAGE_MARKER: Record<string, string> = {
  productionCalendar: "production-calendar", callSheets: "call-sheets", casting: "casting", crew: "crew", locations: "locations",
  props: "props", shipments: "shipments", creators: "creators", actors: "actors", applications: "applications",
  creatorPipeline: "creator-pipeline", followUps: "follow-ups", approvalBoards: "approval-boards", overview: "overview",
  agencyDashboard: "agency", creatives: "creatives", creativeLibrary: "creative-library", analytics: "analytics", matrix: "matrix",
  tagging: "tagging", briefs: "briefs", reports: "reports", landingPages: "landing-pages", creativeRotation: "creative-rotation",
  entityReport: "entities", adLibrary: "ad-library", boards: "boards", hooks: "hooks", knowledge: "knowledge", learning: "learning",
  meetingRecaps: "meeting-recaps", bidViewer: "bids", team: "team", integrationHealth: "integration-health", operations: "operations",
  operatingCosts: "operating-costs", agentEvaluations: "agent-evaluations", growthDashboard: "growth-dashboard",
  adNameGenerator: "ad-name-generator", supportInbox: "support",
};

/** Every section tab address, with the page it shows. */
const TAB_PAGES: Array<{ path: string; marker: string; builderOnly?: boolean }> = SECTIONS.flatMap((section) =>
  section.tabs.map((tab) => ({ path: `/${section.id}/${tab.slug}`, marker: PAGE_MARKER[tab.page], builderOnly: tab.builderOnly })),
);

/** Old staff addresses a client also uses for its own pages: staff are sent to the tab, clients keep the page. */
const SHARED_OLD_PAGES = [
  { path: "/creatives", marker: "creatives" },
  { path: "/analytics", marker: "analytics" },
  { path: "/reports", marker: "reports" },
];

describe("every menu item, tab and old address is covered", () => {
  it("has seven staff menu items", () => {
    expect(staffNavItems.map((i) => i.title)).toEqual(["Home", "Clients", "Production", "Talent", "Creative", "Knowledge", "Admin"]);
    expect(staffNavItems).toHaveLength(7);
    expect(clientNavItems).toHaveLength(5);
  });

  it("has a page marker for every page a tab shows", () => {
    const missing = SECTIONS.flatMap((s) => s.tabs).filter((t) => !PAGE_MARKER[t.page as PageKey]).map((t) => t.page);
    expect(missing, `tabs with no page marker: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a STAFF_PAGES row for each old address that redirects", () => {
    const covered = new Set([...STAFF_PAGES.map((p) => p.path), ...SHARED_OLD_PAGES.map((p) => p.path)]);
    const missing = LEGACY_REDIRECTS.map((r) => r.from).filter((u) => !covered.has(u));
    expect(missing, `old addresses with no page check: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("a client cannot load any staff page", () => {
  describe.each([
    ["client", { clientPreview: false }],
    ["builder previewing the client view", { clientPreview: true }],
  ] as const)("signed in as %s", (label, opts) => {
    const role: Role = label === "client" ? "client" : "builder";
    it.each(STAFF_PAGES)("$path does not mount the staff page", async ({ path, marker }) => {
      setRole(role, opts);
      renderAt(`/client${path}`);
      // Wait for the redirect to land on the index, then check the staff page never mounted.
      expect(await screen.findByTestId("page-overview")).toBeTruthy();
      expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
    });
  });

  describe.each([
    ["client", false],
    ["builder previewing the client view", true],
  ] as const)("section tabs, signed in as %s", (label, preview) => {
    const role: Role = label === "client" ? "client" : "builder";
    it.each(TAB_PAGES.filter((p) => p.marker !== "overview"))("$path does not mount the tab page", async ({ path, marker }) => {
      setRole(role, { clientPreview: preview });
      renderAt(`/client${path}`);
      expect(await screen.findByTestId("page-overview")).toBeTruthy();
      expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
    });
  });

  it("a client opening the Home or section roots lands on the index", async () => {
    for (const path of ["/production", "/talent", "/creative", "/knowledge", "/admin"]) {
      setRole("client");
      const { unmount } = renderAt(`/client${path}`);
      expect(await screen.findByTestId("page-overview")).toBeTruthy();
      unmount();
    }
  });

  it.each(STAFF_PAGES)("a client typing the builder or employee address for $path still does not reach it", async ({ path, marker }) => {
    setRole("client");
    for (const prefix of ["/builder", "/employee"]) {
      const { unmount } = renderAt(`${prefix}${path}`);
      // The prefix is corrected to /client; whatever loads, it is never the staff page.
      await screen.findByTestId(/^page-/);
      expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
      unmount();
    }
  });
});

describe("staff reach the staff pages", () => {
  const ALL = [...STAFF_PAGES, ...TAB_PAGES, ...SHARED_OLD_PAGES];
  it.each(ALL.filter((p) => !("builderOnly" in p && p.builderOnly)))("an employee reaches $path", async ({ path, marker }) => {
    setRole("employee");
    renderAt(`/employee${path}`);
    expect(await screen.findByTestId(`page-${marker}`)).toBeTruthy();
  });

  it.each(ALL)("a builder reaches $path", async ({ path, marker }) => {
    setRole("builder");
    renderAt(`/builder${path}`);
    expect(await screen.findByTestId(`page-${marker}`)).toBeTruthy();
  });

  it.each(ALL.filter((p) => "builderOnly" in p && p.builderOnly))("an employee is sent away from the builder-only page $path", async ({ path, marker }) => {
    setRole("employee");
    renderAt(`/employee${path}`);
    expect(await screen.findByTestId("page-staff-home")).toBeTruthy();
    expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
  });

  it("the builder-only list holds the Matrix, the Growth Dashboard and Operating costs, old and new addresses", () => {
    const paths = ALL.filter((p) => "builderOnly" in p && p.builderOnly).map((p) => p.path).sort();
    expect(paths).toEqual(["/admin/growth", "/admin/operating-costs", "/creative/matrix", "/growth-dashboard", "/matrix", "/operating-costs"]);
  });

  it("/staff goes to Home", async () => {
    setRole("employee");
    renderAt("/employee/staff");
    expect(await screen.findByTestId("page-staff-home")).toBeTruthy();
  });
});
