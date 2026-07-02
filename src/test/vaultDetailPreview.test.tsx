/**
 * Regression: Vault detail page must render an image-only item's stored still.
 *
 * Root bug ("saves with no media / No preview"): analytics saves
 * (vault-save-creative) store the still in storage (thumbnail_path / file_path)
 * but never populate the thumbnail_url / video_url columns. ItemDetailPage's
 * file_path signed-URL query is gated to videos, so for an image-only item it
 * signed nothing and fell back to the empty thumbnail_url — showing "No preview"
 * even though the image was saved. The fix signs thumbnail_path and uses it.
 *
 * These tests pin that the detail page renders the signed stored still (and does
 * NOT show "No preview") for an image-only item.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// An image-only analytics save: file_path === thumbnail_path (a stored .jpg),
// and the CDN columns thumbnail_url / video_url are null (never populated).
const IMAGE_ONLY_ITEM = {
  id: "it1",
  user_id: "u1",
  platform: "facebook_ad",
  title: "VID_UGC_PDP_JACKIE TESTIMONIAL",
  creator_handle: null,
  source_url: null,
  thumbnail_url: null,
  thumbnail_path: "analytics/u1/123/thumb.jpg",
  video_url: null,
  file_path: "analytics/u1/123/thumb.jpg",
  brand_name: "Acme",
  industry: null,
  ad_format: null,
  target_audience: null,
  script_analysis: null,
  visual_analysis: null,
  status: "ready",
  error_message: null,
  created_at: "2026-07-02T00:00:00Z",
  inspiration_transcripts: [],
  inspiration_frameworks: [],
};

const SIGNED = "https://signed.example/thumb.jpg?token=abc";

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.single = vi.fn(async () => ({ data: IMAGE_ONLY_ITEM, error: null }));
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: "it1" }], error: null });
  return builder;
}

const createSignedUrl = vi.fn(async (path: string) => ({
  data: { signedUrl: `${SIGNED}#${path}` },
  error: null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => makeBuilder()),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("@/features/vault/hooks/useItemStatus", () => ({ useItemStatus: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ItemDetailPage from "@/features/vault/ItemDetailPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ad-library/it1"]}>
        <Routes>
          <Route path="/ad-library/:id" element={<ItemDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Vault detail preview — image-only item", () => {
  it("renders the signed stored still (thumbnail_path), not 'No preview'", async () => {
    renderPage();

    const img = await screen.findByAltText<HTMLImageElement>("VID_UGC_PDP_JACKIE TESTIMONIAL");
    await waitFor(() =>
      expect(img.getAttribute("src")).toBe(`${SIGNED}#analytics/u1/123/thumb.jpg`),
    );
    expect(screen.queryByText("No preview")).toBeNull();
    // The still was signed from thumbnail_path.
    expect(createSignedUrl).toHaveBeenCalledWith("analytics/u1/123/thumb.jpg", 3600);
  });
});
