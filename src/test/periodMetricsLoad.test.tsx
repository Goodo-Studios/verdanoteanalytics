import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { usePeriodMetrics } from "@/hooks/usePeriodMetrics";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const row = {
  total_spend: 100,
  total_impressions: 1000,
  total_clicks: 10,
  total_purchases: 2,
  total_purchase_value: 300,
  total_adds_to_cart: 3,
  total_video_views: 4,
  active_count: 5,
};

describe("usePeriodMetrics load behaviour", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("does not retry the heavy all-accounts call more than once when it fails", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("502") });
    const client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 1 } },
    });
    const { result } = renderHook(
      () => usePeriodMetrics({ dateFrom: "2026-08-15", dateTo: "2026-11-14" }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    // one attempt plus one retry
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("keeps the per-account call on the normal retry budget", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("boom") });
    const client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 1 } },
    });
    const { result } = renderHook(
      () => usePeriodMetrics({ accountId: "act_1", dateFrom: "2026-08-15", dateTo: "2026-11-14" }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("serves a second all-accounts mount from the cache (one RPC call)", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const client = new QueryClient();
    const opts = { dateFrom: "2026-08-15", dateTo: "2026-11-14" };
    const first = renderHook(() => usePeriodMetrics(opts), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    const second = renderHook(() => usePeriodMetrics(opts), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.data?.totalSpend).toBe(100));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not call the server while disabled (previous period waits for the current one)", async () => {
    const client = new QueryClient();
    renderHook(
      () => usePeriodMetrics({ dateFrom: "2026-05-15", dateTo: "2026-08-14", enabled: false }),
      { wrapper: wrapper(client) },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).not.toHaveBeenCalled();
  });
});
