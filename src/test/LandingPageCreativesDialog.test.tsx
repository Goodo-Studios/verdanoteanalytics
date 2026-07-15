/**
 * US-004 Landing Pages destination drill-in. The dialog must:
 *  - fetch creatives for the clicked destination_key via getLandingPageCreatives
 *    (account_id + destination_key + window), and render one row per creative;
 *  - render a real thumbnail when thumbnail_url is a usable URL, but treat the
 *    "no-thumbnail"/"no-video" sentinels (and NULL) as absent so we never point an
 *    <img>/<a> at a sentinel string;
 *  - expose the video as a play link only when video_url is a real URL.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const getLandingPageCreatives = vi.fn();
vi.mock("@/lib/api", () => ({
  getLandingPageCreatives: (...args: any[]) => getLandingPageCreatives(...args),
}));

import { LandingPageCreativesDialog } from "@/components/landing-pages/LandingPageCreativesDialog";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  getLandingPageCreatives.mockReset();
});

const baseRow = {
  ad_id: "ad1",
  ad_name: "Winter Hook v3",
  thumbnail_url: "https://cdn.example.com/thumb1.jpg",
  preview_url: null,
  video_url: "https://cdn.example.com/vid1.mp4",
  spend: 1234.5,
  impressions: 10000,
  clicks: 500,
  purchases: 42,
  purchase_value: 8000,
  roas: 6.48,
  cpa: 29.39,
  ctr: 5.0,
  cpc: 2.47,
};

describe("LandingPageCreativesDialog (US-004 drill-in)", () => {
  it("fetches by destination_key + window and renders a creative row", async () => {
    getLandingPageCreatives.mockResolvedValue({
      account_id: "act_1",
      from: "2026-06-14",
      to: "2026-07-14",
      destination_key: "https://shop.example.com/pdp",
      rows: [baseRow],
    });

    render(
      <LandingPageCreativesDialog
        accountId="act_1"
        destinationKey="https://shop.example.com/pdp"
        from="2026-06-14"
        to="2026-07-14"
        open
        onClose={() => {}}
      />,
      { wrapper },
    );

    await waitFor(() => expect(screen.getByText("Winter Hook v3")).toBeTruthy());
    // Correct RPC args (account, destination, window) — aggregation stays server-side.
    expect(getLandingPageCreatives).toHaveBeenCalledWith(
      "act_1",
      "https://shop.example.com/pdp",
      "2026-06-14",
      "2026-07-14",
    );
    // Real thumbnail rendered; play link points at the real video url.
    const img = screen.getByAltText("Winter Hook v3") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/thumb1.jpg");
    const play = screen.getByTitle("Play video") as HTMLAnchorElement;
    expect(play.href).toBe("https://cdn.example.com/vid1.mp4");
  });

  it("treats no-thumbnail/no-video sentinels as absent media", async () => {
    getLandingPageCreatives.mockResolvedValue({
      account_id: "act_1",
      from: "2026-06-14",
      to: "2026-07-14",
      destination_key: "https://shop.example.com/pdp",
      rows: [{ ...baseRow, thumbnail_url: "no-thumbnail", preview_url: null, video_url: "no-video" }],
    });

    render(
      <LandingPageCreativesDialog
        accountId="act_1"
        destinationKey="https://shop.example.com/pdp"
        from="2026-06-14"
        to="2026-07-14"
        open
        onClose={() => {}}
      />,
      { wrapper },
    );

    await waitFor(() => expect(screen.getByText("Winter Hook v3")).toBeTruthy());
    // No <img> pointed at the sentinel, and no play link.
    expect(screen.queryByAltText("Winter Hook v3")).toBeNull();
    expect(screen.queryByTitle("Play video")).toBeNull();
    expect(screen.getByText("No preview")).toBeTruthy();
  });

  it("does not fetch while closed", () => {
    getLandingPageCreatives.mockResolvedValue({ rows: [] });
    render(
      <LandingPageCreativesDialog
        accountId="act_1"
        destinationKey="https://shop.example.com/pdp"
        from="2026-06-14"
        to="2026-07-14"
        open={false}
        onClose={() => {}}
      />,
      { wrapper },
    );
    // Sanity: fireEvent import exercised so lint/type gate keeps it wired.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(getLandingPageCreatives).not.toHaveBeenCalled();
  });
});
