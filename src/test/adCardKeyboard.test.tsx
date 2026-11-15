/**
 * AdCard: the clickable media and info regions are keyboard operable
 * (role=button, focusable, Enter and Space activate), without hijacking keys
 * pressed on nested controls.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AdCard } from "@/features/ad-library/components/AdCard";
import type { AdLibrarySavedAd } from "@/features/ad-library/types/ad-library";

const ad = {
  id: "ad-1",
  user_id: "u1",
  source_url: "https://example.com/ad",
  advertiser_name: "Acme Co",
  advertiser_page_id: null,
  ad_id: null,
  platform: "facebook",
  ad_status: null,
  ad_format: "image",
  headline: "Big sale",
  body_text: null,
  cta_text: null,
  landing_page_url: null,
  media_urls: [],
  thumbnail_url: null,
  started_running: null,
  country_targeting: [],
  raw_data: null,
  notes: null,
  transcript: null,
  transcript_status: "none",
  stored_media: [],
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
} as unknown as AdLibrarySavedAd;

describe("AdCard keyboard access", () => {
  it("exposes the media and info regions as focusable buttons", () => {
    render(<AdCard ad={ad} onViewDetails={vi.fn()} />);
    const regions = screen.getAllByRole("button", { name: /View details for/ });
    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (const r of regions) expect(r).toHaveAttribute("tabindex", "0");
  });

  it("opens details on Enter and Space from either region", () => {
    const onViewDetails = vi.fn();
    render(<AdCard ad={ad} onViewDetails={onViewDetails} />);
    const [media, info] = screen.getAllByRole("button", { name: /View details for/ });
    fireEvent.keyDown(media, { key: "Enter" });
    fireEvent.keyDown(info, { key: " " });
    expect(onViewDetails).toHaveBeenCalledTimes(2);
    expect(onViewDetails).toHaveBeenCalledWith(ad);
  });

  it("ignores other keys", () => {
    const onViewDetails = vi.fn();
    render(<AdCard ad={ad} onViewDetails={onViewDetails} />);
    const [media] = screen.getAllByRole("button", { name: /View details for/ });
    fireEvent.keyDown(media, { key: "a" });
    fireEvent.keyDown(media, { key: "Tab" });
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it("toggles selection instead of opening when selectable", () => {
    const onViewDetails = vi.fn();
    const onToggleSelect = vi.fn();
    render(<AdCard ad={ad} selectable onViewDetails={onViewDetails} onToggleSelect={onToggleSelect} />);
    const [media] = screen.getAllByRole("button", { name: /^Select / });
    fireEvent.keyDown(media, { key: "Enter" });
    expect(onToggleSelect).toHaveBeenCalledWith("ad-1");
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it("does not activate when the key comes from a nested control", () => {
    const onViewDetails = vi.fn();
    render(<AdCard ad={ad} onViewDetails={onViewDetails} />);
    const [, info] = screen.getAllByRole("button", { name: /View details for/ });
    const inner = document.createElement("button");
    info.appendChild(inner);
    fireEvent.keyDown(inner, { key: "Enter" });
    expect(onViewDetails).not.toHaveBeenCalled();
  });
});
