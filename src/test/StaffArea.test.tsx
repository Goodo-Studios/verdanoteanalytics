/**
 * Client wall, pages: a client cannot load any staff page, and staff can.
 *
 * Mounts the real route table (App's RoleGuardedRoutes) at every staff path and
 * observes which page element mounts. A guarded route sends the client to the index
 * (the Overview marker) and never mounts the staff page marker.
 *
 * The list of staff paths comes from the nav model (AppSidebar's builderSections minus
 * what clientNavItems offers) plus the staff pages that have no nav entry. A staff
 * nav item added without a row in STAFF_PAGES fails the "every staff nav item is
 * covered" test, so a new page cannot ship unchecked.
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
vi.mock("@/pages/StaffHomePage", () => pageMock("staff-home"));
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
import { builderSections, clientNavItems } from "@/components/AppSidebar";

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
  { path: "/learning", marker: "learning" },
  { path: "/scope-changes", marker: "scope-changes" },
  { path: "/recommendations", marker: "recommendations" },
  { path: "/strategy", marker: "strategy" },
  { path: "/ad-library", marker: "ad-library" },
  { path: "/ad-library/boards", marker: "boards" },
  { path: "/ad-library/boards/b1", marker: "board-detail" },
  { path: "/ad-library/hooks", marker: "hooks" },
  { path: "/ad-library/some-item", marker: "vault-item" },
  { path: "/reports/r1/build", marker: "report-builder" },
];

describe("every staff nav item is covered", () => {
  it("has a STAFF_PAGES row for each nav item a client does not get", () => {
    const clientUrls = new Set(clientNavItems.map((i) => i.url));
    const staffNavUrls = builderSections.flatMap((s) => s.items.map((i) => i.url)).filter((u) => !clientUrls.has(u));
    const covered = new Set(STAFF_PAGES.map((p) => p.path));
    const missing = staffNavUrls.filter((u) => !covered.has(u));
    expect(missing, `staff nav items with no page check: ${missing.join(", ")}`).toEqual([]);
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
  it.each(STAFF_PAGES.filter((p) => !p.builderOnly))("an employee reaches $path", async ({ path, marker }) => {
    setRole("employee");
    renderAt(`/employee${path}`);
    expect(await screen.findByTestId(`page-${marker}`)).toBeTruthy();
  });

  it.each(STAFF_PAGES)("a builder reaches $path", async ({ path, marker }) => {
    setRole("builder");
    renderAt(`/builder${path}`);
    expect(await screen.findByTestId(`page-${marker}`)).toBeTruthy();
  });

  it.each(STAFF_PAGES.filter((p) => p.builderOnly))("an employee is sent away from the builder-only page $path", async ({ path, marker }) => {
    setRole("employee");
    renderAt(`/employee${path}`);
    expect(await screen.findByTestId("page-overview")).toBeTruthy();
    expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
  });

  it("the builder-only list holds the Matrix and the Growth Dashboard", () => {
    expect(STAFF_PAGES.filter((p) => p.builderOnly).map((p) => p.path)).toEqual(["/matrix", "/growth-dashboard", "/operating-costs"]);
  });
});
