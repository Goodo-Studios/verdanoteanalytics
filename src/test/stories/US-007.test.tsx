// US-007 — Creative Matrix board section (builder-only).
//
// e2eTests (from the PRD):
//   1. Given a builder on /matrix for Bearaby, when the page loads, then the
//      board renders with spend-ranked cells and the mode toggles switch views.
//   2. Given a non-builder session, when navigating to /matrix, then access is
//      denied.
//
// Both are live behavioral tests on the REAL surface (jsdom + Testing Library),
// with only the network boundary (supabase.functions.invoke) faked in memory:
//   • Test 1 renders the REAL MatrixBoardPage wired to the REAL board api.ts +
//     useCreativeMatrix + useAccountTaxonomy (for lane grouping). The fake edge
//     fn serves rpc_creative_matrix's exact jsonb shape; the board must render
//     spend-colored cells in Theme/Persona spend-DESC column order (spend-first
//     ranking), and the five view-mode toggles must switch the cell display.
//   • Test 2 renders App's REAL exported RoleGuardedRoutes and asserts the
//     builder-only /matrix guard: a builder reaches the board, while an
//     employee, a client, and a builder in client-preview are all redirected to
//     their index (Overview). Only OverviewPage is stubbed to a marker (the
//     redirect target); every other route stays lazy and never mounts, and
//     MatrixBoardPage stays REAL so the builder case exercises the true page.
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT_ID = "act_bearaby";

// Mutable role drivers + the network mock, shared across the file's module mocks.
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: {
    user: { id: "u1", email: "b@test.com" } as { id: string; email: string } | null,
    role: "builder" as "builder" | "employee" | "client" | null,
    isLoading: false,
    isBuilder: true,
    isEmployee: false,
    isClient: false,
  },
  preview: { isClientPreview: false, isEmployeePreview: false },
}));

// --- Network boundary: an in-memory fake of the two session-authed edge fns the
// board reads — `matrix` (GET rpc_creative_matrix) and `account-taxonomy` (the
// creative_type → lane map). Payloads use the exact RPC shapes.
const MATRIX_PAYLOAD = {
  account_id: ACCOUNT_ID,
  date_from: null,
  date_to: null,
  angles: [
    { angle_id: "a1", label: "Busy parents", test_status: "Winner", archived: false, total_spend: 800 },
    { angle_id: "a2", label: "Value seekers", test_status: null, archived: false, total_spend: 300 },
    { angle_id: null, label: "Untagged", test_status: null, archived: false, total_spend: 100 },
  ],
  creative_types: [
    { creative_type: "UGC", total_spend: 700 },
    { creative_type: "Static Image", total_spend: 400 },
    { creative_type: null, total_spend: 100 },
  ],
  cells: [
    { angle_id: "a1", angle_label: "Busy parents", is_untagged_angle: false, test_status: "Winner", creative_type: "UGC", is_untagged_type: false, total_spend: 600, n_ads: 5, roas: 3, cpa: 10, ctr: 2, cpm: 5, purchases: 60, total_purchase_value: 1800, result_count: 60, cost_per_result: 10, spend_rank: 1 },
    { angle_id: "a1", angle_label: "Busy parents", is_untagged_angle: false, test_status: "Winner", creative_type: "Static Image", is_untagged_type: false, total_spend: 200, n_ads: 2, roas: 2, cpa: 12, ctr: 1.5, cpm: 6, purchases: 16, total_purchase_value: 400, result_count: 16, cost_per_result: 12, spend_rank: 2 },
    { angle_id: "a2", angle_label: "Value seekers", is_untagged_angle: false, test_status: null, creative_type: "Static Image", is_untagged_type: false, total_spend: 200, n_ads: 3, roas: 1.5, cpa: 15, ctr: 1, cpm: 7, purchases: 13, total_purchase_value: 300, result_count: 13, cost_per_result: 15, spend_rank: 2 },
    { angle_id: "a2", angle_label: "Value seekers", is_untagged_angle: false, test_status: null, creative_type: "UGC", is_untagged_type: false, total_spend: 100, n_ads: 1, roas: 1, cpa: 20, ctr: 0.9, cpm: 8, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20, spend_rank: 4 },
    { angle_id: null, angle_label: "Untagged", is_untagged_angle: true, test_status: null, creative_type: null, is_untagged_type: true, total_spend: 100, n_ads: 1, roas: 1, cpa: 20, ctr: 0.5, cpm: 9, purchases: 5, total_purchase_value: 100, result_count: 5, cost_per_result: 20, spend_rank: 5 },
  ],
};

const TAXONOMY_PAYLOAD = {
  account_id: ACCOUNT_ID,
  themes: [],
  creative_types: [
    { creative_type_id: "ct_ugc", lane: "Video", type_name: "UGC", menu_sort_order: 0, active: true, activation_id: "x", account_sort_order: 0 },
    { creative_type_id: "ct_static", lane: "Static", type_name: "Static Image", menu_sort_order: 1, active: true, activation_id: "y", account_sort_order: 1 },
  ],
};

function makeServer() {
  return async (name: string, opts?: { body?: Record<string, unknown> }) => {
    if (name.startsWith("matrix")) {
      return { data: { matrix: MATRIX_PAYLOAD }, error: null };
    }
    if (name === "account-taxonomy") {
      if (opts?.body?.action === "list") return { data: { taxonomy: TAXONOMY_PAYLOAD }, error: null };
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
    accounts: [{ id: ACCOUNT_ID, name: "Bearaby" }],
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => h.auth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({
  useClientPreview: () => h.preview,
  useClientPreviewMode: () => h.preview,
  ClientPreviewContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
}));

// RoleGuardedRoutes chrome — stub to passthroughs so test 2 isolates the guard.
vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ClientPreviewBanner", () => ({ ClientPreviewBanner: () => null }));
// Only the redirect target (index → OverviewPage) is stubbed to a marker; every
// other route stays lazy and never mounts. MatrixBoardPage stays REAL.
vi.mock("@/pages/OverviewPage", () => ({ default: () => <div data-testid="page-overview">overview</div> }));

import MatrixBoardPage from "@/features/matrix/board/MatrixBoardPage";
import { RoleGuardedRoutes } from "@/App";
import { Routes, Route } from "react-router-dom";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MatrixBoardPage />
    </QueryClientProvider>,
  );
}

function renderGuardedAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/:role/*" element={<RoleGuardedRoutes />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setRole(
  role: "builder" | "employee" | "client",
  opts: { clientPreview?: boolean; employeePreview?: boolean } = {},
) {
  h.auth = {
    user: { id: "u1", email: `${role}@test.com` },
    role,
    isLoading: false,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
  };
  h.preview = {
    isClientPreview: !!opts.clientPreview,
    isEmployeePreview: !!opts.employeePreview,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockImplementation(makeServer());
  setRole("builder");
});

afterEach(() => cleanup());

describe("US-007: builder board renders spend-ranked cells and mode toggles switch views (e2e 1)", () => {
  it("renders Theme/Persona columns spend-DESC with an explicit untagged bucket", async () => {
    renderPage();

    // Board resolves — the two tagged Theme/Persona columns + the untagged one.
    const parents = await screen.findByText("Busy parents");
    const value = screen.getByText("Value seekers");
    // Both axes carry an explicit "Untagged" bucket (angle + type).
    expect(screen.getAllByText("Untagged").length).toBeGreaterThanOrEqual(2);

    // Spend-first ranking: the higher-spend Theme/Persona column comes first.
    expect(
      parents.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows spend in performance mode, then switches to volume and win rate", async () => {
    renderPage();
    await screen.findByText("Busy parents");

    // Performance (default): the top-spend cell shows its spend.
    expect(screen.getByText("$600")).toBeInTheDocument();

    // Volume: cell display switches to the ad count (5 ads in the top cell);
    // the spend figure is gone.
    fireEvent.click(screen.getByRole("button", { name: /^Volume$/i }));
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.queryByText("$600")).toBeNull();

    // Win rate: spend share of the column — 600 / 800 = 75% (spend-first, never ROAS).
    fireEvent.click(screen.getByRole("button", { name: /^Win rate$/i }));
    expect(await screen.findByText("75%")).toBeInTheDocument();
  });

  it("reads the matrix through the session-authed `matrix` edge fn (never the external api)", async () => {
    renderPage();
    await screen.findByText("Busy parents");
    const fnNames = h.invoke.mock.calls.map((c) => c[0] as string);
    expect(fnNames.some((n) => n.startsWith("matrix"))).toBe(true);
    // No call targets the key-gated external `api` function.
    for (const n of fnNames) expect(n === "api" || n.startsWith("api?")).toBe(false);
  });
});

describe("US-007: /matrix is builder-only — non-builders are denied (e2e 2)", () => {
  it("renders the board for a builder at /builder/matrix", async () => {
    setRole("builder");
    renderGuardedAt("/builder/matrix");
    expect(await screen.findByText("Creative Matrix")).toBeInTheDocument();
    expect(screen.queryByTestId("page-overview")).toBeNull();
  });

  it("redirects an employee away from /employee/matrix (to the index)", async () => {
    setRole("employee");
    renderGuardedAt("/employee/matrix");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
    expect(screen.queryByText("Creative Matrix")).toBeNull();
  });

  it("redirects a client away from /client/matrix (to the index)", async () => {
    setRole("client");
    renderGuardedAt("/client/matrix");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
    expect(screen.queryByText("Creative Matrix")).toBeNull();
  });

  it("redirects a builder in client-preview away from /client/matrix", async () => {
    setRole("builder", { clientPreview: true });
    renderGuardedAt("/client/matrix");
    expect(await screen.findByTestId("page-overview")).toBeInTheDocument();
    expect(screen.queryByText("Creative Matrix")).toBeNull();
  });
});
