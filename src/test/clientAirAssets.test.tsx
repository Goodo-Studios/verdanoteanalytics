/**
 * Client Assets and Content Pipeline: where the Air link comes from.
 *
 * The Assets page used to read only os_client_task_cards(), which holds the app's own tasks. Delivered
 * ClickUp work, with its Air review link in pipeline_tasks / pipeline_delivered asset_link, never
 * reached it, so the page showed no link. Now the page also reads those rows (own rows, real client
 * only), takes only a valid https air.inc address, and lists each link once. The Content Pipeline shows
 * the client's task cards when the pipeline tables hold nothing for it.
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardsAsCycleTasks, mergeAssetSources, pipelineAssetCards, type ClientCard } from "@/lib/clientPages";

const h = vi.hoisted(() => ({
  isClient: true,
  cards: [] as unknown[],
  board: [] as unknown[],
  delivered: [] as unknown[],
  tableCalls: [] as string[],
}));

function pageable(result: unknown): Promise<unknown> {
  return Object.assign(Promise.resolve(result), { order: () => pageable(result), range: () => pageable(result), or: () => pageable(result) });
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => Promise.resolve({ data: fn === "os_client_task_cards" ? h.cards : null, error: null }),
    from: (table: string) => ({
      select: () => {
        h.tableCalls.push(table);
        const rows = table === "pipeline_tasks" ? h.board : table === "pipeline_delivered" ? h.delivered : [];
        return pageable({ data: rows, error: null });
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-client" }, isClient: h.isClient }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/client" }));

import ClientAssetsPage from "@/features/client-pages/ClientAssetsPage";
import { ContentPipeline } from "@/components/client/ContentPipeline";

const AIR = "https://air.inc/share/abc123";
const card = (over: Partial<ClientCard> & { id: string }): ClientCard => ({
  title: over.id, stage: null, due_date: null, brief: null, asset_url: null, decision: null, ...over,
});

function renderWith(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.isClient = true;
  h.cards = [];
  h.board = [];
  h.delivered = [];
  h.tableCalls = [];
});

describe("pipelineAssetCards", () => {
  it("keeps delivered rows with a valid Air link and drops everything else", () => {
    const rows = [
      { id: "1", task_name: "November Asset 1 Hero", stage: "Ready to Launch", due_date: "2026-11-05", content_type: null, updated_at: null, asset_link: AIR },
      { id: "2", task_name: "Not delivered", stage: "Editing", due_date: null, content_type: null, updated_at: null, asset_link: AIR },
      { id: "3", task_name: "No link", stage: "Ready to Launch", due_date: null, content_type: null, updated_at: null, asset_link: null },
      { id: "4", task_name: "Wrong host", stage: "Ready to Launch", due_date: null, content_type: null, updated_at: null, asset_link: "https://evil.example/air.inc" },
      { id: "5", task_name: "Plain http", stage: "Ready to Launch", due_date: null, content_type: null, updated_at: null, asset_link: "http://air.inc/x" },
      { id: "6", task_name: "Script", stage: "Ready to Launch", due_date: null, content_type: null, updated_at: null, asset_link: "javascript:alert(1)" },
    ];
    const out = pipelineAssetCards(rows);
    expect(out.map((c) => c.id)).toEqual(["pipeline:1"]);
    expect(out[0].asset_url).toBe(AIR);
    expect(out[0].due_date).toBe("2026-11-05");
  });

  it("dates a delivered row by its delivery day first", () => {
    const [c] = pipelineAssetCards([
      { id: "1", task_name: "A", stage: "Ready to Launch", due_date: "2026-11-05", delivered_at: "2026-11-20", cycle_month: "2026-11-01", content_type: null, updated_at: null, asset_link: AIR },
    ]);
    expect(c.due_date).toBe("2026-11-20");
  });

  it("lists one entry per link when both sources hold the same asset", () => {
    const fromCards = [card({ id: "c1", stage: "Ready to Launch", asset_url: AIR })];
    const fromPipeline = pipelineAssetCards([{ id: "1", task_name: "A", stage: "Ready to Launch", due_date: null, content_type: null, updated_at: null, asset_link: AIR }]);
    expect(mergeAssetSources(fromCards, fromPipeline).map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("cardsAsCycleTasks", () => {
  it("shapes cards like pipeline rows, with no ClickUp id and only a valid Air link", () => {
    const [a, b] = cardsAsCycleTasks([
      card({ id: "x", title: "Spring hero", stage: "Editing", due_date: "2026-12-01", asset_url: AIR }),
      card({ id: "y", title: "Other", stage: "Editing", asset_url: "https://drive.example/file" }),
    ]);
    expect(a).toMatchObject({ id: "card:x", clickup_task_id: null, task_name: "Spring hero", stage: "Editing", asset_link: AIR });
    expect(b.asset_link).toBeNull();
  });
});

describe("Assets page", () => {
  it("shows the Air link of a delivered ClickUp task that is only in the pipeline tables", async () => {
    h.delivered = [{ id: "d1", clickup_task_id: "cu1", task_name: "November Asset 2 Static", content_type: null, cycle_month: "2026-11-01", delivered_at: "2026-11-12", updated_at: null, asset_link: AIR }];
    renderWith(<ClientAssetsPage />);
    const row = await screen.findByTestId("client-asset-row");
    expect(within(row).getByRole("link", { name: "Download" }).getAttribute("href")).toBe(AIR);
    expect(h.tableCalls).toContain("pipeline_delivered");
  });

  it("does not show a link that is not an Air link", async () => {
    h.delivered = [{ id: "d1", task_name: "Bad", content_type: null, cycle_month: null, delivered_at: "2026-11-12", updated_at: null, asset_link: "https://evil.example/x" }];
    renderWith(<ClientAssetsPage />);
    expect(await screen.findByText("No assets yet")).toBeTruthy();
  });

  it("does not read the pipeline tables for a builder previewing the client view", async () => {
    h.isClient = false;
    renderWith(<ClientAssetsPage />);
    expect(await screen.findByText("No assets yet")).toBeTruthy();
    expect(h.tableCalls).toEqual([]);
  });
});

describe("Content Pipeline for a client", () => {
  it("shows the pipeline rows when there are some, and does not swap in the cards", async () => {
    h.board = [{ id: "b1", clickup_task_id: "cu1", task_name: "Board task", stage: "Editing", due_date: "2026-11-20", content_type: null, updated_at: null, cycle_month: "2026-11-01", delivered_at: null, asset_link: null }];
    h.cards = [{ id: "c1", title: "Card task", stage: "Editing", due_date: "2026-11-21", asset_url: null }];
    renderWith(<ContentPipeline own />);
    expect(await screen.findByText("Board task")).toBeTruthy();
    expect(screen.queryByText("Card task")).toBeNull();
  });

  it("shows the client's task cards when the pipeline tables are empty, with the Air link", async () => {
    h.cards = [{ id: "c1", title: "Card task", stage: "Client Review", due_date: "2026-11-21", asset_url: AIR, brief: null, decision: null }];
    renderWith(<ContentPipeline own />);
    expect(await screen.findByText("Card task")).toBeTruthy();
    expect(screen.queryByTestId("pipeline-empty")).toBeNull();
    expect(screen.getAllByTestId("view-asset")[0].getAttribute("href")).toBe(AIR);
  });

  it("still shows the calm empty state when there is nothing anywhere", async () => {
    renderWith(<ContentPipeline own />);
    expect(await screen.findByTestId("pipeline-empty")).toBeTruthy();
  });
});
