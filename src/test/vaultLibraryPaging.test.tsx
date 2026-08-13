/**
 * The Vault library used to fetch and mount every saved item in one shot, so a
 * large library paid for its entire contents on every load. The grid is now
 * paged (VAULT_PAGE_SIZE at a time, appended on demand).
 *
 * Two things paging must not break:
 *   • The Featured rail. It used to be `items.filter(is_featured)` over the
 *     one big list; against a paged list a starred item on page 4 would simply
 *     disappear from the rail until the user scrolled far enough. It is now its
 *     own query.
 *   • The video/static filter, which is derived from file_path rather than
 *     stored, so it can only be applied after rows return. Naively paging would
 *     hand back "48 rows, 6 of which match" and render a near-empty page while
 *     "Load more" still had thousands left.
 */
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const PAGE_SIZE = 48;

function makeItems(
  count: number,
  opts: { featuredIndexes?: number[]; staticEvery?: number } = {},
) {
  const { featuredIndexes = [], staticEvery = 0 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    id: `it${i}`,
    user_id: "u1",
    status: "ready",
    platform: "facebook_ad",
    title: `Item ${i}`,
    thumbnail_path: `a/thumb${i}.jpg`,
    file_path: staticEvery && i % staticEvery === 0 ? `a/file${i}.jpg` : `a/file${i}.mp4`,
    thumbnail_url: null,
    video_url: null,
    creator_handle: null,
    brand_name: null,
    error_message: null,
    is_featured: featuredIndexes.includes(i),
    created_at: "2026-08-01T00:00:00Z",
    inspiration_transcripts: [],
    inspiration_frameworks: [],
  }));
}

let ROWS: ReturnType<typeof makeItems> = [];
const rangeCalls: [number, number][] = [];

function tableBuilder(rows: { is_featured?: boolean }[]) {
  let featuredOnly = false;
  let range: [number, number] | null = null;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn((col: string, val: unknown) => {
    if (col === "is_featured" && val === true) featuredOnly = true;
    return builder;
  });
  builder.in = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.range = vi.fn((from: number, to: number) => {
    range = [from, to];
    rangeCalls.push([from, to]);
    return builder;
  });
  builder.then = (resolve: (v: unknown) => void) => {
    let out = featuredOnly ? rows.filter((r) => r.is_featured) : rows;
    if (range) out = out.slice(range[0], range[1] + 1);
    return resolve({ data: out, error: null });
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) =>
      table === "inspiration_tags" ? tableBuilder([]) : tableBuilder(ROWS),
    ),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(),
        createSignedUrls: vi.fn(async (paths: string[]) => ({
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })),
          error: null,
        })),
      })),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import LibraryPage from "@/features/vault/LibraryPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Cards in the main grid, excluding the Featured rail above it. */
function gridCardCount(container: HTMLElement) {
  const grid = container.querySelector(".grid");
  return grid ? grid.querySelectorAll('a[href^="/ad-library/"]').length : 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  rangeCalls.length = 0;
  ROWS = [];
});

describe("LibraryPage — paging", () => {
  it("renders one page, not the whole library", async () => {
    ROWS = makeItems(120);
    const { container } = renderPage();

    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));
    // The first read is bounded — it never asked for all 120.
    expect(rangeCalls[0]).toEqual([0, PAGE_SIZE - 1]);
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  it("appends the next page on Load more, resuming where the last one ended", async () => {
    ROWS = makeItems(120);
    const { container } = renderPage();
    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE * 2));
    expect(rangeCalls).toContainEqual([PAGE_SIZE, PAGE_SIZE * 2 - 1]);
    // Appended, not replaced.
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(screen.getByText("Item 50")).toBeInTheDocument();
  });

  it("hides Load more once the library is exhausted", async () => {
    ROWS = makeItems(10);
    const { container } = renderPage();

    await waitFor(() => expect(gridCardCount(container)).toBe(10));
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("keeps a featured item visible even when it lives past the first page", async () => {
    // Item 100 is well beyond page one, and starred.
    ROWS = makeItems(120, { featuredIndexes: [100] });
    const { container } = renderPage();

    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));

    // The rail is its own query, so the star shows without loading 100 cards.
    const featured = await screen.findByRole("heading", { name: "Featured" });
    const rail = featured.closest("div")?.parentElement as HTMLElement;
    await waitFor(() => expect(within(rail).getByText("Item 100")).toBeInTheDocument());
  });

  it("fills a page with matching items when the video filter excludes most rows", async () => {
    // Every other item is a static image; the default filter is "all", so
    // switching to video must still produce a full page rather than 24.
    ROWS = makeItems(400, { staticEvery: 2 });
    const { container } = renderPage();
    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));

    rangeCalls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));

    await waitFor(() => expect(gridCardCount(container)).toBe(PAGE_SIZE));

    // A single 48-row read would only have yielded 24 videos, so filling the
    // page must have taken more than one read.
    expect(rangeCalls.length).toBeGreaterThan(1);

    // And every card in the grid is a video — the odd-numbered items.
    const grid = container.querySelector(".grid") as HTMLElement;
    const titles = [...grid.querySelectorAll("p")]
      .map((p) => p.textContent ?? "")
      .filter((t) => /^Item \d+$/.test(t));
    expect(titles).toHaveLength(PAGE_SIZE);
    expect(titles.every((t) => Number(t.split(" ")[1]) % 2 === 1)).toBe(true);
  });
});
