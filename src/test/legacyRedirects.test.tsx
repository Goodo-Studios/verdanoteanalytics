/**
 * Old staff addresses. Walks the whole old route list (the old sidebar, the old staff directory
 * and the old redirects) and checks that each address either redirects to its new tab, keeping
 * the query string (?client=, ?brand=), or is a page that kept its address. A client, or a
 * builder previewing the client view, is never sent to a staff tab.
 *
 * The expected targets are written out here, separately from src/lib/sections.ts and
 * src/lib/clientHub.ts, so a tab that moves or loses its redirect fails this test.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// The section page is stubbed to report where the redirect landed.
vi.mock("@/components/sections/SectionPage", async () => {
  const rr = await import("react-router-dom");
  return {
    SectionPage: ({ section }: { section: { id: string } }) => {
      const { tab } = rr.useParams<{ tab?: string }>();
      const loc = rr.useLocation();
      return <div data-testid="landed">{`${section.id}/${tab ?? ""}${loc.search}`}</div>;
    },
  };
});
vi.mock("@/pages/OverviewPage", () => ({ default: () => <div data-testid="overview" /> }));
vi.mock("@/pages/ContentPipelinePage", () => ({ default: () => <div data-testid="client-pipeline" /> }));
vi.mock("@/features/dashboard/OverviewPage", () => ({ default: () => <div data-testid="client-list" /> }));
// The client hub is stubbed to report where the redirect landed.
vi.mock("@/features/clients/ClientHubPage", async () => {
  const rr = await import("react-router-dom");
  return {
    default: () => {
      const { slug, tab, sub } = rr.useParams<{ slug: string; tab?: string; sub?: string }>();
      const loc = rr.useLocation();
      return <div data-testid="hub">{`${slug}/${tab ?? ""}/${sub ?? ""}${loc.search}`}</div>;
    },
  };
});
vi.mock("@/pages/HomePage", () => ({ default: () => <div data-testid="home" /> }));
vi.mock("@/pages/CreativesPage", () => ({ default: () => <div data-testid="client-creatives" /> }));
vi.mock("@/pages/AnalyticsPage", () => ({ default: () => <div data-testid="client-analytics" /> }));
vi.mock("@/pages/ClientReportsPage", () => ({ default: () => <div data-testid="client-reports" /> }));
vi.mock("@/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ClientPreviewBanner", () => ({ ClientPreviewBanner: () => null }));
vi.mock("@/contexts/AccountContext", () => ({
  AccountProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAccountContext: () => ({}),
}));
vi.mock("@/contexts/DateRangeContext", () => ({
  DateRangeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
import { LEGACY_REDIRECTS, resolveLegacyRoute } from "@/lib/legacyRoutes";
import { SECTIONS } from "@/lib/sections";

function setRole(role: Role, clientPreview = false) {
  authValue = {
    user: { id: "u1", email: `${role}@test.com` },
    role,
    isLoading: false,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
  };
  previewValue = { isClientPreview: clientPreview, isEmployeePreview: false };
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/:role/*" element={<RoleGuardedRoutes />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Every address staff could use before the new menu, and the section tab it moved to. */
const MOVED: Record<string, string> = {
  "/production-calendar": "production/calendar",
  "/call-sheets": "production/call-sheets",
  "/casting": "production/casting",
  "/crew": "production/crew",
  "/locations": "production/locations",
  "/props": "production/props",
  "/shipments": "production/shipments",
  "/creators": "talent/creators",
  "/actors": "talent/actors",
  "/applications": "talent/applications",
  "/creator-pipeline": "talent/pipeline",
  "/follow-ups": "talent/follow-ups",
  "/approval-boards": "talent/approval-boards",
  "/agency": "creative/agency",
  "/creatives": "creative/creatives",
  "/creative-library": "creative/library",
  "/analytics": "creative/analytics",
  "/matrix": "creative/matrix",
  "/tagging": "creative/tagging",
  "/briefs": "creative/briefs",
  "/reports": "creative/reports",
  "/landing-pages": "creative/landing-pages",
  "/creative-rotation": "creative/rotation",
  "/entities": "creative/diversity",
  "/ad-library": "vault/library",
  "/ad-library/boards": "vault/boards",
  "/ad-library/hooks": "vault/hooks",
  "/viral-feed": "vault/library",
  "/ad-library/viral": "vault/library",
  "/learning": "knowledge/learning",
  "/meeting-recaps": "knowledge/meetings",
  "/bids": "knowledge/bids",
  "/team": "admin/team",
  "/integration-health": "admin/integration-health",
  "/operations": "admin/operations",
  "/operating-costs": "admin/operating-costs",
  "/agent-evaluations": "admin/agent-evaluations",
  "/growth-dashboard": "growth/dashboard",
  "/admin/growth": "growth/dashboard",
  "/creative/vault": "vault/library",
  "/creative/vault-boards": "vault/boards",
  "/creative/vault-hooks": "vault/hooks",
  "/ad-name-generator": "tools/ad-name-generator",
  "/admin/ad-name-generator": "tools/ad-name-generator",
  "/support": "admin/support",
};

/** Old addresses that are now a section root (the first tab opens) or the Home page. */
const SECTION_ROOT = { "/knowledge": "knowledge/" };
const TO_HOME = ["/staff"];

/** Old addresses of pages that moved inside the client hub: where they land for client "glow". */
const MOVED_INTO_HUB: Record<string, string> = {
  "/engagements": "glow/scope/engagements",
  "/deliverables": "glow/scope/deliverables",
  "/qa-gates": "glow/scope/qa-gates",
  "/handoffs": "glow/scope/handoffs",
  "/scope-changes": "glow/scope/scope-changes",
  "/strategy": "glow/scope/strategy",
  "/recommendations": "glow/scope/recommendations",
  "/pipeline": "glow/work/",
};

/** Old addresses whose page kept its address (client menu, client list and settings). */
const KEPT = ["/", "/clients", "/settings"];

const CLIENT_OWN = ["/creatives", "/analytics", "/reports"];

describe("the old route list", () => {
  it("accounts for every address in the old staff menu", () => {
    const old = [
      ...Object.keys(MOVED),
      ...Object.keys(SECTION_ROOT),
      ...Object.keys(MOVED_INTO_HUB),
      ...TO_HOME,
      ...KEPT,
    ];
    // 49 menu items before the restructure, plus the old redirects and the agency page.
    const menuBefore = [
      "/", "/creatives", "/creative-library", "/analytics", "/matrix", "/tagging", "/pipeline", "/briefs", "/reports", "/landing-pages", "/creative-rotation", "/entities",
      "/ad-library", "/ad-library/boards", "/ad-library/hooks",
      "/staff", "/ad-name-generator", "/integration-health", "/meeting-recaps", "/knowledge", "/follow-ups", "/creator-pipeline", "/clients", "/creators", "/actors",
      "/applications", "/approval-boards", "/locations", "/props", "/crew", "/shipments", "/production-calendar", "/casting", "/call-sheets", "/engagements",
      "/deliverables", "/qa-gates", "/handoffs", "/agent-evaluations", "/operations", "/operating-costs", "/support", "/bids", "/team", "/learning", "/scope-changes",
      "/recommendations", "/strategy", "/growth-dashboard",
    ];
    const unaccounted = menuBefore.filter((u) => !old.includes(u));
    expect(unaccounted, `old menu addresses with no redirect or kept page: ${unaccounted.join(", ")}`).toEqual([]);
  });

  it("maps every moved address to its tab, in the redirect table", () => {
    for (const [from, to] of Object.entries(MOVED)) {
      expect(resolveLegacyRoute(from), from).toBe(`/${to}`);
    }
    expect(resolveLegacyRoute("/staff")).toBe("/");
    expect(resolveLegacyRoute("/does-not-exist")).toBeNull();
    expect(resolveLegacyRoute("/production-calendar/")).toBe("/production/calendar");
  });

  it("has no redirect that points at a missing tab", () => {
    const tabs = new Set(SECTIONS.flatMap((s) => s.tabs.map((t) => `/${s.id}/${t.slug}`)));
    for (const r of LEGACY_REDIRECTS) {
      if (r.to === "/") continue;
      expect(tabs.has(r.to), `${r.from} -> ${r.to}`).toBe(true);
    }
  });
});

describe("staff following an old address", () => {
  it.each(Object.entries(MOVED))("%s lands on %s and keeps ?client=glow", async (from, to) => {
    setRole("employee");
    renderAt(`/employee${from}?client=glow`);
    expect((await screen.findByTestId("landed")).textContent).toBe(`${to}?client=glow`);
    expect(screen.getByTestId("where").textContent).toBe(`/employee/${to}?client=glow`);
  });

  it("/knowledge opens the Knowledge section", async () => {
    setRole("builder");
    renderAt("/builder/knowledge");
    expect((await screen.findByTestId("landed")).textContent).toBe("knowledge/");
  });

  it("/staff goes to Home", async () => {
    setRole("builder");
    renderAt("/builder/staff");
    expect(await screen.findByTestId("home")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/builder/");
  });

  it("keeps ?brand= and ?account= links working", async () => {
    setRole("builder");
    renderAt("/builder/creator-pipeline?brand=glow&account=act_1");
    expect((await screen.findByTestId("landed")).textContent).toBe("talent/pipeline?brand=glow&account=act_1");
  });
});

describe("staff following an old address of a page that moved into the client hub", () => {
  it.each(Object.entries(MOVED_INTO_HUB))("%s?client=glow lands on the hub as %s and drops the client parameter", async (from, to) => {
    setRole("builder");
    renderAt(`/builder${from}?client=glow&month=2026-11`);
    const hub = await screen.findByTestId("hub");
    const [slug, tab, sub] = to.split("/");
    expect(hub.textContent).toBe(`${slug}/${tab}/${sub ?? ""}?month=2026-11`);
    expect(screen.getByTestId("where").textContent).toBe(`/builder/clients/${to.replace(/\/$/, "")}?month=2026-11`);
  });

  it("an old ?brand= link works the same way", async () => {
    setRole("employee");
    renderAt("/employee/engagements?brand=glow");
    expect((await screen.findByTestId("hub")).textContent).toBe("glow/scope/engagements");
  });

  it("with no client named it goes to the client list, so nothing asks for a client on the page", async () => {
    setRole("employee");
    renderAt("/employee/deliverables");
    expect(await screen.findByTestId("client-list")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/employee/clients");
  });

  it("the staff pipeline address is the client's Work tab, and a client keeps its own board there", async () => {
    setRole("builder");
    const { unmount } = renderAt("/builder/pipeline?client=glow");
    expect((await screen.findByTestId("hub")).textContent).toBe("glow/work/");
    unmount();
    setRole("client");
    renderAt("/client/pipeline");
    expect(await screen.findByTestId("client-pipeline")).toBeTruthy();
    expect(screen.queryByTestId("hub")).toBeNull();
  });
});

describe("a client following an old address", () => {
  const staffOnly = [...Object.keys(MOVED), ...Object.keys(MOVED_INTO_HUB).filter((p) => p !== "/pipeline")].filter((p) => !CLIENT_OWN.includes(p));

  it.each(staffOnly)("%s sends a client to the index, never to a staff tab", async (from) => {
    setRole("client");
    renderAt(`/client${from}?client=glow`);
    expect(await screen.findByTestId("overview")).toBeTruthy();
    expect(screen.queryByTestId("landed")).toBeNull();
    expect(screen.queryByTestId("hub")).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/client/");
  });

  it("a builder previewing the client view is treated the same way", async () => {
    setRole("builder", true);
    renderAt("/client/production-calendar");
    expect(await screen.findByTestId("overview")).toBeTruthy();
    expect(screen.queryByTestId("landed")).toBeNull();
  });

  it.each([
    ["/creatives", "client-creatives"],
    ["/analytics", "client-analytics"],
    ["/reports", "client-reports"],
  ])("%s stays the client's own page", async (path, marker) => {
    setRole("client");
    renderAt(`/client${path}`);
    expect(await screen.findByTestId(marker)).toBeTruthy();
    expect(screen.queryByTestId("landed")).toBeNull();
  });
});
