// My work (OS-009): the open tasks where the signed-in person is strategist, producer or editor,
// one line each, grouped by due date (overdue, today, this week, later, no date). A row opens the
// task side panel without leaving the page. A tab under Home, beside Work (every client's cards).
// Each row has a play button that starts a timer on the task (OS-012), or stops it if it runs.
//
// Filters (client, phase) live in the address (?for=, ?phase=). A builder can switch to everyone's
// tasks (?everyone=1). Red is only for late dates.
import { memo, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField } from "@/components/page-kit";
import { useAuth } from "@/contexts/AuthContext";
import { useMyTasks } from "@/hooks/useMyWork";
import { useTaskTimer } from "@/hooks/useTimer";
import { TimerToggle } from "@/components/TimerToggle";
import { shortDate, todayIso } from "@/lib/homeData";
import { clientOptions, filterMyTasks, groupMyTasks, isLateDue, PHASES, type MyTaskRow } from "@/lib/myWork";
import { HomeTabs } from "./HomeTabs";
import { PhaseDots } from "./PhaseDots";
import { TaskSidePanel } from "./TaskSidePanel";

const PHASE_OPTIONS = [...PHASES.map((p) => ({ value: p, label: p })), { value: "Other", label: "Other" }];

const TaskRow = memo(function TaskRow({
  task,
  today,
  onOpen,
  timing,
  onTimer,
}: {
  task: MyTaskRow;
  today: string;
  onOpen: (id: string) => void;
  timing: boolean;
  onTimer: (id: string) => void;
}) {
  const late = isLateDue(task.due_date, today);
  return (
    <li className="flex items-center gap-2 pr-3 transition-colors hover:bg-secondary">
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left text-sm focus-visible:bg-secondary focus-visible:outline-none"
        data-testid="my-task-row"
        data-late={late ? "true" : undefined}
      >
        <span className="min-w-0 flex-1 truncate font-medium" data-testid="my-task-title">{task.title}</span>
        <span className="hidden w-36 shrink-0 truncate text-muted-foreground sm:block" data-testid="my-task-client">
          {task.client?.name || task.client_slug || "No client"}
        </span>
        <PhaseDots stage={task.status_info?.stage} />
        <span
          className={`w-16 shrink-0 text-right text-xs ${late ? "font-medium text-[var(--gos-late)]" : "text-muted-foreground"}`}
          data-testid="my-task-due"
        >
          {shortDate(task.due_date)}
        </span>
      </button>
      <TimerToggle title={task.title} running={timing} onToggle={() => onTimer(task.id)} />
    </li>
  );
});

export default function MyWorkPage() {
  const { user, isBuilder } = useAuth();
  const [params, setParams] = useSearchParams();
  const client = params.get("for") ?? "";
  const phase = params.get("phase") ?? "";
  const everyone = isBuilder && params.get("everyone") === "1";
  const { data: tasks, isLoading, isError, refetch } = useMyTasks(user?.id, everyone);
  const [openId, setOpenId] = useState<string | null>(null);
  const { runningTaskId, toggle } = useTaskTimer(user?.id);
  const today = todayIso();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const all = useMemo(() => tasks ?? [], [tasks]);
  const clients = useMemo(() => clientOptions(all), [all]);
  const groups = useMemo(() => groupMyTasks(filterMyTasks(all, { client, phase }), today), [all, client, phase, today]);
  const shownCount = groups.reduce((n, g) => n + g.tasks.length, 0);
  const openTask = useMemo(() => (openId ? all.find((t) => t.id === openId) ?? null : null), [all, openId]);
  const onOpen = useCallback((id: string) => setOpenId(id), []);
  const onClose = useCallback(() => setOpenId(null), []);

  return (
    <PageShell data-testid="my-work-page">
      <PageHeader
        title="My work"
        description={everyone ? "Everyone's open tasks, by due date." : "The tasks where you are strategist, producer or editor, by due date."}
        className="mb-2"
      />
      <HomeTabs active="mine" />

      <FilterBar>
        <SelectField
          label="Client"
          hideLabel
          value={client}
          onChange={(e) => set("for", e.target.value)}
          data-testid="my-work-filter-client"
          placeholder="All clients"
          options={clients}
          className="min-w-[10rem]"
        />
        <SelectField
          label="Phase"
          hideLabel
          value={phase}
          onChange={(e) => set("phase", e.target.value)}
          data-testid="my-work-filter-phase"
          placeholder="All phases"
          options={PHASE_OPTIONS}
          className="min-w-[10rem]"
        />
        {isBuilder ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={everyone} onChange={(e) => set("everyone", e.target.checked ? "1" : "")} data-testid="my-work-everyone" />
            Everyone
          </label>
        ) : null}
      </FilterBar>

      {isLoading ? (
        <div data-testid="my-work-loading">
          <LoadingState label="Loading your tasks" />
        </div>
      ) : isError ? (
        <div data-testid="my-work-error">
          <ErrorState message="Your tasks could not load, so this is not the same as having none." onRetry={() => void refetch()} />
        </div>
      ) : all.length === 0 ? (
        <div data-testid="my-work-empty">
          <EmptyState
            title={everyone ? "No open tasks." : "No tasks assigned to you"}
            description={everyone ? undefined : "Tasks where you are the strategist, producer or editor show up here."}
          />
        </div>
      ) : shownCount === 0 ? (
        <div data-testid="my-work-empty-filtered">
          <EmptyState title="No tasks match these filters." />
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.id} aria-labelledby={`my-work-group-${g.id}`} data-testid={`my-work-group-${g.id}`}>
              <h2 id={`my-work-group-${g.id}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label} <span className="font-normal">({g.tasks.length})</span>
              </h2>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} onOpen={onOpen} timing={runningTaskId === t.id} onTimer={toggle} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <TaskSidePanel task={openTask} today={today} onClose={onClose} />
    </PageShell>
  );
}
