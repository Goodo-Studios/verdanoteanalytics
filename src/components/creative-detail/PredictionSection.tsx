import { predictCreative, type CreativePrediction, type PredictionAction } from "@/lib/predictions";
import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { FatigueResult } from "@/lib/fatigueScore";
import { TrendingUp, Pause, RotateCcw, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

const ACTION_CONFIG: Record<PredictionAction, { icon: React.ElementType; color: string; bg: string }> = {
  scale: { icon: TrendingUp, color: "text-verdant", bg: "bg-sage-light/40" },
  hold: { icon: Eye, color: "text-gold", bg: "bg-gold-light/40" },
  iterate: { icon: RotateCcw, color: "text-amber-600", bg: "bg-amber-50" },
  pause: { icon: Pause, color: "text-destructive", bg: "bg-destructive/5" },
};

interface PredictionSectionProps {
  creative: any;
  wowTrend?: WoWTrend;
  fatigue?: FatigueResult;
  killThreshold?: number;
}

import { fmt$ } from "@/lib/formatters";

export function PredictionSection({ creative, wowTrend, fatigue, killThreshold = 1.0 }: PredictionSectionProps) {
  const prediction = predictCreative(creative, wowTrend, fatigue, killThreshold);
  const config = ACTION_CONFIG[prediction.action];
  const Icon = config.icon;

  return (
    <div className="space-y-3 px-1">
      <div className="flex items-center gap-2">
        <span className="font-label text-[11px] font-semibold uppercase tracking-wider text-charcoal">
          📈 Performance Prediction
        </span>
      </div>

      <p className="font-body text-[12px] text-muted-foreground">
        Based on current trajectory, this creative is projected to:
      </p>

      {/* Projected metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[6px] border border-border-light p-3">
          <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground mb-1">7-Day Spend</p>
          <p className="font-data text-[17px] font-semibold text-charcoal tabular-nums">
            {fmt$(prediction.projectedSpend7d)}
          </p>
        </div>
        <div className="rounded-[6px] border border-border-light p-3">
          <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Projected ROAS</p>
          <p className={cn(
            "font-data text-[17px] font-semibold tabular-nums",
            prediction.projectedRoas >= 2 ? "text-verdant" : prediction.projectedRoas < 1 ? "text-destructive" : "text-charcoal"
          )}>
            {prediction.projectedRoas.toFixed(2)}x
          </p>
        </div>
      </div>

      {/* Recommendation */}
      <div className={cn("rounded-[6px] p-3 flex items-start gap-3", config.bg)}>
        <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", config.color)} />
        <div>
          <p className={cn("font-body text-[13px] font-semibold", config.color)}>
            {prediction.shortLabel}
          </p>
          <p className="font-body text-[12px] text-foreground/80 mt-0.5 leading-relaxed">
            {prediction.recommendation}
          </p>
        </div>
      </div>
    </div>
  );
}
