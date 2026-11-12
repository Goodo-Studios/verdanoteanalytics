// The play / stop button on a task (OS-012). Presentational: the caller says whether this task's
// timer is running and what to do on a press.
const BASE = "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50";
const IDLE = "border-input bg-background text-muted-foreground hover:bg-secondary hover:text-foreground";
const ON = "border-primary bg-primary text-primary-foreground";

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
      className={`${BASE} ${size === "md" ? "h-9 w-9" : "h-7 w-7"} ${running ? ON : IDLE}`}
    >
      {/* Plain glyphs, not icon components: this button is on every row, so it stays cheap to draw. */}
      <span aria-hidden className="text-[10px] leading-none">{running ? "■" : "▶"}</span>
    </button>
  );
}
