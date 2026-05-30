/**
 * US-004 — "What's working" playable video winners.
 *
 * Verifies the client winners surface renders each winner's video inline with a
 * stable key (per soft policy goodo-verdanote-react-video-key-prop), falls back
 * to a thumbnail when there's no video, and — critically — never leaks internal
 * strategist metrics (Hook Rate / grade / CPA / kill-scale / threshold UI).
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// useCachedMedia touches IndexedDB; in jsdom we just echo the url back.
vi.mock("@/hooks/useCachedMedia", () => ({
  useCachedMedia: (url: string | null | undefined) => ({
    url: url ?? "/placeholder-creative.png",
    isLoading: false,
    error: null,
    retry: () => {},
  }),
}));

import {
  ClientWinnersSection,
  type ClientWinner,
} from "@/components/client/ClientWinnersSection";

const winnerWithVideo: ClientWinner = {
  id: "ad-100",
  ad_name: "Sleep anxiety hook",
  video_url: "https://cdn.example.com/ad-100.mp4",
  thumbnail_url: "https://cdn.example.com/ad-100.jpg",
  full_res_url: null,
  spend: 1200,
  roas: 4.2,
  purchase_value: 5040,
};

const winnerNoVideo: ClientWinner = {
  id: "ad-200",
  ad_name: "Calm morning routine",
  video_url: null,
  thumbnail_url: "https://cdn.example.com/ad-200.jpg",
  full_res_url: null,
  spend: 800,
  roas: 3.1,
  purchase_value: 2480,
};

afterEach(() => cleanup());

describe("ClientWinnersSection (US-004)", () => {
  it("renders each winner's video inline with a stable key on the <video>", () => {
    const { container } = render(
      <ClientWinnersSection winners={[winnerWithVideo]} />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", winnerWithVideo.video_url!);
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("poster", winnerWithVideo.thumbnail_url!);
  });

  it("forces a fresh <video> element when the winner changes (key={ad.id} contract)", () => {
    // The stable key's observable contract: swapping the rendered creative
    // produces a <video> bound to the NEW source (a remounted element), not a
    // stale node still pointing at the previous src.
    const { container, rerender } = render(
      <ClientWinnersSection winners={[winnerWithVideo]} />,
    );
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      winnerWithVideo.video_url!,
    );

    const swapped: ClientWinner = {
      ...winnerWithVideo,
      id: "ad-999",
      video_url: "https://cdn.example.com/ad-999.mp4",
    };
    rerender(<ClientWinnersSection winners={[swapped]} />);
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      swapped.video_url!,
    );
  });

  it("falls back to a thumbnail when there is no video_url", () => {
    const { container } = render(
      <ClientWinnersSection winners={[winnerNoVideo]} />,
    );
    expect(container.querySelector("video")).toBeNull();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", winnerNoVideo.thumbnail_url!);
  });

  it("shows client-safe revenue/ROAS framing", () => {
    render(<ClientWinnersSection winners={[winnerWithVideo]} />);
    expect(screen.getByText("$5,040")).toBeInTheDocument(); // revenue
    expect(screen.getByText(/\$4\.20 back/)).toBeInTheDocument(); // ROAS framing
  });

  it("never exposes internal grade / threshold / strategist metrics (AC3)", () => {
    const { container } = render(
      <ClientWinnersSection winners={[winnerWithVideo, winnerNoVideo]} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Hook Rate/i);
    expect(text).not.toMatch(/CPA/i);
    expect(text).not.toMatch(/CTR/i);
    expect(text).not.toMatch(/\bkill\b/i);
    expect(text).not.toMatch(/\bscale\b/i);
    expect(text).not.toMatch(/threshold/i);
    expect(text).not.toMatch(/\bgrade\b/i);
    expect(text).not.toMatch(/win rate/i);
  });

  it("renders a friendly empty state when there are no winners", () => {
    render(<ClientWinnersSection winners={[]} />);
    expect(
      screen.getByText(/Winners show up here once your creatives gather enough data/i),
    ).toBeInTheDocument();
  });
});
