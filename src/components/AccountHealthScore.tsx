import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { computeFatigueMap } from "@/lib/fatigueScore";

interface HealthScoreProps {
  creatives: any[];
  metrics: { winRate: number; avgRoas: number };
  targetRoas?: number | null;
  scaleThreshold: number;
  wowTrends?: Map<string, any>;
}

interface ScoreBreakdown {
  winRate: number;
  roasVsTarget: number;
  diversity: number;
  fatigue: number;
  momentum: number;
  total: number;
}

function computeHealthScore(
  creatives: any[],
  metrics: { winRate: number; avgRoas: number },
  targetRoas: number | null | undefined,
  scaleThreshold: number,
  wowTrends?: Map<string, any>
): ScoreBreakdown {
  const active = creatives.filter((c: any) => (Number(c.spend) || 0) > 0);
  if (active.length === 0) return { winRate: 0, roasVsTarget: 0, diversity: 0, fatigue: 0, momentum: 0, total: 0 };

  // 1. Win rate → 0-30 points
  const winRateScore = Math.min(30, (metrics.winRate / 100) * 30 * 2); // 50% win rate = 30 pts

  // 2. ROAS vs target → 0-20 points
  let roasVsTarget = 10; // default if no target
  if (targetRoas && targetRoas > 0) {
    const ratio = metrics.avgRoas / targetRoas;
    roasVsTarget = Math.min(20, Math.max(0, ratio * 20));
  } else {
    // No target set, give partial credit based on absolute ROAS
    roasVsTarget = Math.min(20, Math.max(0, metrics.avgRoas * 5));
  }

  // 3. Creative diversity → 0-15 points
  // Count distinct formats and hooks among top performers (above scale threshold)
  const topPerformers = active.filter((c: any) => (Number(c.roas) || 0) >= scaleThreshold);
  const formats = new Set(topPerformers.map((c: any) => c.ad_type).filter(Boolean));
  const hooks = new Set(topPerformers.map((c: any) => c.hook).filter(Boolean));
  const distinctCount = formats.size + hooks.size;
  const diversityScore = Math.min(15, distinctCount * 2.5);

  // 4. Fatigue level → 0-20 points (inverse — lower fatigue = more points)
  const fatigueMap = computeFatigueMap(active, wowTrends);
  let highFatigueCount = 0;
  for (const [, f] of fatigueMap) {
    if (f.level === "high") highFatigueCount++;
  }
  const fatiguePct = active.length > 0 ? highFatigueCount / active.length : 0;
  const fatigueScore = Math.max(0, 20 * (1 - fatiguePct * 2)); // 50%+ fatigued = 0 pts

  // 5. Momentum → 0-15 points
  let momentumScore = 7.5; // default if no trends
  if (wowTrends && wowTrends.size > 0) {
    // Top 10 by spend
    const top10 = [...active].sort((a: any, b: any) => (Number(b.spend) || 0) - (Number(a.spend) || 0)).slice(0, 10);
    let positiveCount = 0;
    for (const c of top10) {
      const trend = wowTrends.get(c.ad_id);
      if (trend && trend.direction === "up") positiveCount++;
    }
    const positivePct = top10.length > 0 ? positiveCount / top10.length : 0;
    momentumScore = Math.min(15, positivePct * 15 * 2); // 50% positive = 15 pts
  }

  const total = Math.round(Math.min(100, winRateScore + roasVsTarget + diversityScore + fatigueScore + momentumScore));

  return {
    winRate: Math.round(winRateScore),
    roasVsTarget: Math.round(roasVsTarget),
    diversity: Math.round(diversityScore),
    fatigue: Math.round(fatigueScore),
    momentum: Math.round(momentumScore),
    total,
  };
}

function getGrade(score: number): { label: string; color: string; arcColor: string; emoji: string } {
  if (score >= 80) return { label: "Excellent", color: "text-verdant", arcColor: "stroke-verdant", emoji: "🟢" };
  if (score >= 60) return { label: "Good", color: "text-gold", arcColor: "stroke-gold", emoji: "🟡" };
  if (score >= 40) return { label: "Needs Attention", color: "text-orange-500", arcColor: "stroke-orange-500", emoji: "🟠" };
  return { label: "Critical", color: "text-red-600", arcColor: "stroke-red-600", emoji: "🔴" };
}

export function AccountHealthScore({ creatives, metrics, targetRoas, scaleThreshold, wowTrends }: HealthScoreProps) {
  const breakdown = useMemo(
    () => computeHealthScore(creatives, metrics, targetRoas, scaleThreshold, wowTrends),
    [creatives, metrics, targetRoas, scaleThreshold, wowTrends]
  );

  const grade = getGrade(breakdown.total);

  // SVG arc params
  const size = 80;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (breakdown.total / 100) * circumference;
  const dashOffset = circumference - progress;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col items-center gap-1 cursor-default">
          <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
              {/* Background track */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                className="stroke-muted"
                strokeWidth={strokeWidth}
              />
              {/* Progress arc */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                className={grade.arcColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: "stroke-dashoffset 0.6s ease" }}
              />
            </svg>
            {/* Score number */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`font-data text-[22px] font-bold tabular-nums ${grade.color}`}>
                {breakdown.total}
              </span>
            </div>
          </div>
          <span className={`font-label text-[10px] font-semibold uppercase tracking-wider ${grade.color}`}>
            {grade.label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[220px] space-y-1.5 p-3">
        <p className="font-body text-[12px] font-semibold text-foreground">Health Score Breakdown</p>
        <BreakdownRow label="Win Rate" score={breakdown.winRate} max={30} />
        <BreakdownRow label="ROAS vs Target" score={breakdown.roasVsTarget} max={20} />
        <BreakdownRow label="Creative Diversity" score={breakdown.diversity} max={15} />
        <BreakdownRow label="Fatigue Level" score={breakdown.fatigue} max={20} />
        <BreakdownRow label="Momentum" score={breakdown.momentum} max={15} />
        <div className="border-t border-border-light pt-1 mt-1">
          <div className="flex items-center justify-between">
            <span className="font-body text-[11px] font-semibold text-foreground">Total</span>
            <span className={`font-data text-[12px] font-bold tabular-nums ${grade.color}`}>{breakdown.total}/100</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function BreakdownRow({ label, score, max }: { label: string; score: number; max: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-body text-[11px] text-muted-foreground">{label}</span>
      <span className="font-data text-[11px] font-medium tabular-nums text-foreground">{score}/{max}</span>
    </div>
  );
}
