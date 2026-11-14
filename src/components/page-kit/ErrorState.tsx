import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  message: string;
  /** Shows a "Try again" button when given. */
  onRetry?: () => void;
  title?: string;
  className?: string;
}

/** A load error in plain words, with a way to try again. */
export function ErrorState({ message, onRetry, title = "Something went wrong", className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className={cn("flex flex-col items-start gap-2 rounded-card border border-destructive/30 bg-destructive/5 px-4 py-3", className)}
    >
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
