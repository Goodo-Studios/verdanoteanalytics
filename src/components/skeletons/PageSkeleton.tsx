import { SkeletonPulse } from "./SkeletonPulse";
import { MetricCardSkeletonRow } from "./MetricCardSkeleton";
import { TableSkeleton } from "./TableSkeleton";

/**
 * Generic content-only loading state shown inside the persistent app shell
 * (sidebar + header stay mounted) while a lazy route chunk resolves. Mirrors
 * the common page layout — title, metric row, table — so the swap to real
 * content feels like a fill-in rather than a full repaint.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Title / toolbar row */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonPulse className="h-6 w-48" />
          <SkeletonPulse className="h-3 w-32" />
        </div>
        <SkeletonPulse className="h-9 w-32" />
      </div>
      <MetricCardSkeletonRow />
      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
