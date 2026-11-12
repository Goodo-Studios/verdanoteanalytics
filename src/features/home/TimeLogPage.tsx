// Time (OS-012): my weekly log, a tab under Home. One week at a time, Monday to Sunday, with
// previous and next week, a total for each day and for the week, and my entries under each day.
// I can add an entry by hand (date, start, end, and a task or a client or Internal with a
// category), edit one, and delete one after confirming. Database errors (overlap, end before
// start, longer than 24 hours) are shown in plain words. The week is in the address (?week=).
// A small form starts a timer for a client or Internal with a category, for time with no task.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField, useConfirm } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { INTERNAL, TimePurposeFields } from "@/components/TimePurposeFields";
import { useAuth } from "@/contexts/AuthContext";
import { useMyTasks } from "@/hooks/useMyWork";
import { useDeleteEntry, useSaveEntry, useStartTimer, useWeekEntries, type EntryInput } from "@/hooks/useTimer";
import { todayIso } from "@/lib/homeData";
import {
  addDays,
  dayLabel,
  durationSeconds,
  entryLabel,
  formatHours,
  groupByDay,
  localClock,
  localIso,
  toTimestamp,
  validateEntryForm,
  weekLabel,
  weekRange,
  type TimeEntryRow,
} from "@/lib/timeLog";
import { HomeTabs } from "./HomeTabs";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

interface FormState {
  date: string;
  start: string;
  end: string;
  taskId: string;
  client: string;
  category: string;
  description: string;
}

function emptyForm(date: string): FormState {
  return { date, start: "09:00", end: "10:00", taskId: "", client: "", category: "", description: "" };
}

function formFromEntry(e: TimeEntryRow): FormState {
  return {
    date: localIso(new Date(e.start_at)),
    start: localClock(e.start_at),
    end: e.end_at ? localClock(e.end_at) : "",
    taskId: e.task_id ?? "",
    client: e.task_id ? "" : e.is_internal ? INTERNAL : e.client_slug ?? "",
    category: e.category ?? "",
    description: e.description ?? "",
  };
}

function toInput(f: FormState): EntryInput {
  const noTask = !f.taskId;
  return {
    task_id: f.taskId || null,
    // With a task, the database copies the task's client.
    client_slug: noTask && f.client !== INTERNAL ? f.client || null : null,
    is_internal: noTask && f.client === INTERNAL,
    category: f.category || null,
    description: f.description.trim(),
    start_at: toTimestamp(f.date, f.start),
    end_at: toTimestamp(f.date, f.end),
  };
}

function EntryForm({
  initial,
  taskOptions,
  saving,
  onSave,
  onCancel,
  editing,
}: {
  initial: FormState;
  taskOptions: Array<{ value: string; label: string }>;
  saving: boolean;
  onSave: (f: FormState) => Promise<string | null>;
  onCancel: () => void;
  editing: boolean;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof FormState) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="space-y-3 rounded-lg border border-border/60 bg-card p-4"
      data-testid="time-entry-form"
      aria-label={editing ? "Edit entry" : "Add entry"}
      onSubmit={async (e) => {
        e.preventDefault();
        const problem = validateEntryForm(f);
        if (problem) {
          setError(problem);
          return;
        }
        setError(await onSave(f));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Date" type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} data-testid="time-form-date" required />
        <TextField label="Start" type="time" value={f.start} onChange={(e) => set("start")(e.target.value)} data-testid="time-form-start" required />
        <TextField label="End" type="time" value={f.end} onChange={(e) => set("end")(e.target.value)} data-testid="time-form-end" required />
      </div>
      <SelectField
        label="Task"
        value={f.taskId}
        onChange={(e) => set("taskId")(e.target.value)}
        placeholder="No task"
        options={taskOptions}
        data-testid="time-form-task"
      />
      {f.taskId ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <TimePurposeFields idPrefix="time-form" client={f.client} category={f.category} onClient={set("client")} onCategory={set("category")} />
        </div>
      )}
      <TextField label="Description" value={f.description} onChange={(e) => set("description")(e.target.value)} maxLength={500} data-testid="time-form-description" />
      {error ? (
        <p role="alert" className="text-sm text-[var(--gos-late)]" data-testid="time-form-error">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving} data-testid="time-form-save">
          {editing ? "Save changes" : "Add entry"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Start a timer for a client or Internal, with a category, when the time is not for a task. */
function StartWithoutTask() {
  const start = useStartTimer();
  const [client, setClient] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 rounded-lg border border-border/60 bg-card p-4"
      aria-label="Start a timer with no task"
      data-testid="time-start-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!client || !category) {
          setError("Choose a client or Internal, and a category.");
          return;
        }
        setError(null);
        start.mutate(
          { clientSlug: client === INTERNAL ? null : client, internal: client === INTERNAL, category, description: description.trim() },
          {
            onSuccess: () => {
              setDescription("");
              toast.success("Timer started.");
            },
            onError: (err) => setError((err as Error).message),
          },
        );
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start a timer with no task</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TimePurposeFields idPrefix="time-start" client={client} category={category} onClient={setClient} onCategory={setCategory} />
        <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} data-testid="time-start-description" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--gos-late)]">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={start.isPending} data-testid="time-start">
        Start timer
      </Button>
    </form>
  );
}

export default function TimeLogPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const asked = params.get("week") ?? "";
  const week = useMemo(() => weekRange(ISO_DAY.test(asked) ? asked : today), [asked, today]);
  const entries = useWeekEntries(user?.id, week.fromIso, week.toIso);
  const tasks = useMyTasks(user?.id);
  const save = useSaveEntry();
  const remove = useDeleteEntry();
  const { confirm, dialog } = useConfirm();
  // null: no form; "new": adding; otherwise the id of the entry being edited.
  const [formFor, setFormFor] = useState<string | null>(null);

  const grouped = useMemo(() => groupByDay(entries.data ?? [], week.days), [entries.data, week.days]);
  const editing = formFor && formFor !== "new" ? (entries.data ?? []).find((e) => e.id === formFor) ?? null : null;

  const taskOptions = useMemo(() => {
    const opts = (tasks.data ?? []).map((t) => ({ value: t.id, label: `${t.title} (${t.client?.name || t.client_slug})` }));
    if (editing?.task_id && !opts.some((o) => o.value === editing.task_id)) {
      opts.unshift({ value: editing.task_id, label: editing.task?.title || "This entry's task" });
    }
    return opts;
  }, [tasks.data, editing]);

  const goWeek = (start: string | null) => {
    const next = new URLSearchParams(params);
    if (start) next.set("week", start);
    else next.delete("week");
    setParams(next, { replace: true });
    setFormFor(null);
  };

  const onSave = async (f: FormState): Promise<string | null> => {
    try {
      await save.mutateAsync({ id: editing?.id, values: toInput(f) });
      toast.success(editing ? "Entry saved." : "Entry added.");
      setFormFor(null);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const onDelete = async (e: TimeEntryRow) => {
    const ok = await confirm({
      title: "Delete this entry?",
      description: `${entryLabel(e)}, ${localClock(e.start_at)} to ${e.end_at ? localClock(e.end_at) : "now"}. This cannot be undone.`,
      actionLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(e.id, {
      onSuccess: () => toast.success("Entry deleted."),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const isThisWeek = week.start === weekRange(today).start;

  return (
    <PageShell data-testid="time-log-page">
      <PageHeader title="Time" description="Your time this week, by day. Start a timer from any task, or add time by hand." className="mb-2" />
      <HomeTabs active="time" />

      <div className="flex flex-wrap items-center gap-2" data-testid="time-week-nav">
        <Button variant="ghost" size="sm" onClick={() => goWeek(addDays(week.start, -7))} aria-label="Previous week" data-testid="time-week-prev">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <h2 className="text-sm font-semibold" data-testid="time-week-label">{weekLabel(week.start)}</h2>
        <Button variant="ghost" size="sm" onClick={() => goWeek(addDays(week.start, 7))} aria-label="Next week" data-testid="time-week-next">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        {isThisWeek ? null : (
          <Button variant="ghost" size="sm" onClick={() => goWeek(null)}>
            This week
          </Button>
        )}
        <span className="ml-auto text-sm" data-testid="time-week-total">
          Week total <span className="font-semibold tabular-nums">{formatHours(grouped.seconds)}</span>
        </span>
        <Button size="sm" onClick={() => setFormFor("new")} data-testid="time-add" disabled={formFor === "new"}>
          Add entry
        </Button>
      </div>

      {formFor ? (
        <EntryForm
          key={formFor}
          initial={editing ? formFromEntry(editing) : emptyForm(isThisWeek ? today : week.start)}
          taskOptions={taskOptions}
          saving={save.isPending}
          onSave={onSave}
          onCancel={() => setFormFor(null)}
          editing={!!editing}
        />
      ) : null}

      <StartWithoutTask />

      {entries.isLoading ? (
        <LoadingState label="Loading your time" />
      ) : entries.isError ? (
        <div data-testid="time-error">
          <ErrorState message="Your time could not load, so this is not the same as having none." onRetry={() => void entries.refetch()} />
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.seconds === 0 && (entries.data ?? []).length === 0 ? (
            <div data-testid="time-empty">
              <EmptyState title="No time this week." description="Press play on a task, or add an entry by hand." />
            </div>
          ) : null}
          {grouped.days.map((d) => (
            <section key={d.date} aria-labelledby={`time-day-${d.date}`} data-testid="time-day" data-date={d.date}>
              <div className="mb-1 flex items-baseline justify-between">
                <h3 id={`time-day-${d.date}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {dayLabel(d.date)}
                  {d.date === today ? " (today)" : ""}
                </h3>
                <span className="text-xs tabular-nums text-muted-foreground" data-testid="time-day-total">{formatHours(d.seconds)}</span>
              </div>
              {d.entries.length === 0 ? null : (
                <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
                  {d.entries.map((e) => {
                    const running = !e.end_at;
                    return (
                      <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm" data-testid="time-entry">
                        <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                          {localClock(e.start_at)} to {e.end_at ? localClock(e.end_at) : "now"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium" data-testid="time-entry-label">{entryLabel(e)}</span>
                          {e.description ? <span className="ml-2 text-muted-foreground">{e.description}</span> : null}
                        </span>
                        <span className="w-16 shrink-0 text-right tabular-nums">{running ? "running" : formatHours(durationSeconds(e.start_at, e.end_at))}</span>
                        <span className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="sm" disabled={running} onClick={() => setFormFor(e.id)} aria-label={`Edit ${entryLabel(e)}`} data-testid="time-entry-edit">
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" disabled={running} onClick={() => void onDelete(e)} aria-label={`Delete ${entryLabel(e)}`} data-testid="time-entry-delete">
                            Delete
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {dialog}
    </PageShell>
  );
}
