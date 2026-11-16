/**
 * API key scopes are set by create_api_key itself (audit plan item 1.5).
 *
 * The screen used to create a key and then write its scopes with a direct table update, which
 * the owner-only row rule allowed for any scope. Now the scopes go into create_api_key, which
 * refuses non-staff callers and unknown scopes, so the direct update is no longer needed and
 * can be closed in a later release.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useCreateApiKey } from "@/hooks/useApiKeysApi";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient() }, children);
}

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
});

describe("useCreateApiKey", () => {
  it("passes the chosen scopes to create_api_key and makes no direct table write", async () => {
    h.rpc.mockResolvedValue({ data: "key-id", error: null });
    const { result } = renderHook(() => useCreateApiKey(), { wrapper });
    const key = await result.current.mutateAsync({ name: "Zapier", scopes: ["read", "sync"] });

    expect(key).toMatch(/^vdn_[0-9a-f]{24}$/);
    expect(h.rpc).toHaveBeenCalledWith("create_api_key", {
      key_name: "Zapier",
      api_key: key,
      scopes: ["read", "sync"],
    });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("surfaces a refusal from create_api_key", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("only staff can create API keys") });
    const { result } = renderHook(() => useCreateApiKey(), { wrapper });
    await expect(result.current.mutateAsync({ name: "x", scopes: ["read"] })).rejects.toThrow("only staff");
    await waitFor(() => expect(h.from).not.toHaveBeenCalled());
  });
});
