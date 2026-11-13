import { cn } from "@/lib/utils";
import type { WoWTrend } from "@/hooks/useWoWTrends";

interface RoasTrendArrowProps {
  trend?: WoWTrend;
  className?: string;
}

export function RoasTrendArrow({ trend, className }: RoasTrendArrowProps) {
  if (!trend || trend.direction === "insufficient") return null;

  // Change is shown in neutral grey; the arrow carries the direction (no green or red).
  const config = {
    up: { char: "↑", color: "text-muted-foreground" },
    down: { char: "↓", color: "text-muted-foreground" },
    flat: { char: "→", color: "text-muted-foreground" },
  }[trend.direction];

  return (
    <span
      className={cn("inline-block font-data font-medium leading-none", config.color, className)}
      style={{ fontSize: "10px" }}
      title={`${trend.pctChange > 0 ? "+" : ""}${trend.pctChange.toFixed(0)}% WoW`}
    >
      {config.char}
    </span>
  );
}
