import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A change against the prior period. `positive` means "better", not "went up". */
export interface MetricChange {
  value: number;
  positive: boolean;
}

interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** Shown as a change line with an arrow. Leave out when there is no prior period. */
  trend?: MetricChange | null;
  /** Words after the percentage, for example "vs prior period". */
  trendLabel?: string;
  /** Lower is better (for example CPA): `positive` then means the number went down. */
  inverse?: boolean;
  icon?: ReactNode;
  badge?: ReactNode;
  className?: string;
}

/**
 * The one metric card: a 12px uppercase label, a 28px number and a change line with an arrow.
 * The change line is always neutral grey. Green and red are not used for change; the arrow
 * and the words carry the direction.
 */
export function MetricCard({ label, value, trend, trendLabel, inverse = false, icon, badge, className }: MetricCardProps) {
  // The arrow shows which way the number moved; `positive` says whether that is better.
  const wentUp = trend ? trend.positive !== inverse : false;
  const arrow = trend ? (trend.value === 0 ? "→" : wentUp ? "↑" : "↓") : null;
  return (
    <div data-testid="metric-card" className={cn("space-y-1.5 bg-card px-4 py-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-label text-[12px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{label}</span>
        {icon ? <span className="text-muted-foreground" aria-hidden="true">{icon}</span> : null}
      </div>
      <div className="font-data text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{value}</div>
      {trend ? (
        <p data-testid="metric-change" className="font-data text-[13px] tabular-nums text-muted-foreground">
          <span aria-hidden="true">{arrow}</span> {Math.abs(trend.value)}%{trendLabel ? ` ${trendLabel}` : ""}
          <span className="sr-only">{trend.positive ? " (better)" : " (worse)"}</span>
        </p>
      ) : null}
      {badge ? <div className="mt-1">{badge}</div> : null}
    </div>
  );
}

/** A row of metric cards separated by 1px lines. */
export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-testid="metric-grid"
      className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border-light bg-border-light sm:grid-cols-4", className)}
    >
      {children}
    </div>
  );
}
