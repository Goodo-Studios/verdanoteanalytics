// US-008 — Cell drill-down to the hook × body grid and the atomic ad.
//
// e2eTests (from the PRD):
//   1. Given a high-spend cell, when a strategist drills in, then the hook × body
//      grid renders and an inner cell opens the correct ad with its spend and metric.
//
// A live behavioral test on the REAL surface (jsdom + Testing Library), faking
// only the network boundary (supabase.functions.invoke). The REAL MatrixBoardPage
// is wired to the REAL board api.ts + useCreativeMatrix + useCreativeMatrixCell +
// useAccountTaxonomy; the fake edge fn serves rpc_creative_matrix's jsonb for the
// board and rpc_creative_matrix_cell's jsonb for `matrix?view=cell`. The test
// clicks the top-spend outer cell, asserts the inner hook × body grid renders
// (spend-first, with explicit untagged hook/body), then clicks the top inner cell
// and asserts the correct atomic ad opens with its spend and objective metric.

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT_ID = "act_bearaby";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

// ── Outer board payload (rpc_creative_matrix shape) — one tagged cell + the
//    explicit untagged buckets so the board renders and a1×UGC is drillable.
const MATRIX_PAYLOAD = {
  account_id: ACCOUNT_ID,
  date_from: null,
  date_to: null,
  angles: [
    { angle_id: "a1", label: "Busy parents", test_status: "Winner", archived: false, total_spend: 600 },
    { angle_id: null, label: "Untagged", test_status: null, archived: false, total_spend: 100 },
  ],
  creative_types: [
    { creative_type: "UGC", total_spend: 600 },
    { creative_type: null, total_spend: 100 },
  ],
  cells: [
    { angle_id: "a1", angle_label: "Busy parents", is_untagged_angle: false, test_status: "Winner", creative_type: "UGC", is_untagged_type: false, total_spend: 600, n_ads: 5, roas: 3, cpa: 10, ctr: 2, cpm: 5, purchases: 60, total_purchase_value: 1800, result_count: 60, cost_per_result: 10, spend_rank: 1 },
    { angle_id: null, angle_label: "Untagged", is_untagged_angle: true, test_status: null, creative_type: null, is_untagged_type: true, total_spend: 100, n_ads: 1, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20, spend_rank: 2 },
  ],
};

// ── Inner drill-down payload (rpc_creative_matrix_cell shape) for a1×UGC.
//    Hooks/bodies spend DESC untagged last; the top inner cell holds two ads.
const CELL_PAYLOAD = {
  account_id: ACCOUNT_ID,
  angle_id: "a1",
  creative_type: "UGC",
  date_from: null,
  date_to: null,
  angle_label: "Busy parents",
  test_status: "Winner",
  hooks: [
    { hook: "Bold claim", is_untagged: false, total_spend: 400 },
    { hook: null, is_untagged: true, total_spend: 100 },
  ],
  bodies: [
    { body: "Problem-solution", is_untagged: false, total_spend: 400 },
    { body: null, is_untagged: true, total_spend: 100 },
  ],
  cells: [
    { hook: "Bold claim", body: "Problem-solution", is_untagged_hook: false, is_untagged_body: false, total_spend: 400, n_ads: 2, roas: 3.5, cpa: 8, ctr: 2, cpm: 5, purchases: 50, total_purchase_value: 1400, result_count: 50, cost_per_result: 8, spend_rank: 1 },
    { hook: null, body: null, is_untagged_hook: true, is_untagged_body: true, total_spend: 100, n_ads: 1, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20, spend_rank: 2 },
  ],
  ads: [
    { ad_id: "ad_1", ad_name: "Bold Claim Hero", ad_status: "ACTIVE", thumbnail_url: null, preview_url: "https://example.test/p1", video_url: null, hook: "Bold claim", body: "Problem-solution", is_untagged_hook: false, is_untagged_body: false, total_spend: 300, roas: 4, cpa: 7.5, ctr: 2.2, cpm: 5, purchases: 40, total_purchase_value: 1200, result_count: 40, cost_per_result: 7.5 },
    { ad_id: "ad_2", ad_name: "Bold Claim Runner-up", ad_status: "PAUSED", thumbnail_url: null, preview_url: null, video_url: null, hook: "Bold claim", body: "Problem-solution", is_untagged_hook: false, is_untagged_body: false, total_spend: 100, roas: 2, cpa: 12, ctr: 1.5, cpm: 6, purchases: 10, total_purchase_value: 200, result_count: 10, cost_per_result: 12 },
    { ad_id: "ad_3", ad_name: "Loose Ad", ad_status: "ACTIVE", thumbnail_url: null, preview_url: null, video_url: null, hook: null, body: null, is_untagged_hook: true, is_untagged_body: true, total_spend: 100, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20 },
  ],
};

const TAXONOMY_PAYLOAD = {
  account_id: ACCOUNT_ID,
  themes: [],
  creative_types: [
    { creative_type_id: "ct_ugc", lane: "Creator", type_name: "UGC", menu_sort_order: 0, active: true, activation_id: "x", account_sort_order: 0 },
  ],
};

function makeServer() {
  return async (name: string, opts?: { body?: Record<string, unknown> }) => {
    // Cell drill-down first — it also starts with "matrix".
    if (name.includes("view=cell")) {
      return { data: { cell: CELL_PAYLOAD }, error: null };
    }
    if (name.startsWith("matrix")) {
      return { data: { matrix: MATRIX_PAYLOAD }, error: null };
    }
    if (name === "account-taxonomy") {
      return { data: { taxonomy: TAXONOMY_PAYLOAD }, error: null };
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

describe("US-008: drill a high-spend cell into its hook × body grid and open the atomic ad (e2e 1)", () => {
  it("renders the inner grid (spend-first, explicit untagged) then opens the correct ad with spend + metric", async () => {
    renderPage();

    // Board resolves; the top-spend outer cell (Busy parents × UGC) is present.
    await screen.findByText("Busy parents");
    const outerCell = screen.getByRole("button", { name: /Busy parents × UGC/ });

    // Drill in.
    fireEvent.click(outerCell);

    // The inner hook × body grid renders (AC #1).
    const grid = await screen.findByTestId("cell-drilldown");
    expect(grid).toBeInTheDocument();

    // Hooks (columns) and bodies (rows) render, incl. an explicit Untagged
    // bucket on EACH inner axis (AC #3) — not hidden.
    expect(screen.getByText("Bold claim")).toBeInTheDocument();
    expect(screen.getByText("Problem-solution")).toBeInTheDocument();
    expect(screen.getAllByText("Untagged").length).toBeGreaterThanOrEqual(2);

    // The drill-down was fetched through the session-authed `matrix` edge fn
    // with the cell view + the clicked cell's selector.
    await waitFor(() => {
      const names = h.invoke.mock.calls.map((c) => c[0] as string);
      expect(
        names.some((n) => n.includes("view=cell") && n.includes("angle_id=a1") && n.includes("creative_type=UGC")),
      ).toBe(true);
    });

    // Open the top-spend inner cell (Bold claim × Problem-solution): $400, 2 ads.
    const innerCell = screen.getByRole("button", {
      name: /Hook Bold claim × body Problem-solution/,
    });
    fireEvent.click(innerCell);

    // The atomic-ad panel opens with the correct top ad (AC #2): its name, its
    // OWN spend ($300, not the cell's $400), and its objective metric (ROAS,
    // PURCHASE default) = 4.00x.
    const panel = await screen.findByTestId("atomic-ad-panel");
    expect(panel).toBeInTheDocument();
    const cards = screen.getAllByTestId("atomic-ad-card");
    expect(cards).toHaveLength(2); // ad_1 + ad_2 in this combo
    expect(screen.getByText("Bold Claim Hero")).toBeInTheDocument();
    expect(screen.getByText("$300")).toBeInTheDocument();
    expect(screen.getByText("4.00x")).toBeInTheDocument();
    // The runner-up ad is present too, ordered after the higher spender.
    expect(screen.getByText("Bold Claim Runner-up")).toBeInTheDocument();
  });

  it("opens the explicit untagged hook × body inner cell and surfaces its ad", async () => {
    renderPage();
    await screen.findByText("Busy parents");
    fireEvent.click(screen.getByRole("button", { name: /Busy parents × UGC/ }));
    await screen.findByTestId("cell-drilldown");

    // The untagged×untagged inner cell is clickable (untagged surfaced, AC #3).
    const untaggedInner = screen.getByRole("button", {
      name: /Hook Untagged × body Untagged/,
    });
    fireEvent.click(untaggedInner);

    await screen.findByTestId("atomic-ad-panel");
    expect(screen.getByText("Loose Ad")).toBeInTheDocument();
  });
});
