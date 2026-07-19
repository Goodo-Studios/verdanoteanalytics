/**
 * MediaPreview — Meta preview-embed fallback for unplayable video.
 *
 * When a creative's video can't be played from a raw source (a page-owned /
 * permission-blocked sentinel, or a stored url that errors), the viewer must fall
 * back to Meta's hosted preview iframe (via the ad-preview edge function) so the ad
 * PLAYS in-app instead of showing a dead "Video unavailable" state. It must NOT
 * fetch a preview for a directly-playable video or a plain image ad.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
// useCachedMedia just passes the thumbnail through for the test.
vi.mock("@/hooks/useCachedMedia", () => ({
  useCachedMedia: (url: string | null) => ({ url: url ?? "/placeholder-creative.png", isLoading: false }),
}));

import { supabase } from "@/integrations/supabase/client";
import { MediaPreview } from "@/components/CreativeDetailModal";

// deno-lint-ignore no-explicit-any
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

const PREVIEW_URL = "https://business.facebook.com/ads/api/preview_iframe.php?d=ABC&t=scopedtoken";

beforeEach(() => vi.clearAllMocks());

describe("MediaPreview — preview-embed fallback", () => {
  it("embeds the Meta preview iframe for a permission-blocked video", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { url: PREVIEW_URL, format: "MOBILE_FEED_STANDARD" },
      error: null,
    } as never);

    render(<MediaPreview creative={creative({ video_url: "no-video-permission" })} />);

    // It asks the ad-preview function for this ad's preview.
    await waitFor(() =>
      expect(supabase.functions.invoke).toHaveBeenCalledWith("ad-preview", {
        body: { ad_id: "120000000000001" },
      }),
    );
    // And renders the returned iframe so the ad plays in-app.
    const iframe = await screen.findByTitle(/Ad preview/i);
    expect(iframe).toHaveAttribute("src", PREVIEW_URL);
  });

  it("plays a real storage video directly and never fetches a preview", async () => {
    render(
      <MediaPreview
        creative={creative({
          video_url: "https://x.supabase.co/storage/v1/object/public/ad-videos/act_1/v.mp4",
        })}
      />,
    );
    // A directly-playable video → no ad-preview call.
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTitle(/Ad preview/i)).toBeNull();
  });

  it("does not fetch a preview for a plain image ad (no video)", async () => {
    render(<MediaPreview creative={creative({ video_url: null })} />);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTitle(/Ad preview/i)).toBeNull();
  });

  it("falls back to the thumbnail + 'Video unavailable' when no preview is available", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: {}, error: null } as never);

    render(<MediaPreview creative={creative({ video_url: "no-video-permission" })} />);

    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalled());
    // No iframe (embed couldn't resolve); the img must fire onLoad for the badge to show.
    expect(screen.queryByTitle(/Ad preview/i)).toBeNull();
    const img = await screen.findByAltText("Test Ad");
    img.dispatchEvent(new Event("load"));
    await waitFor(() => expect(screen.getByText(/Video unavailable/i)).toBeInTheDocument());
  });
});
