/**
 * Regression: the Vault detail player stayed stuck on the expired fbcdn source.
 *
 * `signedUrl` is fetched by a query that resolves AFTER first paint, so the
 * <video> first mounts against the item's `video_url` (an fbcdn link that
 * expires within hours) and then swaps `src` to the durable signed URL. An HTML
 * media element does NOT reload on a `src` change — without a `key` React reuses
 * the same DOM node, the browser keeps the dead source, and the signed-URL
 * design (policy: prefer the signed URL over fbcdn) never actually takes effect.
 *
 * Keying on the resolved src forces unmount/remount, which is what triggers a
 * fresh media-element lifecycle. These tests pin the remount, not just the
 * attribute — asserting `src` alone passes even with the bug present.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const CDN_URL = "https://scontent.xx.fbcdn.net/v/t42/expired.mp4";
const SIGNED_URL = "https://signed.example/video.mp4?token=abc";

const VIDEO_ITEM = {
  id: "it1",
  user_id: "u1",
  platform: "facebook_ad",
  title: "Holiday UGC v3",
  creator_handle: null,
  source_url: null,
  thumbnail_url: null,
  thumbnail_path: null,
  video_url: CDN_URL,
  file_path: "analytics/u1/123/video.mp4",
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

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.single = vi.fn(async () => ({ data: VIDEO_ITEM, error: null }));
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: "it1" }], error: null });
  return builder;
}

// Hold the signing call open so the first render is guaranteed to happen while
// signedUrl is still undefined — reproducing the real ordering.
let releaseSigning: (() => void) | null = null;
const createSignedUrl = vi.fn(
  () =>
    new Promise((resolve) => {
      releaseSigning = () => resolve({ data: { signedUrl: SIGNED_URL }, error: null });
    }),
);

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

const findVideo = async (): Promise<HTMLVideoElement> => {
  await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  return document.querySelector("video") as HTMLVideoElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  releaseSigning = null;
});

describe("Vault detail video — signed URL takeover", () => {
  it("mounts against the CDN url before the signed url resolves", async () => {
    renderPage();
    const video = await findVideo();
    expect(video.getAttribute("src")).toBe(CDN_URL);
  });

  it("remounts the element once the signed url lands, so the browser reloads", async () => {
    renderPage();
    const before = await findVideo();
    expect(before.getAttribute("src")).toBe(CDN_URL);

    releaseSigning!();

    await waitFor(() =>
      expect(document.querySelector("video")?.getAttribute("src")).toBe(SIGNED_URL),
    );
    const after = document.querySelector("video") as HTMLVideoElement;

    // The identity check is the real assertion: a reused node means the browser
    // is still holding the expired CDN source no matter what `src` now reads.
    expect(after).not.toBe(before);
  });

  it("signs the stored file_path rather than reusing the CDN url", async () => {
    renderPage();
    await findVideo();
    await waitFor(() =>
      expect(createSignedUrl).toHaveBeenCalledWith("analytics/u1/123/video.mp4", 3600),
    );
  });

  it("keeps the player mounted with a stable node while nothing changes", async () => {
    renderPage();
    const first = await findVideo();
    const second = await findVideo();
    // A key that churns on every render would remount mid-playback.
    expect(second).toBe(first);
  });
});
