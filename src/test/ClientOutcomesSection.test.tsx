/**
 * US-003 — Client headline outcomes + monthly trend.
 *
 * Verifies the "is my money working?" section renders client-language outcome
 * framing for a fixed calendar month and, critically, that NO internal
 * strategist metrics (CPA / CTR / Hook Rate / frequency / kill-scale) leak into
 * the client surface.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ClientOutcomesSection } from "@/components/client/ClientOutcomesSection";
import type { PeriodMetrics } from "@/hooks/usePeriodMetrics";
import type { DailyTrendPoint } from "@/hooks/useDailyTrends";

const mockMetrics: PeriodMetrics = {
  totalSpend: 10_000,
  totalImpressions: 500_000,
  totalClicks: 12_000,
  totalPurchases: 320,
  totalPurchaseValue: 38_000,
  totalAddsToCart: 900,
  totalVideoViews: 200_000,
  activeCount: 14,
  avgRoas: 3.8,
  avgCpa: 31.25,
  avgCtr: 2.4,
};

const mockTrend: DailyTrendPoint[] = [
  {
    date: "2026-05-01",
    spend: 1000,
    impressions: 50_000,
    clicks: 1200,
    purchases: 30,
    purchase_value: 3800,
    adds_to_cart: 90,
    video_views: 20_000,
    frequency: 1.2,
    activeAdCount: 10,
    ctr: 2.4,
    cpm: 20,
    cpc: 0.83,
    cpa: 33.3,
    roas: 3.8,
    cost_per_atc: 11.1,
  },
  {
    date: "2026-05-02",
    spend: 1100,
    impressions: 52_000,
    clicks: 1300,
    purchases: 34,
    purchase_value: 4200,
    adds_to_cart: 95,
    video_views: 21_000,
    frequency: 1.3,
    activeAdCount: 11,
    ctr: 2.5,
    cpm: 21,
    cpc: 0.85,
    cpa: 32.4,
    roas: 3.8,
    cost_per_atc: 11.6,
  },
];

describe("ClientOutcomesSection (US-003)", () => {
  it("renders headline outcomes in client language for the fixed period", () => {
    render(
      <ClientOutcomesSection
        metrics={mockMetrics}
        periodLabel="May 2026"
        trend={mockTrend}
        wowDirection="up"
        wowPctChange={0.12}
      />,
    );

    // Period label shown, no date picker (AC4)
    expect(screen.getAllByText("May 2026").length).toBeGreaterThan(0);

    // Outcome cards — revenue, spend, purchases (AC1)
    expect(screen.getByText("$38,000")).toBeInTheDocument(); // revenue
    expect(screen.getByText("$10,000")).toBeInTheDocument(); // spend
    expect(screen.getByText("320")).toBeInTheDocument(); // purchases

    // ROAS framed as "for every $1 you get $X back" (AC1)
    expect(screen.getByText(/\$3\.80 back/)).toBeInTheDocument();
    expect(screen.getByText(/For every \$1 you spent/i)).toBeInTheDocument();

    // WoW direction framed up/down vs last week (AC2)
    expect(screen.getByText(/up.*vs last week/i)).toBeInTheDocument();
  });

  it("never exposes internal strategist metrics (AC3)", () => {
    const { container } = render(
      <ClientOutcomesSection
        metrics={mockMetrics}
        periodLabel="May 2026"
        trend={mockTrend}
        wowDirection="up"
        wowPctChange={0.12}
      />,
    );

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/CPA/i);
    expect(text).not.toMatch(/CTR/i);
    expect(text).not.toMatch(/Hook Rate/i);
    expect(text).not.toMatch(/frequency/i);
    expect(text).not.toMatch(/\bkill\b/i);
    expect(text).not.toMatch(/\bscale\b/i);
  });

  it("shows a friendly empty trend state when there is no daily data", () => {
    render(
      <ClientOutcomesSection
        metrics={mockMetrics}
        periodLabel="May 2026"
        trend={[]}
        wowDirection="insufficient"
      />,
    );

    expect(
      screen.getByText(/once there.s daily data to chart/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Not enough data yet to compare to last week/i),
    ).toBeInTheDocument();
  });
});
