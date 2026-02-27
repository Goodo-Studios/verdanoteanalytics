import { cn } from "@/lib/utils";

interface Goal {
  label: string;
  current: number;
  target: number;
  format: (v: number) => string;
  inverse?: boolean; // true for CPA where lower is better
}

interface GoalsBarProps {
  account: any;
  metrics: { avgRoas: number; avgCpa: number; totalSpend: number };
}

export function GoalsBar({ account, metrics }: GoalsBarProps) {
  const goals: Goal[] = [];

  if (account?.target_roas != null && Number(account.target_roas) > 0) {
    goals.push({
      label: "ROAS Goal",
      current: metrics.avgRoas,
      target: Number(account.target_roas),
      format: (v) => `${v.toFixed(2)}x`,
    });
  }

  if (account?.target_cpa != null && Number(account.target_cpa) > 0) {
    goals.push({
      label: "CPA Goal",
      current: metrics.avgCpa,
      target: Number(account.target_cpa),
      format: (v) => `$${v.toFixed(0)}`,
      inverse: true,
    });
  }

  if (account?.target_monthly_spend != null && Number(account.target_monthly_spend) > 0) {
    goals.push({
      label: "Monthly Spend Goal",
      current: metrics.totalSpend,
      target: Number(account.target_monthly_spend),
      format: (v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`,
    });
  }

  if (goals.length === 0) return null;

  return (
    <div className={cn("grid gap-4", goals.length === 1 ? "grid-cols-1" : goals.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
      {goals.map((goal) => (
        <GoalProgressBar key={goal.label} goal={goal} />
      ))}
    </div>
  );
}

function GoalProgressBar({ goal }: { goal: Goal }) {
  const { label, current, target, format, inverse } = goal;

  // Calculate progress
  let progress: number;
  let status: "green" | "amber" | "red";

  if (inverse) {
    // CPA: lower is better
    progress = current > 0 ? Math.min((target / current) * 100, 100) : 0;
    if (current <= target) {
      status = "green";
    } else if (current <= target * 1.2) {
      status = "amber";
    } else {
      status = "red";
    }
  } else {
    progress = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    if (current >= target) {
      status = "green";
    } else if (current >= target * 0.8) {
      status = "amber";
    } else {
      status = "red";
    }
  }

  const barColor = status === "green" ? "bg-verdant" : status === "amber" ? "bg-gold" : "bg-red-500";

  return (
    <div className="bg-white border border-border-light rounded-[8px] px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-label text-[10px] uppercase tracking-wide text-sage font-medium">
          {label}: {format(target)}
        </span>
        <span className={cn("font-data text-[14px] font-semibold tabular-nums", 
          status === "green" ? "text-verdant" : status === "amber" ? "text-gold" : "text-red-500"
        )}>
          {format(current)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-cream-dark overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
