import { useMemo } from "react";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpendPacingWidgetProps {
  account: any;
  /** Month-to-date spend (from current month's creatives) */
  mtdSpend: number;
}

import { fmt$ } from "@/lib/formatters";

export function SpendPacingWidget({ account, mtdSpend }: SpendPacingWidgetProps) {
  const navigate = useRoleNavigate();
  const target = Number(account?.target_monthly_spend) || 0;

  const pacing = useMemo(() => {
    if (target <= 0) return null;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysElapsed = Math.max(dayOfMonth, 1);

    const dailyAvg = daysElapsed > 0 ? mtdSpend / daysElapsed : 0;
    const projectedSpend = dailyAvg * daysInMonth;
    const pacingPct = target > 0 ? (projectedSpend / target) * 100 : 0;
    const fillPct = target > 0 ? Math.min((mtdSpend / target) * 100, 100) : 0;
    const gap = projectedSpend - target;

    let status: "green" | "amber" | "red";
    let statusLabel: string;

    if (pacingPct >= 90 && pacingPct <= 110) {
      status = "green";
      statusLabel = "On track";
    } else if ((pacingPct >= 70 && pacingPct < 90) || (pacingPct > 110 && pacingPct <= 130)) {
      status = "amber";
      statusLabel = "Slightly off pace";
    } else {
      status = "red";
      statusLabel = pacingPct < 70 ? "Significantly under pace" : "Significantly over pace";
    }

    return {
      dayOfMonth,
      daysInMonth,
      daysElapsed,
      dailyAvg,
      projectedSpend,
      pacingPct,
      fillPct,
      gap,
      status,
      statusLabel,
    };
  }, [target, mtdSpend]);

  // No target set — show prompt
  if (target <= 0) {
    return (
      <button
        onClick={() => navigate("/settings")}
        className="glass-panel px-5 py-3 flex items-center justify-between w-full hover:shadow-[var(--shadow-hover)] transition-[box-shadow] duration-150 group"
      >
        <span className="font-body text-[13px] text-muted-foreground">
          Set a monthly spend target to track pacing
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
      </button>
    );
  }

  if (!pacing) return null;

  const barColor =
    pacing.status === "green"
      ? "bg-primary"
      : pacing.status === "amber"
      ? "bg-warning"
      : "bg-destructive";

  const statusColor =
    pacing.status === "green"
      ? "text-primary"
      : pacing.status === "amber"
      ? "text-warning"
      : "text-destructive";

  const gapAbs = Math.abs(pacing.gap);
  const gapDirection = pacing.gap >= 0 ? "above" : "below";

  return (
    <div className="glass-panel px-5 py-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            Spend Pacing
          </span>
          <span className={cn("font-label text-[10px] font-semibold uppercase tracking-wide", statusColor)}>
            {pacing.statusLabel}
          </span>
        </div>
        <span className="font-data text-[12px] text-muted-foreground tabular-nums">
          Day {pacing.dayOfMonth} of {pacing.daysInMonth}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor)}
            style={{ width: `${pacing.fillPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="font-data text-[17px] font-semibold text-foreground tabular-nums">
            {fmt$(mtdSpend)}
          </span>
          <span className="font-data text-[17px] text-muted-foreground tabular-nums">
            {fmt$(target)} target
          </span>
        </div>
      </div>

      {/* Projection */}
      <p className="font-body text-[12px] text-muted-foreground leading-relaxed">
        At current daily spend of {fmt$(pacing.dailyAvg)}, you'll end the month at{" "}
        <span className="font-data font-semibold text-foreground">{fmt$(pacing.projectedSpend)}</span>
        {" — "}
        <span className={cn("font-data font-semibold", statusColor)}>
          {fmt$(gapAbs)} {gapDirection} target
        </span>
        .
      </p>
    </div>
  );
}

/**
 * Compact pacing status for use in tables (BenchmarksTab).
 * Returns a colored badge-like string.
 */
export function getPacingStatus(account: any, mtdSpend: number) {
  const target = Number(account?.target_monthly_spend) || 0;
  if (target <= 0) return null;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysElapsed = Math.max(dayOfMonth, 1);

  const dailyAvg = daysElapsed > 0 ? mtdSpend / daysElapsed : 0;
  const projectedSpend = dailyAvg * daysInMonth;
  const pacingPct = target > 0 ? (projectedSpend / target) * 100 : 0;

  let status: "green" | "amber" | "red";
  let label: string;

  if (pacingPct >= 90 && pacingPct <= 110) {
    status = "green";
    label = "On track";
  } else if ((pacingPct >= 70 && pacingPct < 90) || (pacingPct > 110 && pacingPct <= 130)) {
    status = "amber";
    label = `${Math.round(pacingPct)}%`;
  } else {
    status = "red";
    label = `${Math.round(pacingPct)}%`;
  }

  return { status, label, pacingPct };
}
