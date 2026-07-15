/**
 * Component tests for the Creative Library card (Feature 4 + F6):
 *   • renders the F6 class badge + performance metrics,
 *   • the select checkbox toggles selection (bulk export),
 *   • clicking the body opens the detail drill-in,
 *   • a video creative shows a Play affordance that swaps in a <video>.
 * Uses fireEvent per the project's component-test convention.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// useCachedMedia hits IndexedDB/network — stub to a passthrough so the card
// renders synchronously in jsdom.
vi.mock("@/hooks/useCachedMedia", () => ({
  useCachedMedia: (src: string) => ({ url: src, isLoading: false, error: false }),
}));

import { LibraryCard } from "@/features/creative-library/components/LibraryCard";
import type { LibraryCreative } from "@/features/creative-library/api";
import type { ClassificationResult } from "@/features/creative-library/hooks/useCreativeLibrary";

function makeCreative(overrides: Partial<LibraryCreative> = {}): LibraryCreative {
  return {
    ad_id: "ad_1",
    account_id: "act_782159176742035",
    ad_name: "Confession POV v3",
    unique_code: "GS147105",
    platform: "meta",
    ad_status: "ACTIVE",
    hook: "confession",
    theme: "pov",
    product: "velora",
    tag_source: "parsed",
    thumbnail_url: "https://cdn.example.com/thumb.jpg",
    full_res_url: null,
    video_url: null,
    preview_url: null,
    landing_page_url: null,
    created_time: "2026-07-01T00:00:00Z",
    first_seen: "2026-07-01T00:00:00Z",
    version: 3,
    video_views: 1000,
    archived: false,
    archive_id: null,
    in_vault: false,
    spend: 5000,
    roas: 3.2,
    cpa: 18.5,
    ctr: 2.4,
    thumb_stop_rate: 34,
    hold_rate: 22,
    purchases: 270,
    frequency: 1.6,
    recent_spend: 2500,
    prior_spend: 2500,
    recent_roas: 3.4,
    prior_roas: 3.0,
    recent_ctr: 2.5,
    prior_ctr: 2.3,
    recent_cpa: 18,
    prior_cpa: 19,
    ...overrides,
  };
}

const winnerClass: ClassificationResult = {
  ad_id: "ad_1",
  klass: "winner",
  reasons: ["ROAS 3.20x at scale"],
  roasTrend: 0.13,
  ctrTrend: 0.08,
  cpaTrend: -0.05,
};

afterEach(() => vi.clearAllMocks());

describe("LibraryCard", () => {
  it("renders the class badge, name, and performance metrics", () => {
    render(
      <LibraryCard
        creative={makeCreative()}
        classification={winnerClass}
        onOpen={vi.fn()}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Winner")).toBeInTheDocument();
    expect(screen.getByText("Confession POV v3")).toBeInTheDocument();
    expect(screen.getByText("3.20x")).toBeInTheDocument(); // ROAS
    expect(screen.getByText("$18.50")).toBeInTheDocument(); // CPA
  });

  it("toggles selection via the checkbox", () => {
    const onToggle = vi.fn();
    render(
      <LibraryCard
        creative={makeCreative()}
        classification={winnerClass}
        onOpen={vi.fn()}
        selected={false}
        onToggleSelect={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /select creative for export/i }));
    expect(onToggle).toHaveBeenCalledWith("ad_1");
  });

  it("opens the detail drill-in when the body is clicked", () => {
    const onOpen = vi.fn();
    render(
      <LibraryCard
        creative={makeCreative()}
        classification={winnerClass}
        onOpen={onOpen}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Confession POV v3"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ ad_id: "ad_1" }));
  });

  it("shows a Play affordance for a video creative and swaps in a <video> on click", () => {
    const { container } = render(
      <LibraryCard
        creative={makeCreative({ video_url: "https://cdn.example.com/v.mp4" })}
        classification={winnerClass}
        onOpen={vi.fn()}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    );
    const play = screen.getByRole("button", { name: /play video/i });
    expect(play).toBeInTheDocument();
    fireEvent.click(play);
    expect(container.querySelector("video")).toBeTruthy();
  });
});
