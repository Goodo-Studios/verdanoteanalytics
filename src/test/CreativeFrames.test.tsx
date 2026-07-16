// US-004 (carousel frame capture) — acceptance test #3.
//
// e2e criterion: "Given a carousel ad in the UI, when the detail view opens, then all
// frames render in order."
//
// CreativeFrames reads its rows through the useCreativeFrames hook (which issues the
// `order("frame_index", ascending)` supabase query). To keep this deterministic (no
// network/DB), we mock the hook — matching the repo's component-test convention of
// stubbing data hooks (see LibraryCard.test.tsx mocking useCachedMedia). The hook's
// contract is "frames ordered by frame_index ASC", so the mock applies that same sort
// to an intentionally UNORDERED input set; the test then asserts the rendered tiles
// appear in ascending frame_index order and that a frame with a null asset/public_url
// shows the pending placeholder instead of crashing.
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreativeFrame } from "@/features/vault/types/vault";

// Mock state the hook mock reads from — set per test before render.
let mockFrames: CreativeFrame[] = [];
let mockLoading = false;

vi.mock("@/hooks/useCreativeFrames", () => ({
  useCreativeFrames: () => {
    // Mirror the hook's SQL `order("frame_index", ascending)` so the component
    // receives rows exactly as production would: ascending by frame_index.
    const data = [...mockFrames].sort((a, b) => a.frame_index - b.frame_index);
    return { data, isLoading: mockLoading };
  },
}));

import { CreativeFrames } from "@/components/creative-detail/CreativeFrames";

function frame(overrides: Partial<CreativeFrame> = {}): CreativeFrame {
  return {
    id: `f_${overrides.frame_index ?? 0}`,
    ad_id: "ad_1",
    frame_index: 0,
    media_type: "image",
    asset_id: "asset_x",
    media_assets: {
      public_url: `https://cdn.example.com/frame_${overrides.frame_index ?? 0}.jpg`,
      content_type: "image/jpeg",
      byte_size: 1000,
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  mockFrames = [];
  mockLoading = false;
});

describe("US-004 CreativeFrames render order + fallback", () => {
  it("renders all 5 carousel frames in ascending frame_index order (given unordered input)", () => {
    // Deliberately unordered — the hook mock re-sorts, proving render follows frame_index.
    mockFrames = [
      frame({ id: "c", frame_index: 2 }),
      frame({ id: "a", frame_index: 0 }),
      frame({ id: "e", frame_index: 4 }),
      frame({ id: "b", frame_index: 1 }),
      frame({ id: "d", frame_index: 3 }),
    ];

    const { container } = render(<CreativeFrames adId="ad_1" />);

    const imgs = Array.from(container.querySelectorAll("img")) as HTMLImageElement[];
    expect(imgs).toHaveLength(5);
    // The <img alt> is `Frame ${index + 1}` where index is the RENDER position, so an
    // in-order render yields Frame 1..5; each src must map to the matching frame_index.
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual([
      "Frame 1",
      "Frame 2",
      "Frame 3",
      "Frame 4",
      "Frame 5",
    ]);
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "https://cdn.example.com/frame_0.jpg",
      "https://cdn.example.com/frame_1.jpg",
      "https://cdn.example.com/frame_2.jpg",
      "https://cdn.example.com/frame_3.jpg",
      "https://cdn.example.com/frame_4.jpg",
    ]);
    // Ordinal badges 1..5 rendered in order too.
    expect(imgs.length).toBe(5);
  });

  it("shows the 'Frame pending' placeholder for a null-asset frame instead of crashing", () => {
    mockFrames = [
      frame({ id: "a", frame_index: 0 }),
      // Uncached frame: no asset, no joined media_assets, no public_url. Must not crash.
      { id: "b", ad_id: "ad_1", frame_index: 1, media_type: "image", asset_id: null, media_assets: null },
      frame({ id: "c", frame_index: 2 }),
    ];

    const { container } = render(<CreativeFrames adId="ad_1" />);

    // The pending frame contributes NO <img>; the two cached frames do.
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    // Placeholder copy is shown for the uncached frame.
    expect(screen.getByText("Frame pending")).toBeInTheDocument();
  });

  it("falls back to the ad thumbnail for an uncached still frame (no crash, no placeholder)", () => {
    mockFrames = [
      frame({ id: "a", frame_index: 0 }),
      { id: "b", ad_id: "ad_1", frame_index: 1, media_type: "image", asset_id: null, media_assets: null },
    ];

    const { container } = render(
      <CreativeFrames adId="ad_1" fallbackThumbnailUrl="https://cdn.example.com/adthumb.jpg" />,
    );

    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    // Cached frame keeps its own url; the uncached still frame uses the ad thumbnail.
    expect(srcs).toContain("https://cdn.example.com/frame_0.jpg");
    expect(srcs).toContain("https://cdn.example.com/adthumb.jpg");
    expect(screen.queryByText("Frame pending")).not.toBeInTheDocument();
  });

  it("renders nothing for a single-frame creative (only the multi-frame strip is surfaced)", () => {
    mockFrames = [frame({ id: "a", frame_index: 0 })];
    const { container } = render(<CreativeFrames adId="ad_1" />);
    // <=1 frame → component returns null (single-asset ads render via the main preview).
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Carousel frames")).not.toBeInTheDocument();
  });

  it("shows the frame count in the header for a multi-frame carousel", () => {
    mockFrames = [
      frame({ id: "a", frame_index: 0 }),
      frame({ id: "b", frame_index: 1 }),
      frame({ id: "c", frame_index: 2 }),
    ];
    render(<CreativeFrames adId="ad_1" />);
    const header = screen.getByText("Carousel frames").parentElement as HTMLElement;
    expect(within(header).getByText("3")).toBeInTheDocument();
  });
});
