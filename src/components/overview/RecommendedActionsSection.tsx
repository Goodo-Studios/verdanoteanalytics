import { useMemo } from "react";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { computePredictionCounts, type PredictionAction } from "@/lib/predictions";
import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { FatigueResult } from "@/lib/fatigueScore";
import { TrendingUp, Pause, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const ACTIONS: { key: PredictionAction; label: string; verb: string; icon: React.ElementType; color: string; bg: string; hoverBg: string }[] = [
  { key: "scale", label: "ready to scale", verb: "Scale", icon: TrendingUp, color: "text-verdant", bg: "bg-sage-light/40", hoverBg: "hover:bg-sage-light/60" },
  { key: "pause", label: "to consider pausing", verb: "Pause", icon: Pause, color: "text-destructive", bg: "bg-destructive/5", hoverBg: "hover:bg-destructive/10" },
  { key: "iterate", label: "need fresh versions", verb: "Iterate", icon: RotateCcw, color: "text-amber-600", bg: "bg-amber-50", hoverBg: "hover:bg-amber-100/60" },
];

interface RecommendedActionsProps {
  creatives: any[];
  wowTrends?: Map<string, WoWTrend>;
  fatigueMap?: Map<string, FatigueResult>;
  killThreshold?: number;
}

export function RecommendedActionsSection({ creatives, wowTrends, fatigueMap, killThreshold = 1.0 }: RecommendedActionsProps) {
  const navigate = useRoleNavigate();

  const counts = useMemo(
    () => computePredictionCounts(creatives, wowTrends, fatigueMap, killThreshold),
    [creatives, wowTrends, fatigueMap, killThreshold]
  );

  const handleClick = (action: PredictionAction) => {
    // Navigate to creatives with a momentum-based filter
    const filterMap: Record<PredictionAction, string> = {
      scale: "momentum=Gaining",
      hold: "momentum=Steady",
      iterate: "momentum=Fading",
      pause: "momentum=Losing",
    };
    navigate(`/creatives?${filterMap[action]}`);
  };

  return (
    <div className="bg-card border border-border-light rounded-[8px] p-5">
      <h2 className="font-heading text-[18px] text-foreground mb-4">Recommended Actions</h2>
      <div className="flex flex-wrap gap-3">
        {ACTIONS.map(({ key, label, verb, icon: Icon, color, bg, hoverBg }) => {
          const count = counts[key].length;
          return (
            <button
              key={key}
              onClick={() => handleClick(key)}
              className={cn(
                "flex items-center gap-2.5 px-4 py-3 rounded-[8px] border border-border-light transition-colors cursor-pointer text-left",
                bg, hoverBg
              )}
            >
              <Icon className={cn("h-4.5 w-4.5 flex-shrink-0", color)} />
              <div>
                <span className={cn("font-data text-[20px] font-semibold tabular-nums", color)}>{count}</span>
                <p className="font-body text-[12px] text-muted-foreground leading-tight">
                  {verb}: {count} creative{count !== 1 ? "s" : ""} {label}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
