/**
 * US-008 — Unit route-guard + nav tests (clients excluded from internal surface).
 *
 * Two layers of proof, both asserting against the REAL source of truth (no
 * duplicated nav table, no re-implemented guard):
 *
 *  1. Nav model (AppSidebar exports): the client nav list EXCLUDES every
 *     internal-only surface (Creatives, Analytics, Tagging, Briefs, Vault) and
 *     INCLUDES Home / Content Pipeline / Reports; builder sections keep the full
 *     internal surface (AC1, AC3).
 *
 *  2. Route guard (App's exported RoleGuardedRoutes): an effectiveClient
 *     (isClient OR isClientPreview) is redirected away from /creatives,
 *     /analytics, /compare, /tagging, /briefs, /ad-library*, /viral-feed and
 *     instead lands on the client home; builders/employees reach those pages
 *     unchanged; the index route resolves to ClientHomePage for clients and to
 *     the existing home (Overview) otherwise (AC2, AC3, AC4).
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
vi.mock("@/pages/ClientHomePage", () => pageMock("client-home"));
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

  it("INCLUDES Home, Content Pipeline, Reports", () => {
    expect(titles).toContain("Home");
    expect(titles).toContain("Content Pipeline");
    expect(titles).toContain("Reports");
    expect(urls).toEqual(expect.arrayContaining(["/", "/pipeline", "/reports"]));
  });

  it("EXCLUDES every internal-only surface (Creatives, Analytics, Tagging, Briefs, Vault, Viral Feed)", () => {
    const internalUrls = [
      "/creatives",
      "/creatives/compare",
      "/analytics",
      "/tagging",
      "/briefs",
      "/ad-library",
      "/ad-library/boards",
      "/ad-library/hooks",
      "/viral-feed",
    ];
    for (const url of internalUrls) {
      expect(urls).not.toContain(url);
    }
    const internalTitles = ["Creatives", "Analytics", "Tagging", "Briefs", "Library", "Boards", "Hooks", "Viral Feed"];
    for (const title of internalTitles) {
      expect(titles).not.toContain(title);
    }
  });

  it("is small and read-only-shaped — no more than the 3 client surfaces", () => {
    expect(clientNavItems).toHaveLength(3);
  });
});

describe("nav model — builderSections retain the full internal surface (AC3)", () => {
  const builderUrls = builderSections.flatMap((s) => s.items.map((i) => i.url));

  it("INCLUDES every internal surface a client is denied", () => {
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

// Internal-only routes a client must be redirected away from (AC2). Each is the
// role-relative path; mounted under the matching role prefix.
const INTERNAL_ROUTES = [
  { path: "/creatives", marker: "creatives" },
  { path: "/creatives/compare", marker: "compare" },
  { path: "/analytics", marker: "analytics" },
  { path: "/tagging", marker: "tagging" },
  { path: "/briefs", marker: "briefs" },
  { path: "/ad-library", marker: "ad-library" },
  { path: "/ad-library/boards", marker: "boards" },
  { path: "/ad-library/hooks", marker: "hooks" },
  { path: "/viral-feed", marker: "viral-feed" },
];

describe("route guard — effectiveClient via role=client is redirected from internal routes (AC2)", () => {
  beforeEach(() => setRole("client"));

  for (const { path, marker } of INTERNAL_ROUTES) {
    it(`redirects /client${path} → client home (never renders ${marker})`, async () => {
      renderAt(`/client${path}`);
      // Redirect lands on the index, which for a client resolves to ClientHomePage.
      expect(await screen.findByTestId("page-client-home")).toBeInTheDocument();
      expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
    });
  }
});

describe("route guard — effectiveClient via isClientPreview is redirected from internal routes (AC2)", () => {
  // A builder in client-preview mode is still an effectiveClient and must be
  // excluded from the internal surface exactly like a real client.
  beforeEach(() => setRole("builder", { clientPreview: true }));

  for (const { path, marker } of INTERNAL_ROUTES) {
    it(`redirects /client${path} → client home in preview (never renders ${marker})`, async () => {
      renderAt(`/client${path}`);
      expect(await screen.findByTestId("page-client-home")).toBeInTheDocument();
      expect(screen.queryByTestId(`page-${marker}`)).toBeNull();
    });
  }
});

describe("route guard — builders reach the full internal surface (AC3, no regression)", () => {
  beforeEach(() => setRole("builder"));

  for (const { path, marker } of INTERNAL_ROUTES) {
    it(`/builder${path} renders ${marker} for a builder`, async () => {
      renderAt(`/builder${path}`);
      expect(await screen.findByTestId(`page-${marker}`)).toBeInTheDocument();
      // The builder is NOT bounced to the client home.
      expect(screen.queryByTestId("page-client-home")).toBeNull();
    });
  }
});

describe("route guard — employees reach the full internal surface (AC3, no regression)", () => {
  beforeEach(() => setRole("employee"));

  for (const { path, marker } of INTERNAL_ROUTES) {
    it(`/employee${path} renders ${marker} for an employee`, async () => {
      renderAt(`/employee${path}`);
      expect(await screen.findByTestId(`page-${marker}`)).toBeInTheDocument();
      expect(screen.queryByTestId("page-client-home")).toBeNull();
    });
  }
});

describe("index route resolution (AC4)", () => {
  it("resolves to ClientHomePage for a client", async () => {
    setRole("client");
    renderAt("/client/");
    expect(await screen.findByTestId("page-client-home")).toBeInTheDocument();
    expect(screen.queryByTestId("page-overview")).toBeNull();
  });

  it("resolves to ClientHomePage for a builder in client-preview", async () => {
    setRole("builder", { clientPreview: true });
    renderAt("/client/");
    expect(await screen.findByTestId("page-client-home")).toBeInTheDocument();
    expect(screen.queryByTestId("page-overview")).toBeNull();
  });

  it("resolves to the existing home (Overview) for a builder", async () => {
    setRole("builder");
    renderAt("/builder/");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
    expect(screen.queryByTestId("page-client-home")).toBeNull();
  });

  it("resolves to the existing home (Overview) for an employee", async () => {
    setRole("employee");
    renderAt("/employee/");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
    expect(screen.queryByTestId("page-client-home")).toBeNull();
  });
});

describe("shared surfaces stay reachable for clients (guard is exclusion, not lockout)", () => {
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
