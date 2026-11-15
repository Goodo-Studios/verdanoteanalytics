/**
 * Regression tests for long-range aggregates: window ends yesterday, null ratios stay null
 * (rendered as an en dash), ad names are joined, and a missing account prompts selection.
 */
import { renderHook, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const rpc = vi.fn();
const inFn = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ in: (...args: unknown[]) => inFn(...args) }) }),
    }),
  },
}));

import { useWindowAggregates, resolveWindowRange } from "@/hooks/useWindowAggregates";
import { LongRangeAggregates } from "@/features/long-range/LongRangeAggregates";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const baseRow = {
  spend: "120", impressions: "4000", clicks: "80", purchases: "0", purchase_value: "0",
  adds_to_cart: "0", video_views: "0", roas: null, cpa: null, ctr: "2", cpm: "30", cpc: "1.5",
  cost_per_add_to_cart: null, thumb_stop_rate: null, hold_rate: null, video_avg_play_time: null,
  frequency: "1.1", retention_p25: null, retention_p50: null, retention_p75: null, retention_p100: null,
};

afterEach(() => {
  rpc.mockReset();
  inFn.mockReset();
});

describe("resolveWindowRange ends yesterday", () => {
  it("ends on the previous UTC day, not the partial current day", () => {
    const { from, to } = resolveWindowRange(7, new Date("2026-07-14T12:00:00Z"));
    expect(to).toBe("2026-07-13");
    expect(from).toBe("2026-07-07");
  });

  it("crosses a month boundary correctly", () => {
    const { from, to } = resolveWindowRange(3, new Date("2026-08-01T01:00:00Z"));
    expect(to).toBe("2026-07-31");
    expect(from).toBe("2026-07-29");
  });
});

describe("useWindowAggregates null handling and names", () => {
  it("keeps null ratios as null and joins ad names", async () => {
    rpc.mockResolvedValue({ data: [{ ad_id: "ad-1", ...baseRow }], error: null });
    inFn.mockResolvedValue({ data: [{ ad_id: "ad-1", ad_name: "Summer Hook A" }], error: null });
    const { result } = renderHook(() => useWindowAggregates("acc-1", 30), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const row = result.current.data![0];
    expect(row.roas).toBeNull();
    expect(row.cpa).toBeNull();
    expect(row.ad_name).toBe("Summer Hook A");
  });

  it("still returns rows when the name lookup fails", async () => {
    rpc.mockResolvedValue({ data: [{ ad_id: "ad-1", ...baseRow }], error: null });
    inFn.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useWindowAggregates("acc-1", 30), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data![0].ad_name).toBeNull();
  });
});

describe("LongRangeAggregates rendering", () => {
  it("shows the ad name and an en dash for null ROAS and zero-purchase CPA", async () => {
    rpc.mockResolvedValue({ data: [{ ad_id: "ad-1", ...baseRow }], error: null });
    inFn.mockResolvedValue({ data: [{ ad_id: "ad-1", ad_name: "Summer Hook A" }], error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LongRangeAggregates accountId="acc-1" />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText("Summer Hook A")).toBeInTheDocument());
    expect(screen.queryByText("ad-1")).not.toBeInTheDocument();
    expect(screen.getAllByText("–").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("prompts for an account instead of saying No data", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LongRangeAggregates />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Select an account/)).toBeInTheDocument();
    expect(screen.queryByText(/No data/)).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });
});
