/**
 * "Waiting on you" line at the top of a client's Overview. It reads the same cards as the Content
 * Pipeline board (own rows, same query), uses the same summary rule, links to the pipeline, and shows only
 * for a real client login: staff, including a builder previewing the client view, never send the query.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

type Table = { data?: unknown; error?: { message: string } | null; pending?: boolean };
const h = vi.hoisted(() => ({
  table: {} as Table,
  calls: [] as Array<{ select: string; eq: number }>,
  auth: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (select: string) => {
        const call = { select, eq: 0 };
        h.calls.push(call);
        const q = {
          eq: () => {
            call.eq++;
            return q;
          },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const p = h.table.pending ? new Promise(() => {}) : Promise.resolve({ data: h.table.data ?? [], error: h.table.error ?? null });
            return p.then(res, rej);
          },
        };
        return q;
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
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
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.table = {};
  h.calls = [];
});

describe("Waiting on you, client Overview", () => {
  it("counts the cards in Client Review, names the earliest due date, and links to the Content Pipeline", async () => {
    h.table = {
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
    expect(screen.getByRole("link", { name: /content pipeline/i }).getAttribute("href")).toBe("/client/pipeline");
    // Same read as the board: the client's own rows, no filter sent.
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toEqual({ select: "id, task_name, stage, due_date, content_type, updated_at", eq: 0 });
  });

  it("says one asset is, and says nothing is waiting when nothing is", async () => {
    h.table = { data: [{ id: "1", task_name: "A", stage: "Client Review", due_date: null, content_type: null, updated_at: null }] };
    const a = renderOverview("client");
    expect((await screen.findByTestId("waiting-on-you-line")).textContent).toContain("1 asset is ready for your review.");
    a.unmount();
    h.table = { data: [] };
    renderOverview("client");
    expect((await screen.findByTestId("waiting-on-you-line")).textContent).toContain("Nothing is waiting on you right now.");
  });

  it("says it could not check, rather than that nothing is waiting, when the read fails", async () => {
    h.table = { error: { message: "x" } };
    renderOverview("client");
    const line = await screen.findByTestId("waiting-on-you-line");
    expect(line.textContent).toContain("could not check");
    expect(line.textContent).not.toContain("Nothing is waiting");
  });

  it("shows nothing while loading", async () => {
    h.table = { pending: true };
    renderOverview("client");
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(screen.queryByTestId("waiting-on-you-line")).toBeNull();
  });

  it("is not on the page for staff, and sends no query for them", async () => {
    renderOverview("builder");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("waiting-on-you-line")).toBeNull();
    expect(h.calls).toEqual([]);
  });
});
