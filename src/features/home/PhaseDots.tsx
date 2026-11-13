// Five dots for the five asset stages, filled up to the current one. 'Other' statuses get a
// neutral dash. The label is read out instead of the dots ("Phase 3 of 5: Editing").
import { memo } from "react";
import { phaseLabel, phaseNumber } from "@/lib/myWork";

const FILLED = "●●●●●";

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
  // The dots are text in two runs (filled, then empty), not one element per dot: this sits on every
  // row of long lists, so it stays at three elements.
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-block w-[52px] whitespace-nowrap text-[8px] leading-none tracking-[3px]"
      data-testid="phase-dots"
      data-phase={n}
    >
      <span aria-hidden className="text-[var(--gos-ink)]" data-filled-count={n}>{FILLED.slice(0, n)}</span>
      <span aria-hidden className="text-[var(--gos-line)]">{FILLED.slice(0, 5 - n)}</span>
    </span>
  );
});
