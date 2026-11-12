// Today in the War Room layout (OS-010). One next action at the top, then a short list, with a thin
// progress bar for today (N of M done). Marking an item done slides it away and offers Undo. A builder
// also sees decisions waiting, late items across every client, and client approvals outstanding.
// No tables: one item, then plain lists. The next action and each list item have a play button
// for the timer (OS-012).
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-kit";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffDecisions } from "@/hooks/useClientDecisions";
import { useMyTasks } from "@/hooks/useMyWork";
import { useDoneTodayCount, useSetTaskStatus } from "@/hooks/useToday";
import { useTaskTimer } from "@/hooks/useTimer";
import { TimerToggle } from "@/components/TimerToggle";
import { isNewDecision, staffDecisionText } from "@/lib/clientDecisions";
import { shortDate, todayIso } from "@/lib/homeData";
import { DONE_STATUS, isLateDue, type MyTaskRow } from "@/lib/myWork";
import { awaitingClientApproval, lateAcrossClients, pickToday, todayProgress } from "@/lib/today";
import { PhaseDots } from "./PhaseDots";
import { TaskSidePanel } from "./TaskSidePanel";

/** How long the slide-away runs before the item leaves the list. Matches the CSS duration. */
export const SLIDE_MS = 260;
const BUILDER_LIST_MAX = 8;

function clientName(t: MyTaskRow): string {
  return t.client?.name || t.client_slug || "No client";
}

export function ProgressBar({ done, total, percent, label }: { done: number; total: number; percent: number; label: string }) {
  return (
    <div data-testid="today-progress">
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
        <span data-testid="today-progress-label">{label}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Done today"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={label}
        className="h-1 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          data-testid="today-progress-fill"
          className="h-full rounded-full bg-primary"
          style={{ width: `${percent}%`, transition: "width 400ms var(--gos-ease)" }}
        />
      </div>
    </div>
  );
}

function DoneButton({ task, onDone, big }: { task: MyTaskRow; onDone: (t: MyTaskRow) => void; big?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDone(task);
      }}
      aria-label={`Mark ${task.title} done`}
      data-testid="today-done"
      className={`shrink-0 rounded-full border border-input bg-background font-medium transition-colors hover:bg-secondary ${big ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"}`}
    >
      Done
    </button>
  );
}

function slideClass(leaving: boolean): string {
  return `transition-[transform,opacity] duration-[260ms] ease-[var(--gos-ease)] ${leaving ? "translate-x-8 opacity-0" : "translate-x-0 opacity-100"}`;
}

function BuilderList({ id, title, items, empty }: { id: string; title: string; items: Array<{ key: string; primary: string; secondary: string; right?: string; late?: boolean; onOpen?: () => void }>; empty: string }) {
  return (
    <section aria-labelledby={`today-${id}-title`} data-testid={`today-${id}`}>
      <h3 id={`today-${id}-title`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="font-normal">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid={`today-${id}-empty`}>{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, BUILDER_LIST_MAX).map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={r.onOpen}
                disabled={!r.onOpen}
                className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary disabled:cursor-default disabled:hover:bg-transparent"
                data-testid={`today-${id}-row`}
              >
                <span className="min-w-0 flex-1 truncate">{r.primary}</span>
                <span className="hidden max-w-[40%] truncate text-xs text-muted-foreground sm:block">{r.secondary}</span>
                {r.right ? (
                  <span className={`w-16 shrink-0 text-right text-xs ${r.late ? "font-medium text-[var(--gos-late)]" : "text-muted-foreground"}`}>{r.right}</span>
                ) : null}
              </button>
            </li>
          ))}
          {items.length > BUILDER_LIST_MAX ? (
            <li className="px-2 text-xs text-muted-foreground">and {items.length - BUILDER_LIST_MAX} more</li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function TodayPanel() {
  const { user, isBuilder } = useAuth();
  const today = todayIso();
  const mine = useMyTasks(user?.id);
  const doneToday = useDoneTodayCount(user?.id, today);
  const everyone = useMyTasks(isBuilder ? user?.id : undefined, isBuilder);
  const decisions = useStaffDecisions();
  const setStatus = useSetTaskStatus();
  const timer = useTaskTimer(user?.id);

  // Items finished on this page: `leaving` while they slide out, then `hidden` until the list reloads.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const all = useMemo(() => mine.data ?? [], [mine.data]);
  const { next, rest } = useMemo(() => pickToday(all, hidden), [all, hidden]);
  const progress = todayProgress(all, doneToday.data ?? 0, today, hidden);

  const without = (s: ReadonlySet<string>, id: string) => {
    const n = new Set(s);
    n.delete(id);
    return n;
  };

  const undo = useCallback(
    (task: MyTaskRow) => {
      const t = timers.current.get(task.id);
      if (t) clearTimeout(t);
      timers.current.delete(task.id);
      setLeaving((s) => without(s, task.id));
      setHidden((s) => without(s, task.id));
      setStatus.mutate(
        { id: task.id, status: task.status },
        { onError: (e) => toast.error(`Could not undo: ${(e as Error).message}`) },
      );
    },
    [setStatus],
  );

  const markDone = useCallback(
    (task: MyTaskRow) => {
      setLeaving((s) => new Set(s).add(task.id));
      timers.current.set(
        task.id,
        setTimeout(() => {
          timers.current.delete(task.id);
          setHidden((s) => new Set(s).add(task.id));
          setLeaving((s) => without(s, task.id));
        }, SLIDE_MS),
      );
      setStatus.mutate(
        { id: task.id, status: DONE_STATUS },
        {
          onError: (e) => {
            const t = timers.current.get(task.id);
            if (t) clearTimeout(t);
            timers.current.delete(task.id);
            setLeaving((s) => without(s, task.id));
            setHidden((s) => without(s, task.id));
            toast.error(`Could not mark it done: ${(e as Error).message}`);
          },
        },
      );
      toast(`Done: ${task.title}`, { action: { label: "Undo", onClick: () => undo(task) }, duration: 6000 });
    },
    [setStatus, undo],
  );

  const everyoneRows = useMemo(() => everyone.data ?? [], [everyone.data]);
  const openTask = useMemo(
    () => (openId ? all.find((t) => t.id === openId) ?? everyoneRows.find((t) => t.id === openId) ?? null : null),
    [all, everyoneRows, openId],
  );
  const closePanel = useCallback(() => setOpenId(null), []);

  const nowMs = Date.now();
  const waitingDecisions = (decisions.data ?? []).filter((d) => d.superseded_at === null && isNewDecision(d, nowMs));
  const late = isBuilder ? lateAcrossClients(everyoneRows, today) : [];
  const approvals = isBuilder ? awaitingClientApproval(everyoneRows) : [];

  return (
    <div className="space-y-8" data-testid="today-panel">
      {mine.isLoading ? (
        <div data-testid="today-loading">
          <LoadingState label="Loading today" />
        </div>
      ) : mine.isError ? (
        <div data-testid="today-error">
          <ErrorState message="Today's work could not load, so this is not the same as having none." onRetry={() => void mine.refetch()} />
        </div>
      ) : (
        <>
          <ProgressBar {...progress} />
          {next ? (
            <section aria-label="Next action" data-testid="today-next" className={slideClass(leaving.has(next.id))}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next</p>
              <div className="flex items-start gap-4 rounded-panel border border-border/60 bg-card p-5 shadow-card">
                <button type="button" onClick={() => setOpenId(next.id)} className="min-w-0 flex-1 text-left" data-testid="today-next-open">
                  <h2 className="gos-serif text-2xl leading-tight" data-testid="today-next-title">{next.title}</h2>
                  <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>{clientName(next)}</span>
                    <PhaseDots stage={next.status_info?.stage} />
                    <span className={isLateDue(next.due_date, today) ? "font-medium text-[var(--gos-late)]" : ""} data-testid="today-next-due">
                      {next.due_date ? `Due ${shortDate(next.due_date)}` : "No due date"}
                    </span>
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <TimerToggle title={next.title} running={timer.runningTaskId === next.id} onToggle={() => timer.toggle(next.id)} size="md" />
                  <DoneButton task={next} onDone={markDone} big />
                </div>
              </div>
            </section>
          ) : (
            <div data-testid="today-empty">
              <EmptyState title="Nothing left for you today." description="Tasks where you are the strategist, producer or editor show up here." />
            </div>
          )}

          {rest.length > 0 ? (
            <section aria-label="After that" data-testid="today-list">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">After that</p>
              <ul className="space-y-1">
                {rest.map((t) => (
                  <li key={t.id} className={slideClass(leaving.has(t.id))} data-testid="today-list-item">
                    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-secondary">
                      <button type="button" onClick={() => setOpenId(t.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm">
                        <span className="min-w-0 flex-1 truncate" data-testid="today-list-title">{t.title}</span>
                        <span className="hidden w-36 shrink-0 truncate text-muted-foreground sm:block">{clientName(t)}</span>
                        <span className={`w-16 shrink-0 text-right text-xs ${isLateDue(t.due_date, today) ? "font-medium text-[var(--gos-late)]" : "text-muted-foreground"}`}>
                          {shortDate(t.due_date)}
                        </span>
                      </button>
                      <TimerToggle title={t.title} running={timer.runningTaskId === t.id} onToggle={() => timer.toggle(t.id)} />
                      <DoneButton task={t} onDone={markDone} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {isBuilder ? (
        <section aria-label="Across every client" className="space-y-6 border-t border-border/60 pt-6" data-testid="today-builder">
          {everyone.isError || decisions.isError ? (
            <ErrorState
              message="Part of the builder view could not load."
              onRetry={() => {
                void everyone.refetch();
                void decisions.refetch();
              }}
            />
          ) : everyone.isLoading || decisions.isLoading ? (
            <LoadingState label="Loading every client" />
          ) : (
            <>
              <BuilderList
                id="decisions"
                title="Decisions waiting"
                empty="No new client answers to look at."
                items={waitingDecisions.map((d) => ({
                  key: d.id,
                  primary: d.task_name || "Untitled task",
                  secondary: `${d.client_slug} · ${staffDecisionText(d)}`,
                  right: shortDate(d.decided_at.slice(0, 10)),
                }))}
              />
              <BuilderList
                id="late"
                title="Late across all clients"
                empty="Nothing is late."
                items={late.map((t) => ({
                  key: t.id,
                  primary: t.title,
                  secondary: clientName(t),
                  right: shortDate(t.due_date),
                  late: true,
                  onOpen: () => setOpenId(t.id),
                }))}
              />
              <BuilderList
                id="approvals"
                title="Client approvals outstanding"
                empty="No work is waiting on a client."
                items={approvals.map((t) => ({
                  key: t.id,
                  primary: t.title,
                  secondary: clientName(t),
                  right: shortDate(t.due_date),
                  late: isLateDue(t.due_date, today),
                  onOpen: () => setOpenId(t.id),
                }))}
              />
            </>
          )}
        </section>
      ) : null}

      <TaskSidePanel task={openTask} today={today} onClose={closePanel} />
    </div>
  );
}
