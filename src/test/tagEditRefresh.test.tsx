/**
 * Every tag change refreshes every screen that shows tags (audit plan item 5.6).
 *
 * Auto-tag and the Theme/Persona editor did not refresh ["all-creatives"] (cached
 * for 2 hours), and inline tag edits did not refresh ["creative-library"], so other
 * screens kept showing the old tags. All tag changes now share one refresh list.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ applied: 3 })) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useAutoTagApply, useUpdateCreative } from "@/hooks/useCreatives";

const SCREENS = [["creatives"], ["all-creatives"], ["creative-library"], ["creative-filters"], ["creative-distinct-hooks"], ["accounts"]];

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
function invalidatedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe("tag changes refresh every tag screen", () => {
  it("auto-tag apply", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useAutoTagApply(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("act_1");
    });
    const keys = invalidatedKeys(spy);
    for (const k of SCREENS) expect(keys).toContain(JSON.stringify(k));
  });

  it("an inline or bulk tag edit", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateCreative(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ adId: "ad-1", updates: { hook: "Did you know" } });
    });
    const keys = invalidatedKeys(spy);
    for (const k of SCREENS) expect(keys).toContain(JSON.stringify(k));
  });

  it("the shared refresh step covers every tag screen", async () => {
    const mod = await import("@/lib/tagRefresh");
    const spy = vi.spyOn(qc, "invalidateQueries");
    await mod.refreshAfterTagChange(qc);
    const keys = invalidatedKeys(spy);
    for (const k of SCREENS) expect(keys).toContain(JSON.stringify(k));
  });

  it("the Theme/Persona editor and Sync from name use the shared refresh step", () => {
    const editor = readFileSync(resolve(__dirname, "../features/creative-library/components/GovernedTagEditor.tsx"), "utf8");
    const syncFromName = readFileSync(resolve(__dirname, "../components/creatives/SyncFromNameDialog.tsx"), "utf8");
    expect(editor).toContain("refreshAfterTagChange(");
    expect(syncFromName).toContain("refreshAfterTagChange(");
  });
});
