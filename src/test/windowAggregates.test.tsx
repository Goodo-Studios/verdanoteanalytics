/**
 * US-005: On-demand long-range views computed from daily rows.
 *
 * Covers the query-time aggregation path that makes a full year cheap to hold:
 *
 *   useWindowAggregates — resolves a preset window (30/90/180/365d) into an
 *   inclusive from/to `date` range, calls the get_creative_window_aggregates
 *   RPC exactly once with those params, maps the numeric result, and stays
 *   suppressed when no account is selected (cross-account leak guard). The
 *   window is clamped to RETENTION_DAYS=365 so the UI can never over-request.
 *
 *   LongRangeAggregates — renders the per-ad rows and, on a preset switch,
 *   re-requests the RPC with the new (wider) window.
 */
import { renderHook, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  useWindowAggregates,
  resolveWindowRange,
  RETENTION_DAYS,
  WINDOW_PRESETS,
} from "@/hooks/useWindowAggregates";
import { LongRangeAggregates } from "@/features/long-range/LongRangeAggregates";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Diff between two YYYY-MM-DD strings in whole days. Parse via UTC epoch (month
// is 0-indexed in Date.UTC, so subtract 1) to avoid month-boundary miscounts.
function dayDiff(from: string, to: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

afterEach(() => {
  rpc.mockReset();
});

describe("resolveWindowRange", () => {
  it("produces an inclusive window: a 30d request spans 29 prior days + today", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    const { from, to } = resolveWindowRange(30, now);
    expect(to).toBe("2026-07-14");
    expect(dayDiff(from, to)).toBe(29); // inclusive endpoints
  });

  it("resolves the full-year preset to a 364-day span (365 inclusive days)", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    const { from, to } = resolveWindowRange(365, now);
    expect(dayDiff(from, to)).toBe(364);
    // Never exceeds the RPC's RETENTION_DAYS cap.
    expect(dayDiff(from, to)).toBeLessThanOrEqual(RETENTION_DAYS);
  });

  it("clamps an over-wide request down to RETENTION_DAYS so the UI can't over-request", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    const { from, to } = resolveWindowRange(9999, now);
    expect(dayDiff(from, to)).toBe(RETENTION_DAYS - 1); // 364, i.e. 365 inclusive days
  });
});

describe("useWindowAggregates", () => {
  it("calls the RPC once with the resolved window and maps the numeric result", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          ad_id: "ad-1",
          spend: "100.5",
          impressions: "1000",
          clicks: "50",
          purchases: "5",
          purchase_value: "500",
          adds_to_cart: "20",
          video_views: "800",
          roas: "4.975",
          cpa: "20.1",
          ctr: "5",
          cpm: "100.5",
          cpc: "2.01",
          cost_per_add_to_cart: "5.025",
          thumb_stop_rate: "80",
          hold_rate: "25",
          video_avg_play_time: "3.2",
          frequency: "1.4",
          retention_p25: "90",
          retention_p50: "60",
          retention_p75: "40",
          retention_p100: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useWindowAggregates("acc-1", 90), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0] as [string, Record<string, string>];
    expect(fnName).toBe("get_creative_window_aggregates");
    expect(args.p_account_id).toBe("acc-1");
    expect(dayDiff(args.p_from, args.p_to)).toBe(89); // 90 inclusive days

    const row = result.current.data![0];
    expect(row.spend).toBe(100.5);
    expect(row.roas).toBeCloseTo(4.975);
    expect(row.retention_p50).toBe(60);
    // null retention stays null (not coerced to 0).
    expect(row.retention_p100).toBeNull();
  });

  it("stays suppressed when no account is selected (no cross-account leak)", async () => {
    const { result } = renderHook(() => useWindowAggregates(undefined, 30), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("exposes the four common windows the UI can request", () => {
    expect(WINDOW_PRESETS).toEqual([30, 90, 180, 365]);
  });
});

describe("LongRangeAggregates", () => {
  it("renders per-ad rows and re-requests the RPC when the window preset changes", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          ad_id: "ad-42",
          spend: "250",
          impressions: "5000",
          clicks: "100",
          purchases: "10",
          purchase_value: "1000",
          adds_to_cart: "40",
          video_views: "2000",
          roas: "4",
          cpa: "25",
          ctr: "2",
          cpm: "50",
          cpc: "2.5",
          cost_per_add_to_cart: "6.25",
          thumb_stop_rate: "40",
          hold_rate: "20",
          video_avg_play_time: "2.1",
          frequency: "1.2",
          retention_p25: "88",
          retention_p50: "55",
          retention_p75: "33",
          retention_p100: "11",
        },
      ],
      error: null,
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LongRangeAggregates accountId="acc-9" />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText("ad-42")).toBeInTheDocument());

    // Default preset is 30d.
    const firstArgs = rpc.mock.calls[0][1] as Record<string, string>;
    expect(dayDiff(firstArgs.p_from, firstArgs.p_to)).toBe(29);

    // Switch to 365d → a new RPC call with a wider window.
    fireEvent.click(screen.getByRole("button", { name: "365d" }));

    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(1));
    const lastArgs = rpc.mock.calls[rpc.mock.calls.length - 1][1] as Record<string, string>;
    expect(dayDiff(lastArgs.p_from, lastArgs.p_to)).toBe(364);
  });
});
