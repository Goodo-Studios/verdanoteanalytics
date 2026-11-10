import { SkeletonPulse } from "@/components/skeletons/SkeletonPulse";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /** Spoken to screen readers, for example "Loading crew". Not shown on screen. */
  label?: string;
  /** `rows` for lists and tables, `cards` for a grid of blocks. */
  variant?: "rows" | "cards";
  count?: number;
  className?: string;
}

/** A skeleton placeholder while data loads. It announces itself as a status. */
export function LoadingState({ label = "Loading", variant = "rows", count, className }: LoadingStateProps) {
  const n = count ?? (variant === "cards" ? 3 : 5);
  return (
    <div role="status" aria-busy="true" aria-label={label} data-testid="loading-state" className={cn("w-full", className)}>
      <span className="sr-only">{label}</span>
      {variant === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: n }).map((_, i) => (
            <SkeletonPulse key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: n }).map((_, i) => (
            <SkeletonPulse key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}
