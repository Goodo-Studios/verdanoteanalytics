// Five dots for the five asset stages, filled up to the current one. 'Other' statuses get a
// neutral dash. The label is read out instead of the dots ("Phase 3 of 5: Editing").
import { memo } from "react";
import { phaseLabel, phaseNumber } from "@/lib/myWork";

export const PhaseDots = memo(function PhaseDots({ stage }: { stage: string | null | undefined }) {
  const n = phaseNumber(stage);
  const label = phaseLabel(stage);
  if (n === 0) {
    return (
      <span role="img" aria-label={label} title={label} className="inline-block w-[52px] text-center text-xs text-[var(--gos-faint)]" data-testid="phase-dots" data-phase="0">
        –
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex w-[52px] items-center gap-1" data-testid="phase-dots" data-phase={n}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${i <= n ? "bg-[var(--gos-ink)]" : "bg-[var(--gos-line)]"}`}
          data-filled={i <= n ? "true" : undefined}
        />
      ))}
    </span>
  );
});
