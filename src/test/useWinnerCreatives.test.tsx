/**
 * Regression: the client "What's working" winners surface (US-004) must fetch
 * its candidates with a SINGLE bounded request, not the full-table
 * useAllCreatives scan (count query + every page in parallel). The unbounded
 * scan stalled the winners section past the client surface load budget against
 * a real prod dataset — the US-009 E2E failure this hook fixes.
 *
 * We assert the observable contract: exactly one apiFetch to the creatives
 * function, scoped to delivering creatives (spend > 0) and capped at the edge
 * function's max page size.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...args: any[]) => apiFetch(...args) }));

import { useWinnerCreatives } from "@/hooks/useWinnerCreatives";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  apiFetch.mockReset();
});

describe("useWinnerCreatives", () => {
  it("issues a single bounded creatives request (spend>0, capped page)", async () => {
    apiFetch.mockResolvedValue([{ ad_id: "a1", spend: 100, roas: 5 }]);

    const { result } = renderHook(() => useWinnerCreatives("acc-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Exactly one request — NOT the count + N-pages full-table scan.
    expect(apiFetch).toHaveBeenCalledTimes(1);

    const [fn, path] = apiFetch.mock.calls[0];
    expect(fn).toBe("creatives");
    expect(path).toContain("account_id=acc-1");
    expect(path).toContain("delivery=had_delivery"); // spend > 0 prerequisite
    expect(path).toContain("limit=500"); // edge function max page size
    expect(path).toContain("offset=0");

    expect(result.current.data).toEqual([{ ad_id: "a1", spend: 100, roas: 5 }]);
  });

  it("omits account_id when no account is selected", async () => {
    apiFetch.mockResolvedValue([]);

    const { result } = renderHook(() => useWinnerCreatives(undefined), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [, path] = apiFetch.mock.calls[0];
    expect(path).not.toContain("account_id");
    expect(path).toContain("delivery=had_delivery");
  });

  it("tolerates a {data:[...]} envelope shape", async () => {
    apiFetch.mockResolvedValue({ data: [{ ad_id: "b2", spend: 50 }] });

    const { result } = renderHook(() => useWinnerCreatives("acc-2"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([{ ad_id: "b2", spend: 50 }]);
  });
});
