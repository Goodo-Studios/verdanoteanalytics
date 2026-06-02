/**
 * US-008 — Unit route-guard + nav tests (client analytics surface).
 *
 * Two layers of proof, both asserting against the REAL source of truth (no
 * duplicated nav table, no re-implemented guard):
 *
 *  1. Nav model (AppSidebar exports): the client nav list INCLUDES the core
 *     analytics surfaces (Overview / Creatives / Analytics) plus Content
 *     Pipeline / Reports, and EXCLUDES the deeper strategist surfaces
 *     (Tagging, Briefs, Vault, Viral Feed); builder sections keep the full
 *     internal surface (AC1, AC3).
 *
 *  2. Route guard (App's exported RoleGuardedRoutes): an effectiveClient
 *     (isClient OR isClientPreview) REACHES /creatives, /creatives/compare and
 *     /analytics, but is still redirected away from /tagging, /briefs,
 *     /ad-library*, /viral-feed and lands on the index (Overview);
 *     builders/employees reach every page unchanged; the index route resolves
 *     to OverviewPage for every role (the purpose-built ClientHomePage is
 *     retired) (AC2, AC3, AC4).
 *
 * Page modules are mocked to lightweight markers so the test observes which
 * route element actually mounts (a redirect lands on the index marker, never
 * the guarded-page marker). Auth + client-preview are mocked per-test to drive
 * the role without a live Supabase session.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

// --- Page module mocks: every routed page renders a stable, identifiable marker.
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
vi.mock("@/pages/ContentPipelinePage", () => pageMock("pipeline"));
vi.mock("@/features/vault/LibraryPage", () => pageMock("ad-library"));
vi.mock("@/features/vault/ItemDetailPage", () => pageMock("vault-item"));
vi.mock("@/features/vault/BoardsPage", () => pageMock("boards"));
vi.mock("@/features/vault/BoardDetailPage", () => pageMock("board-detail"));
vi.mock("@/features/vault/HooksPage", () => pageMock("hooks"));
vi.mock("@/features/vault/ViralFeedPage", () => pageMock("viral-feed"));
vi.mock("@/pages/NotFound", () => pageMock("not-found"));

// AppLayout + the preview banner pull in heavy chrome (sidebar, account ctx) —
// stub them to pure passthroughs so we isolate the guard/route table.
vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ClientPreviewBanner", () => ({
  ClientPreviewBanner: () => null,
}));
vi.mock("@/contexts/AccountContext", () => ({
  AccountProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAccountContext: () => ({}),
}));

// --- Auth + client-preview: driven per-test via these mutable holders.
type AuthShape = {
  user: { id: string; email: string } | null;
  role: "builder" | "employee" | "client" | null;
  isLoading: boolean;
  isBuilder: boolean;
  isEmployee: boolean;
  isClient: boolean;
};
let authValue: AuthShape;
let previewValue: { isClientPreview: boolean; isEmployeePreview: boolean };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({
  useClientPreview: () => previewValue,
  // RoleGuardedRoutes does not consume these, but App.tsx imports them.
  ClientPreviewContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  useClientPreviewMode: () => previewValue,
}));

import { RoleGuardedRoutes } from "@/App";
import { clientNavItems, builderSections } from "@/components/AppSidebar";

function setRole(
  role: AuthShape["role"],
  opts: { clientPreview?: boolean; employeePreview?: boolean } = {},
) {
  authValue = {
    user: { id: "u1", email: `${role ?? "anon"}@test.com` },
    role,
    isLoading: false,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
  };
  previewValue = {
    isClientPreview: !!opts.clientPreview,
    isEmployeePreview: !!opts.employeePreview,
  };
}

/** Mount the guarded route table at a concrete role-prefixed path. */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {/* RoleGuardedRoutes is mounted under /:role/* in App; mirror that here. */}
      <RoleGuardedRoutesAt />
    </MemoryRouter>,
  );
}

// RoleGuardedRoutes reads :role from the route params, so it must mount under a
// /:role/* route. We rebuild that single wrapper here (App's own shell).
import { Routes, Route } from "react-router-dom";
function RoleGuardedRoutesAt() {
  return (
    <Routes>
      <Route path="/:role/*" element={<RoleGuardedRoutes />} />
    </Routes>
  );
}

describe("nav model — clientNavItems (AC1)", () => {
  const titles = clientNavItems.map((i) => i.title);
  const urls = clientNavItems.map((i) => i.url);

  it("INCLUDES Overview, Creatives, Analytics, Content Pipeline, Reports", () => {
    expect(titles).toEqual(
      expect.arrayContaining(["Overview", "Creatives", "Analytics", "Content Pipeline", "Reports"]),
    );
    expect(urls).toEqual(
      expect.arrayContaining(["/", "/creatives", "/analytics", "/pipeline", "/reports"]),
    );
  });

  it("EXCLUDES the deeper strategist surfaces (Tagging, Briefs, Vault, Viral Feed)", () => {
    const excludedUrls = [
      "/tagging",
      "/briefs",
      "/ad-library",
      "/ad-library/boards",
      "/ad-library/hooks",
      "/viral-feed",
    ];
    for (const url of excludedUrls) {
      expect(urls).not.toContain(url);
    }
    const excludedTitles = ["Tagging", "Briefs", "Library", "Boards", "Hooks", "Viral Feed"];
    for (const title of excludedTitles) {
      expect(titles).not.toContain(title);
    }
  });

  it("is the 5 client surfaces — Overview, Creatives, Analytics, Pipeline, Reports", () => {
    expect(clientNavItems).toHaveLength(5);
  });
});

describe("nav model — builderSections retain the full internal surface (AC3)", () => {
  const builderUrls = builderSections.flatMap((s) => s.items.map((i) => i.url));

  it("INCLUDES every internal surface", () => {
    for (const url of [
      "/creatives",
      "/analytics",
      "/tagging",
      "/briefs",
      "/ad-library",
      "/ad-library/boards",
      "/ad-library/hooks",
      "/viral-feed",
    ]) {
      expect(builderUrls).toContain(url);
    }
  });

  it("also keeps the shared surfaces (Overview, Pipeline, Reports)", () => {
    expect(builderUrls).toEqual(expect.arrayContaining(["/", "/pipeline", "/reports"]));
  });
});

// Routes a client now REACHES — the core analytics surface (AC2).
const CLIENT_ALLOWED_ROUTES = [
  { path: "/creatives", marker: "creatives" },
  { path: "/creatives/compare", marker: "compare" },
  { path: "/analytics", marker: "analytics" },
];

// Routes a client is still redirected away from — deeper strategist surfaces (AC2).
const CLIENT_DENIED_ROUTES = [
  { path: "/tagging", marker: "tagging" },
  { path: "/briefs", marker: "briefs" },
  { path: "/ad-library", marker: "ad-library" },
  { path: "/ad-library/boards", marker: "boards" },
  { path: "/ad-library/hooks", marker: "hooks" },
  { path: "/viral-feed", marker: "viral-feed" },
];

// Full internal surface — builders/employees reach every one (AC3 no-regression).
const ALL_INTERNAL_ROUTES = [...CLIENT_ALLOWED_ROUTES, ...CLIENT_DENIED_ROUTES];

describe("route guard — effectiveClient via role=client reaches the analytics surface (AC2)", () => {
  beforeEach(() => setRole("client"));

  for (const { path, marker } of CLIENT_ALLOWED_ROUTES) {
    it(`/client${path} renders ${marker} for a client`, async () => {
      renderAt(`/client${path}`);
      expect(await screen.findByTestId(`page-${marker}`)).toBeInTheDocument();
      // Not bounced to the index.
      expect(screen.queryByTestId("page-overview")).toBeNull();
    });
  }
});

describe("route guard — effectiveClient via isClientPreview reaches the analytics surface (AC2)", () => {
  beforeEach(() => setRole("builder", { clientPreview: true }));

  for (const { path, marker } of CLIENT_ALLOWED_ROUTES) {
    it(`/client${path} renders ${marker} in preview`, async () => {
      renderAt(`/client${path}`);
      expect(await screen.findByTestId(`page-${marker}`)).toBeInTheDocument();
      expect(screen.queryByTestId("page-overview")).toBeNull();
    });
  }
});

describe("route guard — effectiveClient via role=client is redirected from deeper surfaces (AC2)", () => {
  beforeEach(() => setRole("client"));

  for (const { path, marker } of CLIENT_DENIED_ROUTES) {
    it(`redirects /client${path} → index (Overview, never renders ${marker})`, async () => {
      renderAt(`/client${path}`);
      // Redirect lands on the index, which now resolves to OverviewPage for all roles.
      expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
      expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
    });
  }
});

describe("route guard — effectiveClient via isClientPreview is redirected from deeper surfaces (AC2)", () => {
  // A builder in client-preview mode is still an effectiveClient and must be
  // excluded from the deeper strategist surface exactly like a real client.
  beforeEach(() => setRole("builder", { clientPreview: true }));

  for (const { path, marker } of CLIENT_DENIED_ROUTES) {
    it(`redirects /client${path} → index in preview (never renders ${marker})`, async () => {
      renderAt(`/client${path}`);
      expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
      expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
    });
  }
});

describe("route guard — builders reach the full internal surface (AC3, no regression)", () => {
  beforeEach(() => setRole("builder"));

  for (const { path, marker } of ALL_INTERNAL_ROUTES) {
    it(`/builder${path} renders ${marker} for a builder`, async () => {
      renderAt(`/builder${path}`);
      expect(await screen.findByTestId(`page-${marker}`)).toBeInTheDocument();
    });
  }
});

describe("route guard — employees reach the full internal surface (AC3, no regression)", () => {
  beforeEach(() => setRole("employee"));

  for (const { path, marker } of ALL_INTERNAL_ROUTES) {
    it(`/employee${path} renders ${marker} for an employee`, async () => {
      renderAt(`/employee${path}`);
      expect(await screen.findByTestId(`page-${marker}`)).toBeInTheDocument();
    });
  }
});

describe("index route resolution (AC4) — Overview for every role", () => {
  it("resolves to OverviewPage for a client", async () => {
    setRole("client");
    renderAt("/client/");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
  });

  it("resolves to OverviewPage for a builder in client-preview", async () => {
    setRole("builder", { clientPreview: true });
    renderAt("/client/");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
  });

  it("resolves to OverviewPage for a builder", async () => {
    setRole("builder");
    renderAt("/builder/");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
  });

  it("resolves to OverviewPage for an employee", async () => {
    setRole("employee");
    renderAt("/employee/");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
  });
});

describe("shared surfaces stay reachable for clients", () => {
  beforeEach(() => setRole("client"));

  it("/client/pipeline renders the Content Pipeline (client-allowed)", async () => {
    renderAt("/client/pipeline");
    expect(await screen.findByTestId("page-pipeline")).toBeInTheDocument();
  });

  it("/client/reports renders the client Reports variant", async () => {
    renderAt("/client/reports");
    expect(await screen.findByTestId("page-client-reports")).toBeInTheDocument();
    expect(screen.queryByTestId("page-reports")).toBeNull();
  });
});
