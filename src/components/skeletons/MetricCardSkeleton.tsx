import { SkeletonPulse } from "./SkeletonPulse";

function MetricCardSkeleton() {
  return (
    <div className="glass-panel p-4 space-y-3">
      <SkeletonPulse className="h-3 w-24" />
      <SkeletonPulse className="h-7 w-28" />
    </div>
  );
}

export function MetricCardSkeletonRow() {
  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      <MetricCardSkeleton />
      <MetricCardSkeleton />
      <MetricCardSkeleton />
      <MetricCardSkeleton />
    </div>
  );
}
