/**
 * Audit 7.5: every "Load more" re-signed the storage paths of EVERY card already on screen,
 * because the batched signing query was keyed on the whole list of paths. With a few hundred
 * cards loaded, each click re-requested hundreds of signed URLs that were still valid. Signed
 * URLs are now cached per path, and a new page asks only for the paths it adds.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const PAGE_SIZE = 48;

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `it${i}`, user_id: "u1", status: "ready", platform: "facebook_ad", title: `Item ${i}`,
    thumbnail_path: `a/thumb${i}.jpg`, file_path: `a/file${i}.mp4`, thumbnail_url: null, video_url: null,
    creator_handle: null, brand_name: null, error_message: null, is_featured: false,
    created_at: "2026-08-01T00:00:00Z", inspiration_transcripts: [], inspiration_frameworks: [],
  }));
}

const ROWS = makeItems(120);

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
  builder.range = vi.fn((from: number, to: number) => {
    range = [from, to];
    return builder;
  });
  builder.then = (resolve: (v: unknown) => void) => {
    let out = featuredOnly ? rows.filter((r) => r.is_featured) : rows;
    if (range) out = out.slice(range[0], range[1] + 1);
    return resolve({ data: out, error: null });
  };
  return builder;
}

const createSignedUrl = vi.fn();
const createSignedUrls = vi.fn(async (paths: string[]) => ({
  data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })),
  error: null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => (table === "inspiration_tags" ? tableBuilder([]) : tableBuilder(ROWS))),
    storage: { from: vi.fn(() => ({ createSignedUrl, createSignedUrls })) },
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LibraryPage: signed URLs are cached per path", () => {
  it("Load more signs only the new page's paths", async () => {
    renderPage();
    await screen.findByText("Item 0");
    await waitFor(() => expect(createSignedUrls).toHaveBeenCalledTimes(1));
    expect(createSignedUrls.mock.calls[0][0]).toHaveLength(PAGE_SIZE * 2);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText("Item 60");
    await waitFor(() => expect(createSignedUrls).toHaveBeenCalledTimes(2));

    const second = createSignedUrls.mock.calls[1][0] as string[];
    expect(second).toHaveLength(PAGE_SIZE * 2);
    expect(second).toContain("a/thumb60.jpg");
    expect(second).not.toContain("a/thumb0.jpg");
  });

  it("cards from the first page keep their signed URLs after Load more", async () => {
    renderPage();
    await screen.findByText("Item 0");
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText("Item 60");
    await waitFor(() => expect(createSignedUrls).toHaveBeenCalledTimes(2));
    const img0 = await screen.findByAltText<HTMLImageElement>("Item 0");
    expect(img0.getAttribute("src")).toBe("https://signed.example/a/thumb0.jpg");
    const img60 = await screen.findByAltText<HTMLImageElement>("Item 60");
    await waitFor(() => expect(img60.getAttribute("src")).toBe("https://signed.example/a/thumb60.jpg"));
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
