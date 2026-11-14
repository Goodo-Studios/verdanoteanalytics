import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, humanise, statusKeyOf } from "./statusMap";

interface StatusBadgeProps {
  status: string | null | undefined;
  /** Replaces the default words, for example "Waiting on client". */
  label?: string;
  className?: string;
}

/** A small coloured pill for a status. Unknown values show in a neutral grey. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const key = statusKeyOf(status);
  const text = label ?? (key ? STATUS_LABEL[key] : status ? humanise(status) : "Not set");
  const tone = key ? STATUS_TONE[key] : STATUS_TONE.draft;
  return (
    <span data-status={key ?? "other"} className={cn(badgeVariants({ variant: "outline" }), "whitespace-nowrap font-medium", tone, className)}>
      {text}
    </span>
  );
}
