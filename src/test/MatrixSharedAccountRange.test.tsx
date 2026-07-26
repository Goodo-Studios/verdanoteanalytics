// fix/matrix-shared-account-daterange — the Creative Matrix board no longer owns
// a private account dropdown or a private date picker. It follows the app-wide
// selected account (the left sidebar) and the app-wide shared, per-account,
// persisted date range. This live test renders the REAL MatrixBoardPage inside
// the REAL DateRangeProvider (account id faked via AccountContext), faking only
// the network boundary, and asserts:
//   1. No account-selector combobox is rendered, even with multiple accounts.
//   2. The board reads the app-SELECTED account (acc_b) — not merely the first
//      account (acc_a) — proving it uses the sidebar selection, not a private copy.
//   3. The `matrix` read carries the shared default range (last 14 days → yesterday).

import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { format, subDays } from "date-fns";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));

const ACC_A = "acc_a";
const ACC_B = "acc_b";

const MATRIX_PAYLOAD = {
  account_id: ACC_B,
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

const TAXONOMY_PAYLOAD = { account_id: ACC_B, themes: [], creative_types: [] };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => h.invoke(...args) } },
}));

// App-selected account is acc_b (second account) — the board must follow THIS,
// not the first account. Real DateRangeProvider reads selectedAccountId from here.
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({
    selectedAccountId: ACC_B,
    accounts: [
      { id: ACC_A, name: "Account A" },
      { id: ACC_B, name: "Account B" },
    ],
  }),
}));

import MatrixBoardPage from "@/features/matrix/board/MatrixBoardPage";
import { DateRangeProvider } from "@/contexts/DateRangeContext";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DateRangeProvider>
        <MatrixBoardPage />
      </DateRangeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.invoke.mockImplementation(async (name: string) => {
    if (name.startsWith("matrix")) return { data: { matrix: MATRIX_PAYLOAD }, error: null };
    if (name === "account-taxonomy") return { data: { taxonomy: TAXONOMY_PAYLOAD }, error: null };
    return { data: null, error: { message: `unexpected fn ${name}` } };
  });
});
afterEach(() => cleanup());

describe("Creative Matrix uses the app-wide account + shared date range", () => {
  it("renders no account-selector combobox even with multiple accounts", async () => {
    renderPage();
    await screen.findByText("Busy parents");
    // The old private account dropdown was a shadcn Select (role=combobox).
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("reads the app-selected account (acc_b) with the shared default range", async () => {
    renderPage();
    await screen.findByText("Busy parents");

    const matrixCall = h.invoke.mock.calls.map((c) => c[0] as string).find((n) => n.startsWith("matrix"));
    expect(matrixCall).toBeDefined();
    // Follows the sidebar selection (acc_b), not merely the first account.
    expect(matrixCall).toContain(`account_id=${ACC_B}`);
    expect(matrixCall).not.toContain(`account_id=${ACC_A}`);
    // Shared default range: last 14 days → yesterday.
    expect(matrixCall).toContain(`date_from=${format(subDays(new Date(), 14), "yyyy-MM-dd")}`);
    expect(matrixCall).toContain(`date_to=${format(subDays(new Date(), 1), "yyyy-MM-dd")}`);
  });
});
