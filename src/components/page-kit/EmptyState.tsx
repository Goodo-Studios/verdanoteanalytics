import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** A button or link that fixes the emptiness, for example "Add a crew member". */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** What a list or page shows when there is nothing to show yet. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className={cn("flex flex-col items-center gap-2 rounded-card border border-dashed border-border bg-card px-4 py-10 text-center", className)}
    >
      {icon ? <div className="text-muted-foreground" aria-hidden="true">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
