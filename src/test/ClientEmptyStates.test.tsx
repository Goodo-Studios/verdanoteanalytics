/**
 * US-006 — Friendly onboarding / empty states for every Client Home section.
 *
 * A brand-new client (or the first days of a month) must be greeted with an
 * intentional, branded onboarding state in EVERY Home section instead of a wall
 * of zeros or a broken-looking page. These are first-class rendered components
 * (the shared `ClientEmptyState`), never `return null` / a hidden section.
 *
 * This suite verifies, per AC1–AC6, that each section renders its distinct,
 * intentional empty state with the warm client-language copy when its data is
 * absent — and that they all use the same shared, brand-consistent component.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sparkles } from "lucide-react";

import { ClientEmptyState } from "@/components/client/ClientEmptyState";
import { ClientOutcomesSection } from "@/components/client/ClientOutcomesSection";
import { ClientHighlightsSection } from "@/components/client/ClientHighlightsSection";
import { ContentPipelineView } from "@/components/client/ContentPipeline";
import type { PeriodMetrics } from "@/hooks/usePeriodMetrics";

// useCachedMedia touches IndexedDB; in jsdom we just echo the url back.
vi.mock("@/hooks/useCachedMedia", () => ({
  useCachedMedia: (url: string | null | undefined) => ({
    url: url ?? "/placeholder-creative.png",
    isLoading: false,
    error: null,
    retry: () => {},
  }),
}));

import { ClientWinnersSection } from "@/components/client/ClientWinnersSection";

const emptyMetrics: PeriodMetrics = {
  totalSpend: 0,
  totalImpressions: 0,
  totalClicks: 0,
  totalPurchases: 0,
  totalPurchaseValue: 0,
  totalAddsToCart: 0,
  totalVideoViews: 0,
  activeCount: 0,
  avgRoas: 0,
  avgCpa: 0,
  avgCtr: 0,
};

afterEach(() => cleanup());

describe("ClientEmptyState (US-006 shared component)", () => {
  it("is a real, rendered, brand-consistent component — icon + heading + subcopy", () => {
    const { container } = render(
      <ClientEmptyState
        icon={Sparkles}
        heading="Heading goes here"
        subcopy="Reassuring subcopy."
      />,
    );

    const root = screen.getByTestId("client-empty-state");
    expect(root).toBeInTheDocument();
    expect(screen.getByText("Heading goes here")).toBeInTheDocument();
    expect(screen.getByText("Reassuring subcopy.")).toBeInTheDocument();
    // Brand tokens / card surface — not a bare/hidden node.
    expect(root.className).toMatch(/bg-card/);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("Client Home onboarding states (US-006)", () => {
  it("Outcomes: no metrics yet shows 'Your first results will appear here' — not a wall of zeros (AC1)", () => {
    render(
      <ClientOutcomesSection
        metrics={emptyMetrics}
        periodLabel="May 2026"
        trend={[]}
        wowDirection="insufficient"
      />,
    );

    expect(screen.getByTestId("client-empty-state")).toBeInTheDocument();
    expect(
      screen.getByText(/Your first results will appear here/i),
    ).toBeInTheDocument();

    // It is the intentional onboarding state, NOT the zero-value outcome cards.
    expect(screen.queryByText("$0")).toBeNull();
    expect(screen.queryByText(/Return on ad spend/i)).toBeNull();
  });

  it("Outcomes: still renders the metric cards once there is real data (AC1 inverse)", () => {
    render(
      <ClientOutcomesSection
        metrics={{ ...emptyMetrics, totalSpend: 100, totalPurchaseValue: 380, totalPurchases: 4 }}
        periodLabel="May 2026"
        trend={[]}
        wowDirection="insufficient"
      />,
    );
    expect(screen.queryByTestId("client-empty-state")).toBeNull();
    expect(screen.getByText(/Return on ad spend/i)).toBeInTheDocument();
  });

  it("Winners: no qualifying winners shows the warm data-gathering onboarding copy (AC2)", () => {
    render(<ClientWinnersSection winners={[]} />);
    expect(screen.getByTestId("client-empty-state")).toBeInTheDocument();
    expect(
      screen.getByText(/Winners show up here once your creatives gather enough data/i),
    ).toBeInTheDocument();
  });

  it("Highlights: no published narrative shows 'Your strategist is preparing your first highlights' (AC3)", () => {
    render(
      <ClientHighlightsSection publishedText={null} periodLabel="May 2026" />,
    );
    expect(screen.getByTestId("client-empty-state")).toBeInTheDocument();
    expect(
      screen.getByText(/Your strategist is preparing your first highlights/i),
    ).toBeInTheDocument();
  });

  it("Pipeline: nothing in flight shows 'Nothing in production right now — your strategist will queue the next round' (AC4)", () => {
    render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("client-empty-state")).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing in production right now — your strategist will queue the next round/i),
    ).toBeInTheDocument();
  });
});
