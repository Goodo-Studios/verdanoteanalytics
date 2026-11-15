/**
 * Smaller fixes: MediaPreview only links http(s) ad_post_url, and useDistinctHooks reads every
 * page of rows instead of one capped read of non-distinct rows.
 */
import { render as rtlRender, screen, waitFor, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

const pages: { hook: string }[][] = [];
const rangeCalls: [number, number][] = [];

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = vi.fn(chain);
    b.not = vi.fn(chain);
    b.order = vi.fn(chain);
    b.eq = vi.fn(chain);
    b.range = vi.fn((from: number, to: number) => {
      rangeCalls.push([from, to]);
      const idx = from / 1000;
      b.then = (resolve: (v: unknown) => void) => resolve({ data: pages[idx] ?? [], error: null });
      return b;
    });
    return b;
  };
  return { supabase: { from: vi.fn(() => builder()), functions: { invoke: vi.fn() } } };
});
vi.mock("@/hooks/useCachedMedia", () => ({
  useCachedMedia: (url: string | null) => ({ url: url ?? "/placeholder-creative.png", isLoading: false }),
}));

import { MediaPreview } from "@/components/CreativeDetailModal";
import { useDistinctHooks } from "@/hooks/useCreatives";

const qcWrap = (ui: ReactElement) =>
  rtlRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
  );

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const creative = (over: Record<string, unknown>): any => ({
  ad_id: "120000000000001",
  account_id: "act_1",
  ad_name: "Test Ad",
  thumbnail_url: "https://cdn.example.com/thumb.jpg",
  full_res_url: "https://cdn.example.com/thumb.jpg",
  video_url: null,
  ad_post_url: null,
  ...over,
});

beforeEach(() => {
  pages.length = 0;
  rangeCalls.length = 0;
});

describe("MediaPreview ad_post_url safety", () => {
  it("does not link a javascript: ad_post_url; falls back to the Ad Library link", () => {
    qcWrap(<MediaPreview creative={creative({ ad_post_url: "javascript:alert(1)" })} />);
    const link = screen.getByTitle("View this ad on Facebook");
    expect(link.getAttribute("href")).toBe("https://www.facebook.com/ads/library/?id=120000000000001");
  });

  it("does not link a data: URL", () => {
    qcWrap(<MediaPreview creative={creative({ ad_post_url: "data:text/html,<script>1</script>" })} />);
    expect(screen.getByTitle("View this ad on Facebook").getAttribute("href")).toMatch(/^https:\/\/www\.facebook\.com\/ads\/library/);
  });

  it("keeps a normal https ad_post_url", () => {
    qcWrap(<MediaPreview creative={creative({ ad_post_url: "https://www.facebook.com/example/posts/1" })} />);
    expect(screen.getByTitle("View this ad on Facebook").getAttribute("href")).toBe("https://www.facebook.com/example/posts/1");
  });
});

describe("useDistinctHooks pagination", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it("reads every page and finds a hook that only appears after the first thousand rows", async () => {
    pages.push(Array.from({ length: 1000 }, () => ({ hook: "Common hook" })));
    pages.push([...Array.from({ length: 999 }, () => ({ hook: "Common hook" })), { hook: " Rare hook " }]);
    pages.push([]);
    // Page 2 has 1000 rows so a third (empty) page is read to confirm the end.
    pages[1] = [...pages[1].slice(0, 999), { hook: " Rare hook " }];
    const { result } = renderHook(() => useDistinctHooks("acc-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(["Common hook", "Rare hook"]);
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after a short page", async () => {
    pages.push([{ hook: "B" }, { hook: "A" }, { hook: "A" }]);
    const { result } = renderHook(() => useDistinctHooks("acc-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(["A", "B"]);
    expect(rangeCalls).toHaveLength(1);
  });
});
