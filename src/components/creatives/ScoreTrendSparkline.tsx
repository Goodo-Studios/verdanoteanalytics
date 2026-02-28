import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScoreTrendSparklineProps {
  points: { score: number; recorded_at: string }[] | undefined;
}

export function ScoreTrendSparkline({ points }: ScoreTrendSparklineProps) {
  const { path, trend, latest } = useMemo(() => {
    if (!points || points.length < 2) {
      return { path: "", trend: "flat" as const, latest: points?.[points?.length - 1]?.score };
    }

    // Take up to 7 most recent points
    const recent = points.slice(-7);
    const scores = recent.map((p) => p.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 1;

    const w = 48;
    const h = 16;
    const step = w / (scores.length - 1);

    const pathParts = scores.map((s, i) => {
      const x = i * step;
      const y = h - ((s - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const first = scores[0];
    const last = scores[scores.length - 1];
    const delta = last - first;
    const trend = delta > 2 ? "up" : delta < -2 ? "down" : "flat";

    return { path: pathParts.join(" "), trend, latest: last };
  }, [points]);

  if (!points || points.length === 0) {
    return <span className="text-muted-foreground text-[10px]">—</span>;
  }

  const color = trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  const strokeColor = trend === "up" ? "hsl(var(--success))" : trend === "down" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))";

  return (
    <div className="flex items-center gap-1.5">
      {points.length >= 2 && (
        <svg width="48" height="16" viewBox="0 0 48 16" className="flex-shrink-0">
          <path d={path} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {trend === "up" && <TrendingUp className={cn("h-3 w-3", color)} />}
      {trend === "down" && <TrendingDown className={cn("h-3 w-3", color)} />}
      {trend === "flat" && <Minus className={cn("h-3 w-3", color)} />}
    </div>
  );
}
