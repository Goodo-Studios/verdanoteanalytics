// US-008 — Cell drill-down, updated 2026-09-27 for the naming convention: a
// Creative Type × Theme cell splits its ads by EXACT hook text (the old
// hook × body inner grid is retired).
//
// e2eTests:
//   1. Given a high-spend cell, when a strategist drills in, then the hook split
//      renders and a hook row opens the correct ad with its spend and metric.
//
// A live behavioral test on the REAL surface (jsdom + Testing Library), faking
// only the network boundary (supabase.functions.invoke). The REAL MatrixBoardPage
// is wired to the REAL board api.ts + useCreativeMatrix + useCreativeMatrixCell;
// the fake edge fn serves rpc_creative_matrix's jsonb for the board and
// rpc_creative_matrix_theme_cell's jsonb for `matrix?view=cell`.

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT_ID = "act_bearaby";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

// ── Board payload (rpc_creative_matrix shape, 20260927200001) — one tagged
//    cell (UGC Native × Busy Parents) + the Other / untagged bucket.
const CELL_BASE = { roas: 1, cpa: 10, ctr: 1, cpm: 5, purchases: 1, total_purchase_value: 1, result_count: 1, cost_per_result: 10 };
const MATRIX_PAYLOAD = {
  account_id: ACCOUNT_ID,
  date_from: null,
  date_to: null,
  creative_types: [
    { creative_type: "UGC Native", is_other: false, total_spend: 600, n_ads: 5 },
    { creative_type: "Studio Clean", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: "Text Forward", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: "Lifestyle", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: null, is_other: true, total_spend: 100, n_ads: 1 },
  ],
  themes: [
    { theme: "Busy Parents", is_untagged: false, total_spend: 600, n_ads: 5 },
    { theme: null, is_untagged: true, total_spend: 100, n_ads: 1 },
  ],
  cells: [
    { ...CELL_BASE, creative_type: "UGC Native", is_other_type: false, theme: "Busy Parents", is_untagged_theme: false, total_spend: 600, n_ads: 5, spend_rank: 1 },
    { ...CELL_BASE, creative_type: null, is_other_type: true, theme: null, is_untagged_theme: true, total_spend: 100, n_ads: 1, spend_rank: 2 },
  ],
};

// ── Drill-down payload (rpc_creative_matrix_theme_cell shape) for
//    UGC Native × Busy Parents: ads split by EXACT hook text, untagged last.
//    "Tired By 3pm" and "Tired by 3pm" stay separate rows (no clustering).
const CELL_PAYLOAD = {
  account_id: ACCOUNT_ID,
  creative_type: "UGC Native",
  is_other_type: false,
  theme: "Busy Parents",
  is_untagged_theme: false,
  date_from: null,
  date_to: null,
  hooks: [
    { hook: "Tired By 3pm", is_untagged: false, total_spend: 400, n_ads: 2, roas: 3.5, cpa: 8, ctr: 2, cpm: 5, purchases: 50, total_purchase_value: 1400, result_count: 50, cost_per_result: 8, spend_rank: 1 },
    { hook: "Tired by 3pm", is_untagged: false, total_spend: 100, n_ads: 1, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20, spend_rank: 2 },
    { hook: null, is_untagged: true, total_spend: 100, n_ads: 1, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20, spend_rank: 3 },
  ],
  ads: [
    { ad_id: "ad_1", ad_name: "GS200001_Video_Creator_UGCNative_Blanket_TiredBy3pm_BusyParents", ad_status: "ACTIVE", thumbnail_url: null, preview_url: "https://example.test/p1", video_url: null, hook: "Tired By 3pm", is_untagged_hook: false, total_spend: 300, roas: 4, cpa: 7.5, ctr: 2.2, cpm: 5, purchases: 40, total_purchase_value: 1200, result_count: 40, cost_per_result: 7.5 },
    { ad_id: "ad_2", ad_name: "Tired Runner-up", ad_status: "PAUSED", thumbnail_url: null, preview_url: null, video_url: null, hook: "Tired By 3pm", is_untagged_hook: false, total_spend: 100, roas: 2, cpa: 12, ctr: 1.5, cpm: 6, purchases: 10, total_purchase_value: 200, result_count: 10, cost_per_result: 12 },
    { ad_id: "ad_3", ad_name: "Lowercase Hook Ad", ad_status: "ACTIVE", thumbnail_url: null, preview_url: null, video_url: null, hook: "Tired by 3pm", is_untagged_hook: false, total_spend: 100, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20 },
    { ad_id: "ad_4", ad_name: "Loose Ad", ad_status: "ACTIVE", thumbnail_url: null, preview_url: null, video_url: null, hook: null, is_untagged_hook: true, total_spend: 100, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20 },
  ],
};

function makeServer() {
  return async (name: string) => {
    // Cell drill-down first — it also starts with "matrix".
    if (name.includes("view=cell")) {
      return { data: { cell: CELL_PAYLOAD }, error: null };
    }
    if (name.startsWith("matrix")) {
      return { data: { matrix: MATRIX_PAYLOAD }, error: null };
    }
    return { data: null, error: { message: `unexpected fn ${name}` } };
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => h.invoke(...args) } },
}));

vi.mock("@/contexts/AccountContext", () => ({
  AccountProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAccountContext: () => ({
    selectedAccountId: ACCOUNT_ID,
    // optimization_goal omitted ⇒ getObjectiveConfig defaults to PURCHASE (ROAS/CPA).
    accounts: [{ id: ACCOUNT_ID, name: "Bearaby" }],
  }),
}));

import MatrixBoardPage from "@/features/matrix/board/MatrixBoardPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MatrixBoardPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockImplementation(makeServer());
});

afterEach(() => cleanup());

describe("US-008: drill a Creative Type × Theme cell into its hook split and open the atomic ad (e2e 1)", () => {
  it("splits the cell by exact hook, then opens the correct ad with spend + metric", async () => {
    renderPage();

    await screen.findByText("Busy Parents");
    fireEvent.click(screen.getByRole("button", { name: /^UGC Native × Busy Parents:/ }));

    const grid = await screen.findByTestId("cell-drilldown");
    expect(grid).toBeInTheDocument();
    expect(screen.getByText("Split by Hook")).toBeInTheDocument();

    // One row per EXACT hook text (case differences stay separate), untagged last.
    const hookRows = screen
      .getAllByTestId("hook-row")
      .map((row) => row.querySelector("th")?.textContent);
    expect(hookRows).toEqual(["Tired By 3pm", "Tired by 3pm", "Untagged"]);
    // No body axis anywhere in the drill-down.
    expect(screen.queryByText(/body/i)).toBeNull();

    // Fetched through the session-authed `matrix` edge fn with the cell view +
    // the clicked cell's Creative Type and Theme selector.
    await waitFor(() => {
      const names = h.invoke.mock.calls.map((c) => c[0] as string);
      expect(
        names.some(
          (n) =>
            n.includes("view=cell") &&
            n.includes("creative_type=UGC+Native") &&
            n.includes("theme=Busy+Parents") &&
            !n.includes("angle_id"),
        ),
      ).toBe(true);
    });

    // Open the top hook: its two ads, the top one with its OWN spend and ROAS.
    fireEvent.click(screen.getByRole("button", { name: /^Hook Tired By 3pm:/ }));
    await screen.findByTestId("atomic-ad-panel");
    const cards = screen.getAllByTestId("atomic-ad-card");
    expect(cards).toHaveLength(2);
    expect(
      screen.getByText("GS200001_Video_Creator_UGCNative_Blanket_TiredBy3pm_BusyParents"),
    ).toBeInTheDocument();
    expect(screen.getByText("$300")).toBeInTheDocument();
    expect(screen.getByText("4.00x")).toBeInTheDocument();
    expect(screen.getByText("Tired Runner-up")).toBeInTheDocument();
    expect(screen.queryByText("Lowercase Hook Ad")).toBeNull();
    // The card shows the cell's Creative Type · Theme and the ad's hook.
    expect(screen.getAllByText("UGC Native · Busy Parents")).toHaveLength(2);
    expect(screen.getAllByText("Hook: Tired By 3pm")).toHaveLength(2);
  });

  it("opens the explicit untagged hook row and surfaces its ad", async () => {
    renderPage();
    await screen.findByText("Busy Parents");
    fireEvent.click(screen.getByRole("button", { name: /^UGC Native × Busy Parents:/ }));
    await screen.findByTestId("cell-drilldown");

    fireEvent.click(screen.getByRole("button", { name: /^Hook Untagged:/ }));
    await screen.findByTestId("atomic-ad-panel");
    expect(screen.getByText("Loose Ad")).toBeInTheDocument();
    expect(screen.getAllByTestId("atomic-ad-card")).toHaveLength(1);
  });

  it("drills the Other / untagged bucket by omitting both selectors", async () => {
    renderPage();
    await screen.findByText("Busy Parents");
    fireEvent.click(screen.getByRole("button", { name: /^Other \/ untagged × Untagged:/ }));
    await waitFor(() => {
      const names = h.invoke.mock.calls.map((c) => c[0] as string);
      const cellCall = names.find((n) => n.includes("view=cell"));
      expect(cellCall).toBeDefined();
      expect(cellCall).not.toContain("creative_type=");
      expect(cellCall).not.toContain("theme=");
    });
  });
});
