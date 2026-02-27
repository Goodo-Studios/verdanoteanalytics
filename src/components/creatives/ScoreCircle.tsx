import { cn } from "@/lib/utils";

interface ScoreCircleProps {
  score: number;
  tier: "green" | "amber" | "red";
  size?: "sm" | "md";
  className?: string;
}

const tierColors = {
  green: "bg-success text-success-foreground",
  amber: "bg-amber-500 text-white",
  red: "bg-destructive text-destructive-foreground",
};

export function ScoreCircle({ score, tier, size = "sm", className }: ScoreCircleProps) {
  const sizeClasses = size === "sm"
    ? "h-7 w-7 text-[11px]"
    : "h-9 w-9 text-[14px]";

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-data font-bold tabular-nums shadow-sm",
        tierColors[tier],
        sizeClasses,
        className,
      )}
      title={`Creative Score: ${score}/100`}
    >
      {score}
    </div>
  );
}
