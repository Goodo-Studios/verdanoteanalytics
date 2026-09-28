/**
 * AtomicAdCard media handling — sentinel regression.
 *
 * rpc_creative_matrix_theme_cell passes `creatives.thumbnail_url` / `preview_url` /
 * `video_url` through raw. Discovery never leaves those NULL: a confirmed-absent
 * asset is stored as a sentinel string. The card used a plain truthiness check,
 * so it rendered `<img src="no-thumbnail">` (a broken-image icon plus a request
 * to a relative path) and a "Preview" link pointing at a relative "no-video",
 * instead of falling through to the "No media" placeholder.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AtomicAdCard } from "@/features/matrix/board/AtomicAdCard";
import type { MatrixAtomicAd } from "@/features/matrix/board/api";

const ad = (over: Partial<MatrixAtomicAd> = {}): MatrixAtomicAd => ({
  ad_id: "a1",
  ad_name: "Holiday UGC v3",
  ad_status: "ACTIVE",
  thumbnail_url: null,
  preview_url: null,
  video_url: null,
  hook: "Tired By 3pm",
  is_untagged_hook: false,
  total_spend: 4210,
  roas: 2.13,
  cpa: 19.8,
  ctr: 1.67,
  cpm: 12.4,
  purchases: 212,
  total_purchase_value: 8967,
  result_count: 212,
  cost_per_result: 19.8,
  ...over,
});

function renderCard(over: Partial<MatrixAtomicAd> = {}) {
  return render(
    <AtomicAdCard
      ad={ad(over)}
      theme="Holiday"
      creativeType="UGC Native"
      optimizationGoal="PURCHASE"
    />,
  );
}

describe("AtomicAdCard thumbnail", () => {
  it("renders a real thumbnail URL", () => {
    renderCard({ thumbnail_url: "https://cdn.example.com/a.jpg" });
    expect(screen.getByAltText("Holiday UGC v3")).toHaveAttribute(
      "src", "https://cdn.example.com/a.jpg",
    );
  });

  it("shows the No media placeholder for the no-thumbnail sentinel", () => {
    renderCard({ thumbnail_url: "no-thumbnail" });
    expect(screen.queryByAltText("Holiday UGC v3")).not.toBeInTheDocument();
    expect(screen.getByText(/no media/i)).toBeInTheDocument();
  });

  it("shows the No media placeholder when every media column is a sentinel", () => {
    renderCard({
      thumbnail_url: "no-thumbnail",
      preview_url: null,
      video_url: "no-video",
    });
    expect(screen.getByText(/no media/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /preview/i })).not.toBeInTheDocument();
  });
});

describe("AtomicAdCard preview link", () => {
  it("links to a real preview URL when there is no thumbnail", () => {
    renderCard({ preview_url: "https://facebook.com/ads/preview/1" });
    expect(screen.getByRole("link", { name: /preview/i })).toHaveAttribute(
      "href", "https://facebook.com/ads/preview/1",
    );
  });

  it("falls back to a real video URL when there is no preview URL", () => {
    renderCard({ video_url: "https://cdn.example.com/a.mp4" });
    expect(screen.getByRole("link", { name: /preview/i })).toHaveAttribute(
      "href", "https://cdn.example.com/a.mp4",
    );
  });

  it("never links to a no-video-* sentinel", () => {
    for (const sentinel of ["no-video", "no-video-permission", "no-video-deleted"]) {
      const { unmount } = renderCard({ video_url: sentinel });
      expect(screen.queryByRole("link", { name: /preview/i })).not.toBeInTheDocument();
      expect(screen.getByText(/no media/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("skips a sentinel preview_url and uses the real video_url behind it", () => {
    renderCard({ preview_url: "no-thumbnail", video_url: "https://cdn.example.com/a.mp4" });
    expect(screen.getByRole("link", { name: /preview/i })).toHaveAttribute(
      "href", "https://cdn.example.com/a.mp4",
    );
  });
});
