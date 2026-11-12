// The play / stop button on a task (OS-012). Presentational: the caller says whether this task's
// timer is running and what to do on a press.
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export function TimerToggle({
  title,
  running,
  onToggle,
  disabled,
  size = "sm",
}: {
  title: string;
  running: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      disabled={disabled}
      aria-label={running ? `Stop the timer on ${title}` : `Start a timer on ${title}`}
      aria-pressed={running}
      data-testid="timer-toggle"
      data-running={running ? "true" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50",
        size === "md" ? "h-9 w-9" : "h-7 w-7",
        running ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {running ? <Square className="h-3 w-3" aria-hidden fill="currentColor" /> : <Play className="h-3 w-3" aria-hidden fill="currentColor" />}
    </button>
  );
}
