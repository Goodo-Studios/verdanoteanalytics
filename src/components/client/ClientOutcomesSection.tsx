import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { MultiLineTrendChart, type TrendLine } from "@/components/MultiLineTrendChart";
import type { PeriodMetrics } from "@/hooks/usePeriodMetrics";
import type { DailyTrendPoint } from "@/hooks/useDailyTrends";
import { cn } from "@/lib/utils";

/**
 * Client-facing direction for "is my money working?" framing.
 * Deliberately plain-language: no percentages-as-jargon, no kill/scale verbs.
 */
export type OutcomeDirection = "up" | "down" | "flat" | "insufficient";

export interface ClientOutcomesSectionProps {
  /** Aggregated metrics for the current calendar month (from get_period_metrics). */
  metrics: PeriodMetrics;
  /** Human label for the fixed period, e.g. "May 2026". */
  periodLabel: string;
  /** Daily MTD progression for the trend visual. */
  trend?: DailyTrendPoint[];
  /** Simple WoW direction vs last week, account-level. */
  wowDirection?: OutcomeDirection;
  /** Magnitude of the WoW change as a fraction (e.g. 0.12 = 12%); optional. */
  wowPctChange?: number;
  isLoading?: boolean;
}

/** Plain-language dollar format — no k/M abbreviation so clients read the real number. */
function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** ROAS framed as "for every $1 you get $X back". */
function roasBack(metrics: PeriodMetrics): string {
  const roas = metrics.totalSpend > 0 ? metrics.totalPurchaseValue / metrics.totalSpend : 0;
  return roas.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function OutcomeCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="bg-card border border-border-light rounded-[8px] p-5">
      <p className="font-label text-[10px] uppercase tracking-[0.06em] text-sage font-medium">
        {label}
      </p>
      <p className="font-data text-[28px] font-semibold tabular-nums text-charcoal mt-1.5">
        {value}
      </p>
      {caption && <p className="font-body text-[13px] text-slate mt-1">{caption}</p>}
    </div>
  );
}

function DirectionPill({
  direction,
  pctChange,
}: {
  direction: OutcomeDirection;
  pctChange?: number;
}) {
  const pct =
    pctChange != null && Number.isFinite(pctChange)
      ? `${Math.round(Math.abs(pctChange) * 100)}%`
      : null;

  if (direction === "insufficient") {
    return (
      <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-slate">
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        Not enough data yet to compare to last week
      </span>
    );
  }

  if (direction === "up") {
    return (
      <span className="inline-flex items-center gap-1.5 font-body text-[13px] font-medium text-verdant">
        <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
        Up{pct ? ` ${pct}` : ""} vs last week
      </span>
    );
  }

  if (direction === "down") {
    return (
      <span className="inline-flex items-center gap-1.5 font-body text-[13px] font-medium text-destructive">
        <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
        Down{pct ? ` ${pct}` : ""} vs last week
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-slate">
      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      About the same as last week
    </span>
  );
}

/**
 * ClientOutcomesSection — the "is my money working?" headline for brand-owner clients.
 *
 * Deliberately client-safe: only spend, revenue, ROAS-as-plain-language, and
 * purchases. NO CPA / CTR / Hook Rate / frequency / kill-scale figures ever
 * appear here (US-003 acceptance criterion 3). Period is fixed to the current
 * calendar month — no date picker.
 *
 * Note on rates (AC5 / policy goodo-verdanote-video-metrics-coverage-vs-fill-rate):
 * the only rate-like value shown is ROAS, whose denominator is total spend for
 * the period — not a coverage/fill-rate denominator. This section does not
 * surface any video coverage/fill-rate metric, so the policy's denominator
 * distinction does not introduce an ambiguous rate here.
 */
export function ClientOutcomesSection({
  metrics,
  periodLabel,
  trend,
  wowDirection = "insufficient",
  wowPctChange,
  isLoading,
}: ClientOutcomesSectionProps) {
  const lines = useMemo<TrendLine[]>(() => {
    if (!trend || trend.length === 0) return [];
    // Cumulative MTD spend + cumulative revenue, plain-language framing.
    let cumSpend = 0;
    let cumRevenue = 0;
    const spendVals: number[] = [];
    const revenueVals: number[] = [];
    for (const p of trend) {
      cumSpend += p.spend;
      cumRevenue += p.purchase_value;
      spendVals.push(cumSpend);
      revenueVals.push(cumRevenue);
    }
    return [
      {
        key: "revenue",
        label: "Revenue this month",
        color: "hsl(152 45% 38%)",
        prefix: "$",
        decimals: 0,
        values: revenueVals,
      },
      {
        key: "spend",
        label: "Spend this month",
        color: "hsl(28 65% 55%)",
        prefix: "$",
        decimals: 0,
        values: spendVals,
      },
    ];
  }, [trend]);

  const dates = useMemo(() => (trend ? trend.map((p) => p.date) : []), [trend]);

  return (
    <div className="space-y-5" data-testid="client-outcomes">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-heading text-[20px] text-forest">Is your money working?</h2>
          <p className="font-body text-[13px] text-slate font-light mt-0.5">
            Your results for {periodLabel}
          </p>
        </div>
        <span
          className="font-label text-[11px] uppercase tracking-[0.06em] text-sage font-medium"
          data-testid="client-outcomes-period"
        >
          {periodLabel}
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-card border border-border-light rounded-[8px] p-5 h-[110px] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <OutcomeCard
            label="Revenue"
            value={money(metrics.totalPurchaseValue)}
            caption="Sales driven by your ads"
          />
          <OutcomeCard
            label="Spend"
            value={money(metrics.totalSpend)}
            caption="What you invested in ads"
          />
          <OutcomeCard
            label="Return on ad spend"
            value={`${roasBack(metrics)} back`}
            caption="For every $1 you spent"
          />
          <OutcomeCard
            label="Purchases"
            value={metrics.totalPurchases.toLocaleString("en-US")}
            caption="Orders from your ads"
          />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading text-[16px] text-forest">How it&rsquo;s trending</h3>
          <DirectionPill direction={wowDirection} pctChange={wowPctChange} />
        </div>
        {dates.length > 0 ? (
          <MultiLineTrendChart dates={dates} lines={lines} />
        ) : (
          <div
            className={cn(
              "bg-card border border-border-light rounded-[8px] p-8 text-center",
            )}
          >
            <p className="font-body text-[13px] text-slate">
              We&rsquo;ll show your month&rsquo;s trend here once there&rsquo;s daily data to chart.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClientOutcomesSection;
