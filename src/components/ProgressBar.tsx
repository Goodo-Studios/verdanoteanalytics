// The one progress bar (OS-025). Used in the Today header and the client hub monthly delivery.
// A thin ink bar on the light track, no green or red. The fill eases to a new width over 0.6s
// (off with reduced motion). An optional marker shows where today falls along the period.
import { MOTION, usePrefersReducedMotion } from "@/lib/motion";
import { progressPercent } from "@/lib/progress";

export function ProgressBar({
  done,
  total,
  label,
  ariaLabel,
  percent,
  markerPercent,
  markerLabel,
  testId = "progress",
}: {
  done: number;
  total: number;
  /** The words shown above the bar, for example "3 of 5 done today". */
  label: string;
  ariaLabel: string;
  percent?: number;
  /** Where to draw the today marker, 0 to 100. None when left out. */
  markerPercent?: number;
  markerLabel?: string;
  testId?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const width = percent ?? progressPercent(done, total);
  return (
    <div data-testid={testId}>
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
        <span data-testid={`${testId}-label`}>{label}</span>
      </div>
      <div className="relative">
        <div
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={label}
          className="h-1 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            data-testid={`${testId}-fill`}
            data-motion={reduced ? "off" : "on"}
            className={`h-full rounded-full bg-primary ${reduced ? "" : MOTION.bar}`}
            style={{ width: `${width}%` }}
          />
        </div>
        {markerPercent === undefined ? null : (
          <span
            data-testid={`${testId}-today`}
            title={markerLabel}
            aria-label={markerLabel}
            role="img"
            className="absolute -top-1 h-3 w-px -translate-x-1/2 bg-[var(--gos-ink)]"
            style={{ left: `${Math.max(0, Math.min(100, markerPercent))}%` }}
          />
        )}
      </div>
    </div>
  );
}
