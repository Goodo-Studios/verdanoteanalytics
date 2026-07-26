// App-wide, per-account, persisted date range (fix/matrix-shared-account-daterange).
//
// The date range is a single cross-page selection: pick it once and every page
// (dashboard, analytics, matrix, …) reads the same window for the active
// account, and it persists per account to localStorage. These tests exercise
// the REAL DateRangeProvider with the account id driven by a faked
// AccountContext, asserting: (1) a sensible default when nothing is stored,
// (2) per-account persistence to localStorage, (3) reload of a different
// account's stored range when the app selection changes, and (4) an explicitly
// cleared range persists (does not snap back to the default).

import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { format, subDays } from "date-fns";

// Drives selectedAccountId for the real DateRangeProvider.
const h = vi.hoisted(() => ({ selectedAccountId: "acc_a" as string | null }));

vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: h.selectedAccountId }),
}));

import { DateRangeProvider, useDateRangeContext } from "@/contexts/DateRangeContext";

const DEFAULT_FROM = format(subDays(new Date(), 14), "yyyy-MM-dd");
const DEFAULT_TO = format(subDays(new Date(), 1), "yyyy-MM-dd");

function Harness() {
  const { dateFrom, dateTo, setDateRange } = useDateRangeContext();
  return (
    <div>
      <span data-testid="from">{dateFrom ?? "∅"}</span>
      <span data-testid="to">{dateTo ?? "∅"}</span>
      <button onClick={() => setDateRange("2026-05-01", "2026-05-31")}>set-may</button>
      <button onClick={() => setDateRange(undefined, undefined)}>clear</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <DateRangeProvider>
      <Harness />
    </DateRangeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  h.selectedAccountId = "acc_a";
});
afterEach(() => cleanup());

describe("DateRangeProvider — app-wide, per-account, persisted range", () => {
  it("defaults to the last 14 days → yesterday when nothing is stored", () => {
    renderProvider();
    expect(screen.getByTestId("from")).toHaveTextContent(DEFAULT_FROM);
    expect(screen.getByTestId("to")).toHaveTextContent(DEFAULT_TO);
  });

  it("persists the chosen range to localStorage keyed by the active account", () => {
    renderProvider();
    fireEvent.click(screen.getByText("set-may"));

    expect(screen.getByTestId("from")).toHaveTextContent("2026-05-01");
    expect(screen.getByTestId("to")).toHaveTextContent("2026-05-31");
    expect(JSON.parse(localStorage.getItem("dateRange_acc_a")!)).toEqual({
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });
  });

  it("reloads each account's own stored range when the selected account changes", () => {
    // acc_a has a stored range; acc_b has none (→ default).
    localStorage.setItem("dateRange_acc_a", JSON.stringify({ dateFrom: "2026-01-01", dateTo: "2026-01-31" }));
    const { rerender } = renderProvider();
    expect(screen.getByTestId("from")).toHaveTextContent("2026-01-01");

    // Switch the app-selected account — the provider must reload for acc_b.
    act(() => {
      h.selectedAccountId = "acc_b";
    });
    rerender(
      <DateRangeProvider>
        <Harness />
      </DateRangeProvider>,
    );
    expect(screen.getByTestId("from")).toHaveTextContent(DEFAULT_FROM);
    expect(screen.getByTestId("to")).toHaveTextContent(DEFAULT_TO);
  });

  it("an explicitly cleared range persists and is restored as empty (not the default)", () => {
    localStorage.setItem("dateRange_acc_a", JSON.stringify({ dateFrom: undefined, dateTo: undefined }));
    renderProvider();
    // Cleared range → both fields undefined, NOT snapped back to the 14-day default.
    expect(screen.getByTestId("from")).toHaveTextContent("∅");
    expect(screen.getByTestId("to")).toHaveTextContent("∅");
  });
});
