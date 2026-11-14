/**
 * A client's first screen (phase 5): the "Waiting on you" line, then the current cycle count with a
 * progress bar, then the metrics. It reads the same cards as the Content Pipeline board (own rows, same
 * queries), uses the same rules, links to the pipeline, and shows only for a real client login: staff,
 * including a builder previewing the client view, never send the queries.
 *
 * Also the landing rule: a client with no ad account but a client link goes straight to its pipeline.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

type Table = { data?: unknown; error?: { message: string } | null; pending?: boolean };
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Table>,
  calls: [] as Array<{ table: string; select: string; eq: number }>,
  auth: {} as Record<string, unknown>,
  accounts: { accounts: [{ id: "act_glow" }] as unknown[], isLoading: false },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (select: string) => {
        const call = { table, select, eq: 0 };
        h.calls.push(call);
        const q = {
          eq: () => {
            call.eq++;
            return q;
          },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const t = h.tables[table] ?? {};
            const p = t.pending ? new Promise(() => {}) : Promise.resolve({ data: t.data ?? [], error: t.error ?? null });
            return p.then(res, rej);
          },
        };
        return q;
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/contexts/AccountContext", () => ({ useAccountContext: () => h.accounts }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/client" }));
vi.mock("@/hooks/useSyncApi", () => ({ useSync: () => ({ mutate: () => {}, isPending: false }) }));
vi.mock("@/hooks/useOverviewPageState", () => ({
  useOverviewPageState: () => ({
    accountName: "Glow Drip",
    lastSyncedAgo: null,
    dateFrom: null,
    dateTo: null,
    setDateRange: () => {},
    metrics: { totalSpend: 0, activeCount: 0, avgCpa: 0, avgRoas: 0, winRate: 0, avgCtr: 0 },
    prevMetrics: null,
    hasPrevPeriod: false,
    isLoading: false,
    creatives: [],
    selectedAccountId: "act_glow",
  }),
}));

import OverviewPage from "@/pages/OverviewPage";

function renderOverview(role: "client" | "builder") {
  h.auth = { user: { id: "u1" }, role, isClient: role === "client", isBuilder: role === "builder", isEmployee: false };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/client/pipeline" element={<div data-testid="pipeline-page">pipeline</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

beforeEach(() => {
  h.tables = {};
  h.calls = [];
  h.accounts = { accounts: [{ id: "act_glow" }], isLoading: false };
});

describe("Waiting on you, client Overview", () => {
  it("counts the cards in Client Review, names the earliest due date, and links to the Content Pipeline", async () => {
    h.tables.pipeline_tasks = {
      data: [
        { id: "1", task_name: "A", stage: "Client Review", due_date: "2026-12-09", content_type: null, updated_at: null },
        { id: "2", task_name: "B", stage: "Client Review", due_date: "2026-12-03", content_type: null, updated_at: null },
        { id: "3", task_name: "C", stage: "Editing", due_date: "2026-11-01", content_type: null, updated_at: null },
      ],
    };
    renderOverview("client");
    const line = await screen.findByTestId("waiting-on-you-line");
    expect(line.textContent).toContain("Waiting on you");
    expect(line.textContent).toContain("2 assets are ready for your review");
    expect(line.textContent).toContain("earliest due Dec 3");
    const link = screen.getAllByRole("link", { name: /content pipeline/i })[0];
    expect(link.getAttribute("href")).toBe("/client/pipeline");
    // The client's own rows, no filter sent, on the board, the delivered list and the engagement dates.
    await waitFor(() => expect(h.calls).toHaveLength(4));
    expect(h.calls.map((c) => [c.table, c.eq]).sort()).toEqual([["client_task_decisions", 0], ["engagements", 0], ["pipeline_delivered", 0], ["pipeline_tasks", 0]]);
    expect(h.calls.find((c) => c.table === "pipeline_tasks")!.select).toBe(
      "id, clickup_task_id, task_name, stage, due_date, content_type, updated_at, cycle_month, delivered_at, asset_link",
    );
  });

  it("says one asset is, and says nothing is waiting when nothing is", async () => {
    h.tables.pipeline_tasks = { data: [{ id: "1", task_name: "A", stage: "Client Review", due_date: null, content_type: null, updated_at: null }] };
    const a = renderOverview("client");
    expect((await screen.findByTestId("waiting-on-you-line")).textContent).toContain("1 asset is ready for your review.");
    a.unmount();
    h.tables.pipeline_tasks = { data: [] };
    renderOverview("client");
    expect((await screen.findByTestId("waiting-on-you-line")).textContent).toContain("Nothing is waiting on you right now.");
  });

  it("says it could not check, rather than that nothing is waiting, when the read fails", async () => {
    h.tables.pipeline_tasks = { error: { message: "x" } };
    renderOverview("client");
    const line = await screen.findByTestId("waiting-on-you-line");
    expect(line.textContent).toContain("could not check");
    expect(line.textContent).not.toContain("Nothing is waiting");
    expect(screen.queryByTestId("landing-cycle")).toBeNull();
  });

  it("shows nothing while loading", async () => {
    h.tables.pipeline_tasks = { pending: true };
    renderOverview("client");
    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("waiting-on-you-line")).toBeNull();
  });

  it("is not on the page for staff, and sends no query for them", async () => {
    renderOverview("builder");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("waiting-on-you-line")).toBeNull();
    expect(screen.queryByTestId("client-landing")).toBeNull();
    expect(h.calls).toEqual([]);
  });
});

describe("current cycle count, client Overview", () => {
  it("shows the current cycle with 'N of M delivered' and a progress bar, counting delivered work from the earlier-delivered list too", async () => {
    const m = thisMonth();
    h.tables.pipeline_tasks = {
      data: [
        { id: "1", task_name: "A", stage: "Ready to Launch", due_date: null, content_type: null, updated_at: null, cycle_month: m, delivered_at: m },
        { id: "2", task_name: "B", stage: "Production", due_date: null, content_type: null, updated_at: null, cycle_month: m, delivered_at: null },
      ],
    };
    h.tables.pipeline_delivered = {
      data: [{ id: "9", task_name: "C", content_type: null, cycle_month: m, delivered_at: m, updated_at: null }],
    };
    renderOverview("client");
    const row = await screen.findByTestId("landing-cycle");
    expect(screen.getByTestId("landing-cycle-count")).toHaveTextContent("2 of 3 delivered");
    expect(row.querySelector('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "67");
    // The waiting line comes first, the cycle count second, the metrics after both.
    const order = [screen.getByTestId("waiting-on-you-line"), row, screen.getByText("Total Spend")];
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("leaves the count off, rather than show it too low, when the earlier-delivered list could not load", async () => {
    const m = thisMonth();
    h.tables.pipeline_tasks = {
      data: [{ id: "1", task_name: "A", stage: "Production", due_date: null, content_type: null, updated_at: null, cycle_month: m, delivered_at: null }],
    };
    h.tables.pipeline_delivered = { error: { message: "x" } };
    renderOverview("client");
    await screen.findByTestId("waiting-on-you-line");
    await waitFor(() => expect(h.calls.length).toBe(4));
    expect(screen.queryByTestId("landing-cycle")).toBeNull();
  });

  it("shows no cycle row when there is no work yet", async () => {
    renderOverview("client");
    await screen.findByTestId("waiting-on-you-line");
    expect(screen.queryByTestId("landing-cycle")).toBeNull();
  });
});

describe("client landing", () => {
  it("sends a client with no ad account but a client link to its pipeline", async () => {
    h.accounts = { accounts: [], isLoading: false };
    h.tables.client_members = { data: [{ client_slug: "pretty-tasty-tea" }] };
    renderOverview("client");
    expect(await screen.findByTestId("pipeline-page")).toBeInTheDocument();
    expect(screen.queryByText("Total Spend")).toBeNull();
    expect(h.calls.find((c) => c.table === "client_members")!.select).toBe("client_slug");
  });

  it("keeps a client with an ad account on the metrics page, and never reads its links", async () => {
    renderOverview("client");
    expect(await screen.findByText("Total Spend")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-page")).toBeNull();
    expect(h.calls.some((c) => c.table === "client_members")).toBe(false);
  });

  it("leaves a client with no ad account and no link on the metrics page", async () => {
    h.accounts = { accounts: [], isLoading: false };
    h.tables.client_members = { data: [] };
    renderOverview("client");
    expect(await screen.findByText("Total Spend")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-page")).toBeNull();
  });

  it("waits, and shows neither page, while the links load", async () => {
    h.accounts = { accounts: [], isLoading: false };
    h.tables.client_members = { pending: true };
    renderOverview("client");
    await waitFor(() => expect(h.calls.some((c) => c.table === "client_members")).toBe(true));
    expect(screen.queryByText("Total Spend")).toBeNull();
    expect(screen.queryByTestId("pipeline-page")).toBeNull();
  });

  it("never redirects staff, even with no accounts", async () => {
    h.accounts = { accounts: [], isLoading: false };
    renderOverview("builder");
    expect(await screen.findByText("Total Spend")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-page")).toBeNull();
    expect(h.calls).toEqual([]);
  });
});
