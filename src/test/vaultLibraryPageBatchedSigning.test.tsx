/**
 * Regression: before this fix, a Vault grid of N items fired up to 2N signed
 * Storage URL requests on load — one `createSignedUrl` call per card, per
 * path. LibraryPage now signs every visible item's paths in a single
 * `createSignedUrls` batch call and hands each card its pre-signed URLs.
 *
 * This pins the fix at the page level (not just the card in isolation):
 * rendering a grid of several items must call the batch API exactly once,
 * with every item's paths, and must never fall through to the old per-card
 * singular API.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ITEMS = [
  {
    id: "it1", user_id: "u1", status: "ready", platform: "facebook_ad", title: "Item 1",
    thumbnail_path: "a/thumb1.jpg", file_path: "a/file1.mp4", thumbnail_url: null, video_url: null,
    creator_handle: null, source_url: null, brand_name: null, is_featured: false,
    created_at: "2026-08-01T00:00:00Z", inspiration_transcripts: [], inspiration_frameworks: [],
  },
  {
    id: "it2", user_id: "u1", status: "ready", platform: "tiktok", title: "Item 2",
    thumbnail_path: "a/thumb2.jpg", file_path: "a/file2.mp4", thumbnail_url: null, video_url: null,
    creator_handle: null, source_url: null, brand_name: null, is_featured: false,
    created_at: "2026-08-01T00:00:00Z", inspiration_transcripts: [], inspiration_frameworks: [],
  },
  {
    id: "it3", user_id: "u1", status: "ready", platform: "instagram", title: "Item 3",
    // Reuses item 1's thumbnail path — must be signed once, not twice.
    thumbnail_path: "a/thumb1.jpg", file_path: "a/file3.mp4", thumbnail_url: null, video_url: null,
    creator_handle: null, source_url: null, brand_name: null, is_featured: false,
    created_at: "2026-08-01T00:00:00Z", inspiration_transcripts: [], inspiration_frameworks: [],
  },
];

function tableBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return builder;
}

const createSignedUrl = vi.fn();
const createSignedUrls = vi.fn(async (paths: string[]) => ({
  data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })),
  error: null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => (table === "inspiration_tags" ? tableBuilder([]) : tableBuilder(ITEMS))),
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

describe("LibraryPage — batched signed-URL fetch", () => {
  it("signs every visible item's storage paths in one batch call, deduped, never per-card", async () => {
    renderPage();

    await screen.findByText("Item 1");
    screen.getByText("Item 2");
    screen.getByText("Item 3");

    await waitFor(() => expect(createSignedUrls).toHaveBeenCalledTimes(1));
    const [signedPaths] = createSignedUrls.mock.calls[0];
    expect(new Set(signedPaths)).toEqual(
      new Set(["a/thumb1.jpg", "a/file1.mp4", "a/thumb2.jpg", "a/file2.mp4", "a/file3.mp4"]),
    );

    // The old per-card singular signer must never fire once batching is wired up.
    expect(createSignedUrl).not.toHaveBeenCalled();

    // And each card renders its slice of the batched map.
    const img1 = await screen.findByAltText<HTMLImageElement>("Item 1");
    expect(img1.getAttribute("src")).toBe("https://signed.example/a/thumb1.jpg");
  });
});
