import type { WoWTrend } from "@/hooks/useWoWTrends";
import { cn } from "@/lib/utils";

interface TrendSectionProps {
  trend?: WoWTrend;
}

export function TrendSection({ trend }: TrendSectionProps) {
  if (!trend || trend.direction === "insufficient") return null;

  const fmtRoas = (v: number) => `${v.toFixed(2)}x`;
  const pctStr = `${trend.pctChange > 0 ? "+" : ""}${trend.pctChange.toFixed(1)}%`;

  const labelColor = {
    up: "text-success",
    down: "text-destructive",
    flat: "text-muted-foreground",
  }[trend.direction];

  return (
    <div className="rounded-[6px] border border-border-light bg-card p-3">
      <p className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">
        Week-over-Week Trend
      </p>
      <div className="flex items-center gap-6">
        <div>
          <span className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">This Week</span>
          <p className="font-data text-[16px] font-semibold text-foreground">{fmtRoas(trend.thisWeekRoas)}</p>
        </div>
        <div className="text-muted-foreground font-data text-[15px]">vs</div>
        <div>
          <span className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Prior Week</span>
          <p className="font-data text-[16px] font-semibold text-foreground">{fmtRoas(trend.priorWeekRoas)}</p>
        </div>
        <div>
          <span className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Change</span>
          <p className={cn("font-data text-[16px] font-semibold", labelColor)}>{pctStr}</p>
        </div>
      </div>
      <p className={cn("font-body text-[12px] mt-1.5", labelColor)}>{trend.label}</p>
    </div>
  );
}
