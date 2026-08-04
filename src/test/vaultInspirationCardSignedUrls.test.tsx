/**
 * Regression: InspirationCard used to sign its own thumbnail/file Storage
 * URLs on every mount, unconditionally. When a parent batch-signs URLs up
 * front (LibraryPage's `vault-signed-urls` query) and passes them down via
 * `useProvidedSignedUrls` + `signedThumbnailUrl` / `signedFileUrl`, the card
 * must render those directly and must NOT also call `createSignedUrl` itself
 * — otherwise batching would just add a redundant request on top of the old
 * per-card ones instead of replacing them.
 *
 * The second test pins that callers which DON'T opt in (e.g. BoardDetailPage,
 * which renders a handful of cards at a time) keep the original self-signing
 * behavior unchanged.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const ITEM = {
  id: "it1",
  user_id: "u1",
  platform: "facebook_ad",
  title: "Test item",
  creator_handle: null,
  source_url: null,
  thumbnail_url: null,
  thumbnail_path: "a/thumb1.jpg",
  video_url: null,
  file_path: "a/file1.mp4",
  brand_name: null,
  industry: null,
  ad_format: null,
  target_audience: null,
  script_analysis: null,
  visual_analysis: null,
  status: "ready",
  error_message: null,
  is_featured: false,
  created_at: "2026-08-01T00:00:00Z",
};

const createSignedUrl = vi.fn(async (path: string) => ({
  data: { signedUrl: `https://signed.example/self#${path}` },
  error: null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
  },
}));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { InspirationCard } from "@/features/vault/components/InspirationCard";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderCard(props: Partial<React.ComponentProps<typeof InspirationCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InspirationCard item={ITEM as never} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InspirationCard — batched vs. self-signed URLs", () => {
  it("useProvidedSignedUrls: renders the given URL and never calls createSignedUrl", async () => {
    renderCard({
      useProvidedSignedUrls: true,
      signedThumbnailUrl: "https://signed.example/batched-thumb",
      signedFileUrl: "https://signed.example/batched-file",
    });

    const img = await screen.findByAltText<HTMLImageElement>("Test item");
    expect(img.getAttribute("src")).toBe("https://signed.example/batched-thumb");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("useProvidedSignedUrls omitted: falls back to self-signing (BoardDetailPage's usage)", async () => {
    renderCard();

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledWith("a/thumb1.jpg", 3600));
    expect(createSignedUrl).toHaveBeenCalledWith("a/file1.mp4", 3600);

    const img = await screen.findByAltText<HTMLImageElement>("Test item");
    await waitFor(() =>
      expect(img.getAttribute("src")).toBe("https://signed.example/self#a/thumb1.jpg"),
    );
  });

  it("useProvidedSignedUrls true but URL still resolving: shows loading, still doesn't self-sign", async () => {
    renderCard({ useProvidedSignedUrls: true, signedThumbnailUrl: null, signedFileUrl: null });

    // No thumbnail yet and no file URL to extract a first frame from — the
    // "Loading…"/"No thumbnail" placeholder shows, not a self-signed image.
    await waitFor(() => expect(screen.queryByAltText("Test item")).toBeNull());
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
