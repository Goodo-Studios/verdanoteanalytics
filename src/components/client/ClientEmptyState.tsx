import type { LucideIcon } from "lucide-react";

/**
 * ClientEmptyState — the shared, first-class onboarding/empty state for every
 * Client Home section (US-006).
 *
 * Friendly onboarding states are first-class on the client surface: a brand-new
 * client (or the first days of a month) sees an intentional, branded greeting in
 * each section instead of a wall of zeros or a broken-looking page. This is a
 * REAL rendered component (never `return null` / a hidden section) so the page
 * always reads as deliberate and builds confidence.
 *
 * Presentational only — icon/illustration + warm heading + client-language
 * subcopy, composed from existing brand tokens (sage / forest / slate, card
 * surface) so it is visually consistent across Outcomes, Winners, Highlights,
 * and Pipeline.
 */
export interface ClientEmptyStateProps {
  /** Brand icon for the section's onboarding state. */
  icon: LucideIcon;
  /** Warm, client-language headline (e.g. "Your first results will appear here"). */
  heading: string;
  /** Optional one-line reassurance beneath the heading. */
  subcopy?: string;
  /** Extra classes for layout tuning by the host section. */
  className?: string;
}

export function ClientEmptyState({
  icon: Icon,
  heading,
  subcopy,
  className,
}: ClientEmptyStateProps) {
  return (
    <div
      data-testid="client-empty-state"
      className={`bg-card border border-border-light rounded-[8px] px-6 py-10 flex flex-col items-center text-center ${
        className ?? ""
      }`}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-sage/10 mb-4"
        aria-hidden="true"
      >
        <Icon className="h-6 w-6 text-sage" />
      </span>
      <p className="font-heading text-[16px] text-forest">{heading}</p>
      {subcopy && (
        <p className="font-body text-[13px] text-slate font-light mt-1.5 max-w-[340px]">
          {subcopy}
        </p>
      )}
    </div>
  );
}

export default ClientEmptyState;
