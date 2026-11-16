/**
 * Cancelling a sync only cancels the account on screen (audit plan item 5.4).
 * The Cancel buttons used to post an empty body, and the server cancelled every
 * running and queued sync for every account.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const apiFetch = vi.fn(async (..._args: unknown[]) => ({ cancelled: 1 }));
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useCancelSync } from "@/hooks/useSyncApi";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => apiFetch.mockClear());

describe("useCancelSync", () => {
  it("sends the account being viewed", async () => {
    const { result } = renderHook(() => useCancelSync("act_1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(undefined);
    });
    const [, path, init] = apiFetch.mock.calls[0] as [string, string, { body?: string }];
    expect(path).toBe("cancel");
    expect(JSON.parse(init.body ?? "{}")).toEqual({ account_id: "act_1" });
  });

  it("sends no account when none is selected (cancel all)", async () => {
    const { result } = renderHook(() => useCancelSync(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(undefined);
    });
    const [, , init] = apiFetch.mock.calls[0] as [string, string, { body?: string }];
    expect(JSON.parse(init.body ?? "{}")).toEqual({});
  });
});
