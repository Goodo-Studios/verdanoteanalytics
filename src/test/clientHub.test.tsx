/**
 * Client hub: /clients/:slug with tabs Overview, Work, Briefs, Performance, Brand doc, Meetings and Scope.
 * Everything runs against the real hub, the real client selection provider and the real client switcher
 * state; only the data (supabase) and the heavy existing pages are mocked, the way the earlier page tests do.
 *
 *  - The client is in the address: every tab, and every existing page moved inside it, reads that client
 *    from the shared selection, and none of them asks for it again.
 *  - Overview is the client detail content, Work is the ClickUp pipeline read by client_slug (works for a
 *    client with no ad account or several), Briefs says plainly when there is no ad account, Performance links
 *    into the analytics, Brand doc / Meetings / Scope hold the existing pages.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const h = vi.hoisted(() => ({
  selectedAccountId: "act_glow" as string | null,
  tables: {} as Record<string, unknown>,
  taskCalls: [] as Array<{ select: string; col: string; val: string }>,
  taskResult: { data: [] as unknown[], error: null as null | { message: string } },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, role: "builder", isClient: false, isBuilder: true, isEmployee: false }),
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({
    accounts: [
      { id: "act_glow", name: "Glow Meta" },
      { id: "act_multi1", name: "Multi One" },
      { id: "act_multi2", name: "Multi Two" },
    ],
    selectedAccountId: h.selectedAccountId,
    setSelectedAccountId: () => {},
    isLoading: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "pipeline_tasks") {
          return {
            eq: (col: string, val: string) => {
              h.taskCalls.push({ select: columns, col, val });
              return Promise.resolve(h.taskResult);
            },
          };
        }
        return Promise.resolve({ data: h.tables[table] ?? [], error: null });
      },
    }),
  },
}));

// The Overview tab is the real client detail page; its data comes from the dashboard api module.
const loadClientDetail = vi.hoisted(() => vi.fn());
vi.mock("@/features/dashboard/api", () => {
  class DashboardError extends Error {
    code?: string;
  }
  return {
    DashboardError,
    loadClientDetail: (slug: string) => loadClientDetail(slug),
    saveClientDetails: vi.fn(),
    saveClientScope: vi.fn(),
    saveClientActive: vi.fn(),
  };
});

// The existing pages that moved into the hub are stubbed to show which client the shared selection gave them.
vi.mock("@/pages/BriefsPage", async () => {
  const { useSelectedClientSlug } = await import("@/contexts/ClientSelectionContext");
  function BriefsStub() {
    return <div data-testid="page-briefs">{`briefs for ${useSelectedClientSlug()}`}</div>;
  }
  return { default: BriefsStub };
});
async function stub(testid: string, label: string) {
  const { useSelectedClientSlug } = await import("@/contexts/ClientSelectionContext");
  function PageStub() {
    return <div data-testid={testid}>{`${label} for ${useSelectedClientSlug()}`}</div>;
  }
  return { default: PageStub };
}
vi.mock("@/features/bids/BidViewerPage", () => stub("page-brand-doc", "brand doc"));
vi.mock("@/features/meeting-recaps/MeetingRecapsPage", () => stub("page-meetings", "meetings"));
vi.mock("@/features/engagements/EngagementsPage", () => stub("page-engagements", "engagements"));
vi.mock("@/features/deliverables/DeliverablesPage", () => stub("page-deliverables", "deliverables"));
vi.mock("@/features/qa-gates/QaGatesPage", () => stub("page-qa-gates", "qa gates"));
vi.mock("@/features/handoffs/HandoffsPage", () => stub("page-handoffs", "handoffs"));
vi.mock("@/features/scope-changes/ScopeChangesPage", () => stub("page-scope-changes", "scope changes"));
vi.mock("@/features/strategy/StrategyPage", () => stub("page-strategy", "strategy"));
vi.mock("@/features/recommendations/RecommendationsPage", () => stub("page-recommendations", "recommendations"));

import ClientHubPage from "@/features/clients/ClientHubPage";
import { ClientSelectionProvider } from "@/contexts/ClientSelectionProvider";
import { HUB_TABS, SCOPE_SUBTABS, hubPath, resolveClientScopedRoute } from "@/lib/clientHub";
import { PIPELINE_TASK_COLUMNS } from "@/lib/pageQueries";
import { bucketWork, sortByDue, WORK_COLUMNS } from "@/lib/clientWork";

const CLIENTS = [
  { slug: "glow", name: "Glow Drip", active: true },
  { slug: "multi", name: "Multi Brand", active: true },
  { slug: "bare", name: "Bare Bones", active: true },
];
const LINKS = [
  { account_id: "act_glow", client_slug: "glow" },
  { account_id: "act_multi1", client_slug: "multi" },
  { account_id: "act_multi2", client_slug: "multi" },
];

function renderHub(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <ClientSelectionProvider>
          <Routes>
            <Route path="/builder/clients" element={<div data-testid="client-list">list</div>} />
            <Route path="/builder/clients/:slug" element={<ClientHubPage />} />
            <Route path="/builder/clients/:slug/:tab" element={<ClientHubPage />} />
            <Route path="/builder/clients/:slug/:tab/:sub" element={<ClientHubPage />} />
          </Routes>
        </ClientSelectionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const detail = (slug: string, name: string) => ({
  client: {
    slug, name, status: "active", active: true, does_creators: true, does_production: false, origin: "manual",
    service_type: null, strategist: "Sam", pct_complete: 40, contract_start: null, contract_end: null, last_synced: null, scope: null, notes: null,
  },
  deliverables: [], adAccounts: [], engagements: [], cards: [], assignments: [], mappings: [],
});

beforeEach(() => {
  window.localStorage.clear();
  h.selectedAccountId = "act_glow";
  h.taskCalls = [];
  h.taskResult = { data: [], error: null };
  h.tables = { clients: CLIENTS, client_ad_accounts: LINKS };
  loadClientDetail.mockReset();
  loadClientDetail.mockImplementation((slug: string) => Promise.resolve(detail(slug, CLIENTS.find((c) => c.slug === slug)?.name ?? slug)));
});

describe("hub tabs", () => {
  it("lists the seven tabs, marks the open one and links each into the client's address", async () => {
    renderHub("/builder/clients/glow/work");
    const nav = await screen.findByRole("navigation", { name: "Client tabs" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Overview", "Work", "Briefs", "Performance", "Brand doc", "Meetings", "Scope"]);
    expect(within(nav).getByRole("link", { name: "Work" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/builder/clients/glow");
    expect(within(nav).getByRole("link", { name: "Brand doc" }).getAttribute("href")).toBe("/builder/clients/glow/brand-doc");
    expect(within(nav).getByRole("link", { name: "Scope" }).getAttribute("href")).toBe("/builder/clients/glow/scope");
    await waitFor(() => expect(screen.getByTestId("client-hub-name").textContent).toBe("Glow Drip"));
  });

  it("Overview is the client detail content for the client in the address", async () => {
    renderHub("/builder/clients/glow");
    expect(await screen.findByRole("heading", { name: "Glow Drip" })).toBeTruthy();
    expect(loadClientDetail).toHaveBeenCalledWith("glow");
    expect(screen.getByRole("navigation", { name: "Client tabs" })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Client tabs" })).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
  });

  it.each([
    ["briefs", "page-briefs", "briefs for glow"],
    ["brand-doc", "page-brand-doc", "brand doc for glow"],
    ["meetings", "page-meetings", "meetings for glow"],
  ])("%s shows the existing page with the client already chosen", async (tab, testid, text) => {
    renderHub(`/builder/clients/glow/${tab}`);
    expect((await screen.findByTestId(testid)).textContent).toBe(text);
    expect(screen.queryByRole("combobox", { name: "Client" })).toBeNull();
  });

  it.each(SCOPE_SUBTABS.map((s) => [s.slug, s.label]))("Scope > %s (%s) shows its page for the client in the address", async (sub) => {
    renderHub(`/builder/clients/glow/scope/${sub}`);
    const page = await screen.findByTestId(`page-${sub}`);
    expect(page.textContent).toMatch(/ for glow$/);
    const subnav = screen.getByRole("navigation", { name: "Scope sections" });
    expect(within(subnav).getAllByRole("link")).toHaveLength(7);
    expect(within(subnav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("Scope opens on Engagements and offers every old scope page as a sub-tab", async () => {
    renderHub("/builder/clients/glow/scope");
    expect(await screen.findByTestId("page-engagements")).toBeTruthy();
    const subnav = screen.getByRole("navigation", { name: "Scope sections" });
    expect(within(subnav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Engagements", "Deliverables", "QA gates", "Handoffs", "Scope changes", "Strategy", "Recommendations",
    ]);
    expect(within(subnav).getByRole("link", { name: "QA gates" }).getAttribute("href")).toBe("/builder/clients/glow/scope/qa-gates");
  });

  it("an unknown tab goes to the Overview and an unknown scope section goes to Scope", async () => {
    renderHub("/builder/clients/glow/nonsense");
    expect(await screen.findByRole("heading", { name: "Glow Drip" })).toBeTruthy();
    renderHub("/builder/clients/glow/scope/nonsense");
    expect((await screen.findAllByTestId("page-engagements")).length).toBeGreaterThan(0);
  });

  it("says plainly when the client does not exist, and does not render any tab", async () => {
    renderHub("/builder/clients/ghost/work");
    expect(await screen.findByTestId("client-hub-not-found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Clients" }).getAttribute("href")).toBe("/builder/clients");
    expect(screen.queryByRole("navigation", { name: "Client tabs" })).toBeNull();
  });

  it("the model builds the same addresses the tabs link to", () => {
    expect(HUB_TABS.map((t) => hubPath("glow", t.slug))).toEqual([
      "/clients/glow", "/clients/glow/work", "/clients/glow/briefs", "/clients/glow/performance", "/clients/glow/brand-doc", "/clients/glow/meetings", "/clients/glow/scope",
    ]);
    expect(hubPath("a b", "scope", "strategy")).toBe("/clients/a%20b/scope/strategy");
  });
});

describe("Briefs needs an ad account", () => {
  it("says plainly when the client has none, instead of showing another client's briefs", async () => {
    renderHub("/builder/clients/bare/briefs");
    const notice = await screen.findByTestId("no-ad-account");
    expect(notice.textContent).toContain("Bare Bones has no ad account linked yet.");
    expect(screen.queryByTestId("page-briefs")).toBeNull();
  });

  it("waits until the analytics pages point at this client's ad account", async () => {
    h.selectedAccountId = "act_multi2"; // another client's account is still selected
    renderHub("/builder/clients/glow/briefs");
    await waitFor(() => expect(screen.getByTestId("client-hub-name").textContent).toBe("Glow Drip"));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("page-briefs")).toBeNull();
  });

  it("shows the page once the client's own ad account is selected", async () => {
    renderHub("/builder/clients/multi/briefs");
    h.selectedAccountId = "act_multi1";
    expect(await screen.findByTestId("page-briefs")).toBeTruthy();
  });
});

describe("Performance", () => {
  it("links into the analytics for the client's ad account", async () => {
    renderHub("/builder/clients/glow/performance");
    expect((await screen.findByTestId("client-performance-accounts")).textContent).toBe("Ad account: Glow Meta.");
    expect(screen.getByTestId("performance-link-analytics").getAttribute("href")).toBe("/builder/creative/analytics");
    expect(screen.getByTestId("performance-link-overview").getAttribute("href")).toBe("/builder/creative/overview");
    expect(screen.getByTestId("performance-link-creatives").getAttribute("href")).toBe("/builder/creative/creatives");
    expect(screen.getByTestId("performance-link-reports").getAttribute("href")).toBe("/builder/creative/reports");
  });

  it("lists every account for a client with several and points to the account chooser", async () => {
    renderHub("/builder/clients/multi/performance");
    const accounts = await screen.findByTestId("client-performance-accounts");
    await waitFor(() => expect(accounts.textContent).toContain("2 ad accounts: Multi One, Multi Two."));
    expect(accounts.textContent).toContain("Ad account chooser");
  });

  it("says plainly when the client has no ad account", async () => {
    renderHub("/builder/clients/bare/performance");
    expect((await screen.findByTestId("client-performance-no-account")).textContent).toContain("Bare Bones has no ad account linked yet");
    expect(screen.queryByTestId("performance-link-analytics")).toBeNull();
  });
});

describe("Work", () => {
  const task = (id: string, extra: Record<string, unknown> = {}) => ({
    id, task_name: `Asset ${id}`, stage: "Production", due_date: null, content_type: "UGC", updated_at: "2026-11-10T10:00:00Z", ...extra,
  });

  it("reads the ClickUp cards by the client, with the select string the live check runs", async () => {
    h.taskResult = { data: [task("1"), task("2", { stage: "Client Review", due_date: "2026-11-20" }), task("3", { stage: "Editing" })], error: null };
    renderHub("/builder/clients/glow/work");
    await screen.findAllByTestId("client-work-card");
    expect(h.taskCalls).toEqual([{ select: PIPELINE_TASK_COLUMNS, col: "client_slug", val: "glow" }]);
    expect(screen.getAllByTestId("client-work-card")).toHaveLength(3);
    expect(within(screen.getByRole("region", { name: "Production" })).getByText("Asset 1")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Client Review" })).getByText("Asset 2")).toBeTruthy();
    expect(screen.getByTestId("client-work-summary").textContent).toContain("3 cards. 1 waiting on the client.");
  });

  it("works for a client with no ad account, and for one with several", async () => {
    h.taskResult = { data: [task("9")], error: null };
    const first = renderHub("/builder/clients/bare/work");
    expect((await screen.findAllByTestId("client-work-card")).length).toBe(1);
    expect(h.taskCalls[0].val).toBe("bare");
    expect(screen.queryByTestId("no-ad-account")).toBeNull();
    first.unmount();
    renderHub("/builder/clients/multi/work");
    await screen.findAllByTestId("client-work-card");
    expect(h.taskCalls.map((c) => c.val)).toContain("multi");
  });

  it("says plainly when nothing is in production, and when the board could not load", async () => {
    h.taskResult = { data: [], error: null };
    const first = renderHub("/builder/clients/glow/work");
    expect((await screen.findByTestId("client-work-empty")).textContent).toContain("Nothing in production for Glow Drip");
    first.unmount();
    h.taskResult = { data: [], error: { message: "permission denied" } };
    renderHub("/builder/clients/glow/work");
    const error = await screen.findByTestId("client-work-error");
    expect(error.textContent).toContain("could not load");
    expect(screen.queryByTestId("client-work-empty")).toBeNull();
  });

  it("shows no overdue warning on a column Goodo owns", async () => {
    h.taskResult = { data: [task("1", { due_date: "2020-01-01" })], error: null };
    renderHub("/builder/clients/glow/work");
    const card = await screen.findByTestId("client-work-card");
    expect(card.textContent).toContain("Due Jan 1");
    expect(card.textContent).not.toMatch(/Was due|overdue|late/i);
  });
});

describe("work board rules", () => {
  it("buckets by stage, starts a card with no stage in the first column and leaves unknown stages off", () => {
    const b = bucketWork([
      { id: "a", task_name: "A", stage: null, due_date: null, content_type: null, updated_at: null },
      { id: "b", task_name: "B", stage: "Editing", due_date: null, content_type: null, updated_at: null },
      { id: "c", task_name: "C", stage: "Mystery", due_date: null, content_type: null, updated_at: null },
    ]);
    expect(b["Preparing Content"].map((t) => t.id)).toEqual(["a"]);
    expect(b.Editing.map((t) => t.id)).toEqual(["b"]);
    expect(WORK_COLUMNS.flatMap((c) => b[c])).toHaveLength(2);
  });

  it("sorts by due date with undated cards last", () => {
    const rows = [
      { id: "x", task_name: null, stage: null, due_date: null, content_type: null, updated_at: null },
      { id: "y", task_name: null, stage: null, due_date: "2026-12-01", content_type: null, updated_at: null },
      { id: "z", task_name: null, stage: null, due_date: "2026-11-01", content_type: null, updated_at: null },
    ];
    expect(sortByDue(rows).map((t) => t.id)).toEqual(["z", "y", "x"]);
  });
});

describe("old addresses of the pages that moved in", () => {
  it.each([
    ["/engagements", "/clients/glow/scope/engagements"],
    ["/deliverables", "/clients/glow/scope/deliverables"],
    ["/qa-gates", "/clients/glow/scope/qa-gates"],
    ["/handoffs", "/clients/glow/scope/handoffs"],
    ["/scope-changes", "/clients/glow/scope/scope-changes"],
    ["/strategy", "/clients/glow/scope/strategy"],
    ["/recommendations", "/clients/glow/scope/recommendations"],
    ["/pipeline", "/clients/glow/work"],
  ])("%s goes to %s for the client", (from, to) => {
    expect(resolveClientScopedRoute(from, "glow")).toBe(to);
    expect(resolveClientScopedRoute(`${from}/`, "glow")).toBe(to);
  });

  it("goes to the client list when no client is picked, and ignores addresses that did not move", () => {
    expect(resolveClientScopedRoute("/engagements", "")).toBe("/clients");
    expect(resolveClientScopedRoute("/casting", "glow")).toBeNull();
  });
});
