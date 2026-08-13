/**
 * Regression (2026-08-13): "the creative vault loads slowly and cards sit on
 * Loading… forever".
 *
 * InspirationCard falls back to extracting a video's first frame when an item
 * has no stored thumbnail. Two things were wrong with that fallback:
 *
 *   1. It ran on mount for EVERY card in the grid, so a library of a few
 *      hundred items kicked off a few hundred concurrent video downloads and
 *      starved the cards actually on screen. It is now gated on an
 *      IntersectionObserver.
 *
 *   2. It had no terminal failure state. A CORS-tainted canvas was swallowed by
 *      a bare `catch`, and a video that errored or stalled had no handler at
 *      all — so `firstFrameUrl` stayed null with nothing left in flight, and the
 *      card rendered the "Loading…" placeholder indefinitely. That is exactly
 *      what the reported screenshot showed.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A video item with no thumbnail of any kind — the only path to a preview is
// first-frame extraction, which is the code under test.
const VIDEO_ITEM = {
  id: "it1",
  user_id: "u1",
  platform: "facebook_ad",
  title: "Test item",
  creator_handle: null,
  source_url: null,
  thumbnail_url: null,
  thumbnail_path: null,
  video_url: null,
  file_path: "a/file1.mp4",
  brand_name: null,
  status: "ready",
  error_message: null,
  is_featured: false,
  created_at: "2026-08-01T00:00:00Z",
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn() })) } },
}));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { InspirationCard } from "@/features/vault/components/InspirationCard";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Captures every <video> the component creates for frame extraction. */
function spyOnCreatedVideos() {
  const videos: HTMLVideoElement[] = [];
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = real(tag);
    if (tag === "video") {
      // jsdom has no HTMLMediaElement.load(); without this the real call floods
      // stderr with "Not implemented" noise on every mount and unmount.
      (el as HTMLVideoElement).load = () => {};
      videos.push(el as HTMLVideoElement);
    }
    return el;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  return videos;
}

/** Installs a controllable IntersectionObserver; returns a trigger for "in view". */
function stubIntersectionObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  class IOStub {
    constructor(cb: IntersectionObserverCallback) {
      callbacks.push(cb);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = IOStub as any;
  return {
    scrollIntoView: () =>
      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callbacks.forEach((cb) => cb([{ isIntersecting: true } as any], null as any));
      }),
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof InspirationCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InspirationCard
          item={VIDEO_ITEM as never}
          useProvidedSignedUrls
          signedThumbnailUrl={null}
          signedFileUrl="https://signed.example/file1.mp4"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InspirationCard — media loading", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).IntersectionObserver;
  });

  it("does not fetch video bytes until the card scrolls near the viewport", async () => {
    const io = stubIntersectionObserver();
    const videos = spyOnCreatedVideos();

    renderCard();

    // Off screen: the placeholder is up but nothing is being downloaded.
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(videos).toHaveLength(0);

    io.scrollIntoView();

    await waitFor(() => expect(videos).toHaveLength(1));
    expect(videos[0].src).toBe("https://signed.example/file1.mp4");
  });

  it("shows 'No thumbnail' instead of a permanent 'Loading…' when the video errors", async () => {
    const io = stubIntersectionObserver();
    const videos = spyOnCreatedVideos();

    renderCard();
    io.scrollIntoView();
    await waitFor(() => expect(videos).toHaveLength(1));

    expect(screen.getByText("Loading…")).toBeInTheDocument();

    // The signed URL is dead / the codec won't decode.
    act(() => {
      videos[0].dispatchEvent(new Event("error"));
    });

    await waitFor(() => expect(screen.getByText("No thumbnail")).toBeInTheDocument());
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("gives up on a video that never loads or errors, rather than spinning forever", async () => {
    vi.useFakeTimers();
    try {
      const io = stubIntersectionObserver();
      const videos = spyOnCreatedVideos();

      renderCard();
      io.scrollIntoView();
      expect(videos).toHaveLength(1);
      expect(screen.getByText("Loading…")).toBeInTheDocument();

      // Silent stall — no 'error', no 'loadedmetadata', ever.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByText("No thumbnail")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lazy-loads thumbnails so an offscreen card costs no image request", async () => {
    stubIntersectionObserver();
    renderCard({ signedThumbnailUrl: "https://signed.example/thumb.jpg" });

    const img = await screen.findByAltText<HTMLImageElement>("Test item");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
  });
});
