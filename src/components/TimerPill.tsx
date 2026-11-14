// The timer pill in the top bar (OS-012). Staff only: a client login and a builder previewing the
// client view never see it. Hidden when no timer runs. Shows what the time is for (the task title,
// or the client or Internal with the category) and the elapsed h:mm:ss, ticking each second from
// the entry's start, so a reload shows the same time. Stop ends the timer; Switch opens a small
// picker to move to another of my open tasks, or to a client or Internal with a category.
import { useEffect, useState } from "react";
import { ArrowLeftRight, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { INTERNAL, TimePurposeFields } from "@/components/TimePurposeFields";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useMyTasks } from "@/hooks/useMyWork";
import { useRunningTimer, useStartTimer, useStopTimer } from "@/hooks/useTimer";
import { MOTION } from "@/lib/motion";
import { durationSeconds, entryLabel, formatElapsed } from "@/lib/timeLog";

/** The current time in ms, updated every second while mounted. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function SwitchPicker({ userId, runningTaskId, onDone }: { userId: string; runningTaskId: string | null; onDone: () => void }) {
  const tasks = useMyTasks(userId);
  const start = useStartTimer();
  const [client, setClient] = useState("");
  const [category, setCategory] = useState("");
  const others = (tasks.data ?? []).filter((t) => t.id !== runningTaskId).slice(0, 8);

  const go = (args: Parameters<typeof start.mutate>[0]) =>
    start.mutate(args, {
      onSuccess: onDone,
      onError: (e) => toast.error(`Could not switch the timer: ${(e as Error).message}`),
    });

  return (
    <div className="space-y-4" data-testid="timer-switch">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">My open tasks</p>
        {tasks.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your tasks…</p>
        ) : others.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other open tasks.</p>
        ) : (
          <ul className="space-y-0.5">
            {others.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => go({ taskId: t.id })}
                  disabled={start.isPending}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
                  data-testid="timer-switch-task"
                >
                  <Play className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden fill="currentColor" />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="space-y-2 border-t border-border/60 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!client || !category) {
            toast.error("Choose a client or Internal, and a category.");
            return;
          }
          go({ clientSlug: client === INTERNAL ? null : client, internal: client === INTERNAL, category });
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">No task</p>
        <TimePurposeFields idPrefix="timer-switch" client={client} category={category} onClient={setClient} onCategory={setCategory} />
        <button
          type="submit"
          disabled={start.isPending}
          className="w-full rounded-full border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          data-testid="timer-switch-start"
        >
          Start
        </button>
      </form>
    </div>
  );
}

function RunningPill({ userId }: { userId: string }) {
  const running = useRunningTimer(userId);
  const stop = useStopTimer();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const entry = running.data;
  if (!entry) return null;

  const label = entryLabel(entry);
  const elapsed = formatElapsed(durationSeconds(entry.start_at, null, now));

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-card py-1 pl-3 pr-1 text-sm shadow-card"
      data-testid="timer-pill"
      role="status"
      aria-label={`Timer running on ${label}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full bg-primary ${MOTION.pulse}`} aria-hidden data-testid="timer-pill-dot" />
      <span className="max-w-[12rem] truncate" data-testid="timer-pill-label" title={label}>{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground" data-testid="timer-pill-elapsed">{elapsed}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Switch the timer"
            data-testid="timer-pill-switch"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          {open ? <SwitchPicker userId={userId} runningTaskId={entry.task_id} onDone={() => setOpen(false)} /> : null}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={() => stop.mutate(undefined, { onError: (e) => toast.error(`Could not stop the timer: ${(e as Error).message}`) })}
        disabled={stop.isPending}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        aria-label="Stop the timer"
        data-testid="timer-pill-stop"
      >
        <Square className="h-3 w-3" aria-hidden fill="currentColor" />
      </button>
    </div>
  );
}

export function TimerPill() {
  const { user, isBuilder, isEmployee } = useAuth();
  const { isClientPreview } = useClientPreview();
  if (!user || !(isBuilder || isEmployee) || isClientPreview) return null;
  return <RunningPill userId={user.id} />;
}
