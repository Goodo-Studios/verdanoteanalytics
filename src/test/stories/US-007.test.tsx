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
//     useCreativeMatrix. The fake edge fn serves rpc_creative_matrix's exact
//     jsonb shape (20260927200001: Creative Type rows × Theme columns); the
//     board must render the 4 Creative Types in fixed order + Other / untagged,
//     Theme / Persona columns spend-DESC, and the four view-mode toggles must
//     switch the cell display. (Updated 2026-09-27 from the old Theme/Persona
//     angle × 90-type lane board.)
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

// --- Network boundary: an in-memory fake of the session-authed `matrix` edge fn
// (GET rpc_creative_matrix). The payload uses the exact RPC shape from
// 20260927200001: Creative Type rows (fixed order + Other / untagged) × Theme
// columns (spend DESC, untagged last).
const CELL_BASE = { roas: 1, cpa: 10, ctr: 1, cpm: 5, purchases: 1, total_purchase_value: 1, result_count: 1, cost_per_result: 10 };
const MATRIX_PAYLOAD = {
  account_id: ACCOUNT_ID,
  date_from: null,
  date_to: null,
  creative_types: [
    { creative_type: "UGC Native", is_other: false, total_spend: 700, n_ads: 6 },
    { creative_type: "Studio Clean", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: "Text Forward", is_other: false, total_spend: 400, n_ads: 5 },
    { creative_type: "Lifestyle", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: null, is_other: true, total_spend: 100, n_ads: 1 },
  ],
  themes: [
    { theme: "Busy Parents", is_untagged: false, total_spend: 800, n_ads: 7 },
    { theme: "Tired By 3pm", is_untagged: false, total_spend: 300, n_ads: 4 },
    { theme: null, is_untagged: true, total_spend: 100, n_ads: 1 },
  ],
  cells: [
    { ...CELL_BASE, creative_type: "UGC Native", is_other_type: false, theme: "Busy Parents", is_untagged_theme: false, total_spend: 600, n_ads: 5, spend_rank: 1 },
    { ...CELL_BASE, creative_type: "Text Forward", is_other_type: false, theme: "Busy Parents", is_untagged_theme: false, total_spend: 200, n_ads: 2, spend_rank: 2 },
    { ...CELL_BASE, creative_type: "Text Forward", is_other_type: false, theme: "Tired By 3pm", is_untagged_theme: false, total_spend: 200, n_ads: 3, spend_rank: 2 },
    { ...CELL_BASE, creative_type: "UGC Native", is_other_type: false, theme: "Tired By 3pm", is_untagged_theme: false, total_spend: 100, n_ads: 1, spend_rank: 4 },
    { ...CELL_BASE, creative_type: null, is_other_type: true, theme: null, is_untagged_theme: true, total_spend: 100, n_ads: 1, spend_rank: 5 },
  ],
};

const EMPTY_PAYLOAD = {
  account_id: ACCOUNT_ID,
  date_from: null,
  date_to: null,
  creative_types: [
    { creative_type: "UGC Native", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: "Studio Clean", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: "Text Forward", is_other: false, total_spend: 0, n_ads: 0 },
    { creative_type: "Lifestyle", is_other: false, total_spend: 0, n_ads: 0 },
  ],
  themes: [],
  cells: [],
};

function makeServer(payload: unknown = MATRIX_PAYLOAD) {
  return async (name: string) => {
    if (name.startsWith("matrix")) {
      return { data: { matrix: payload }, error: null };
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
  it("labels the axes Creative Type and Theme / Persona, with no Body axis", async () => {
    renderPage();
    await screen.findByText("Busy Parents");
    expect(screen.getByText("Creative Type")).toBeInTheDocument();
    expect(screen.getByText("Theme / Persona")).toBeInTheDocument();
    expect(screen.queryByText(/body/i)).toBeNull();
    // The legend states how untyped / legacy ads are handled.
    expect(screen.getByTestId("matrix-legend")).toHaveTextContent(/Other \/ untagged/);
  });

  it("renders the 4 Creative Types in fixed order, then Other / untagged", async () => {
    renderPage();
    await screen.findByText("Busy Parents");
    const rowLabels = screen
      .getAllByTestId("matrix-row")
      .map((row) => row.querySelector("th span")?.textContent);
    expect(rowLabels).toEqual([
      "UGC Native",
      "Studio Clean",
      "Text Forward",
      "Lifestyle",
      "Other / untagged",
    ]);
  });

  it("renders Theme / Persona columns spend-DESC with the untagged column last", async () => {
    renderPage();
    const parents = await screen.findByText("Busy Parents");
    const tired = screen.getByText("Tired By 3pm");
    const untagged = screen.getByText("Untagged");
    expect(parents.compareDocumentPosition(tired) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tired.compareDocumentPosition(untagged) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Cells are addressed as Creative Type × Theme.
    expect(screen.getByRole("button", { name: /^UGC Native × Busy Parents: \$600 spend, 5 ads$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Other \/ untagged × Untagged:/ })).toBeInTheDocument();
  });

  it("shows spend in performance mode, then switches to volume and win rate", async () => {
    renderPage();
    await screen.findByText("Busy Parents");

    // Performance (default): the top-spend cell shows its spend.
    expect(screen.getByText("$600")).toBeInTheDocument();
    // Status mode is gone (theme is free text, no test status).
    expect(screen.queryByRole("button", { name: /^Status$/i })).toBeNull();

    // Volume: cell display switches to the ad count (5 ads in the top cell).
    fireEvent.click(screen.getByRole("button", { name: /^Volume$/i }));
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.queryByText("$600")).toBeNull();

    // Win rate: spend share of the theme column — 600 / 800 = 75%.
    fireEvent.click(screen.getByRole("button", { name: /^Win rate$/i }));
    expect(await screen.findByText("75%")).toBeInTheDocument();
  });

  it("shows the generator empty state when no ads are in scope", async () => {
    h.invoke.mockImplementation(makeServer(EMPTY_PAYLOAD));
    renderPage();
    expect(
      await screen.findByText(/fills in as new ads are named with the generator/i),
    ).toBeInTheDocument();
  });

  it("reads the matrix through the session-authed `matrix` edge fn only (no taxonomy read)", async () => {
    renderPage();
    await screen.findByText("Busy Parents");
    const fnNames = h.invoke.mock.calls.map((c) => c[0] as string);
    expect(fnNames.some((n) => n.startsWith("matrix"))).toBe(true);
    // No call targets the key-gated external `api` function, and the retired
    // creative-type lane map is no longer fetched.
    for (const n of fnNames) {
      expect(n === "api" || n.startsWith("api?")).toBe(false);
      expect(n).not.toBe("account-taxonomy");
    }
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
