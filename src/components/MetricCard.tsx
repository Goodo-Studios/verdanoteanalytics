import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: { value: number; positive: boolean };
  badge?: ReactNode;
  className?: string;
  index?: number;
}

export function MetricCard({ label, value, icon, trend, badge, className }: MetricCardProps) {
  return (
    <div className={cn("py-3 px-4 space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-[0.05em] text-sage font-medium">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="flex items-end gap-2">
        <span className="font-data text-[28px] font-semibold text-charcoal tracking-tight leading-none">{value}</span>
        {trend && (
          <span
            className={cn(
              "font-data text-[15px] font-medium mb-0.5",
              trend.positive ? "text-verdant" : "text-red-700"
            )}
          >
            {trend.positive ? "↑" : "↓"} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      {badge && <div className="mt-1">{badge}</div>}
    </div>
  );
}
