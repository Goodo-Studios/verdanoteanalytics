/**
 * Vault library regressions:
 *   - tag filtering is a server-side embedded inner join (inspiration_tags!inner), not an
 *     `in (...)` list of every matching item id (capped at 1000 rows, long URLs);
 *   - appending an infinite-scroll page must not blank the thumbnails already on screen
 *     while the new signed-URL batch loads.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const PAGE_SIZE = 48;

const ROWS = Array.from({ length: 120 }, (_, i) => ({
  id: `it${i}`,
  user_id: "u1",
  status: "ready",
  platform: "facebook_ad",
  title: `Item ${i}`,
  thumbnail_path: `a/thumb${i}.jpg`,
  file_path: `a/file${i}.mp4`,
  thumbnail_url: null,
  video_url: null,
  creator_handle: null,
  brand_name: null,
  error_message: null,
  is_featured: false,
  created_at: "2026-08-01T00:00:00Z",
  inspiration_transcripts: [],
  inspiration_frameworks: [],
}));

const selectArgs: string[] = [];
const eqCalls: [string, unknown][] = [];
const inCalls: [string, unknown][] = [];
const fromTables: string[] = [];

function tableBuilder() {
  let featuredOnly = false;
  let range: [number, number] | null = null;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn((s: string) => {
    selectArgs.push(s);
    return builder;
  });
  builder.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    if (col === "is_featured" && val === true) featuredOnly = true;
    return builder;
  });
  builder.in = vi.fn((col: string, val: unknown) => {
    inCalls.push([col, val]);
    return builder;
  });
  builder.order = vi.fn(chain);
  builder.range = vi.fn((from: number, to: number) => {
    range = [from, to];
    return builder;
  });
  builder.then = (resolve: (v: unknown) => void) => {
    let out = featuredOnly ? ROWS.filter((r) => r.is_featured) : ROWS;
    if (range) out = out.slice(range[0], range[1] + 1);
    return resolve({ data: out, error: null });
  };
  return builder;
}

let pendingSecondBatch: { resolve: () => void } | null = null;
let batchCalls = 0;
const createSignedUrls = vi.fn(async (paths: string[]) => {
  batchCalls += 1;
  const result = {
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })),
    error: null,
  };
  if (batchCalls === 2 && pendingSecondBatch === null) {
    await new Promise<void>((resolve) => {
      pendingSecondBatch = { resolve };
    });
  }
  return result;
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      fromTables.push(table);
      return tableBuilder();
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(), createSignedUrls })) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import LibraryPage from "@/features/vault/LibraryPage";

function renderPage(url = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <LibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function gridCardCount(container: HTMLElement) {
  const grid = container.querySelector(".grid");
  return grid ? grid.querySelectorAll('a[href^="/ad-library/"]').length : 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectArgs.length = 0;
  eqCalls.length = 0;
  inCalls.length = 0;
  fromTables.length = 0;
  pendingSecondBatch = null;
  batchCalls = 0;
});

describe("LibraryPage tag filter", () => {
  it("filters with an embedded inner join, never an id list", async () => {
    const { container } = renderPage("/?tag=hooks");
    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));

    const itemSelects = selectArgs.filter((s) => s.includes("inspiration_transcripts"));
    expect(itemSelects.length).toBeGreaterThan(0);
    expect(itemSelects.every((s) => s.includes("inspiration_tags!inner(tag)"))).toBe(true);
    expect(eqCalls).toContainEqual(["inspiration_tags.tag", "hooks"]);
    expect(inCalls.find(([col]) => col === "id")).toBeUndefined();
    // No separate pre-fetch of every tagged item id (the old `select("item_id")`).
    expect(selectArgs).not.toContain("item_id");
  });

  it("does not embed tags when no tag is active", async () => {
    const { container } = renderPage("/");
    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));
    expect(selectArgs.some((s) => s.includes("inspiration_tags"))).toBe(false);
    expect(eqCalls.find(([col]) => col === "inspiration_tags.tag")).toBeUndefined();
  });
});

describe("LibraryPage signed-URL flicker", () => {
  it("keeps already-loaded thumbnails on screen while the next page's URLs are signing", async () => {
    const { container } = renderPage("/");
    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));
    await waitFor(() => expect(container.querySelectorAll('img[src^="https://signed.example/"]').length).toBeGreaterThan(0));
    const before = container.querySelectorAll('img[src^="https://signed.example/"]').length;

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    // The second batch is now held open: the new key has no data yet.
    await waitFor(() => expect(pendingSecondBatch).not.toBeNull());
    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE * 2));

    const during = container.querySelectorAll('img[src^="https://signed.example/"]').length;
    expect(during).toBeGreaterThanOrEqual(before);

    pendingSecondBatch!.resolve();
    await waitFor(() =>
      expect(container.querySelectorAll('img[src^="https://signed.example/"]').length).toBeGreaterThan(before),
    );
  });
});
