// The task modal on My work (OS-009) and Work. Opens over the list without leaving the page: a
// centered modal on wider screens, a bottom sheet on phones. Radix Dialog gives the focus trap,
// Escape to close and the aria labelling. Details load only when it opens (useTaskDetail).
// A play button by the title starts or stops a timer on the task (OS-012).
// Versions (OS-020): the cuts of the task with their timestamped internal and client comments.
// Playbook (OS-026): a task with a content type links to the matching Brain playbook section.
// Export checklist (OS-023): shown only when the os_settings switch is on.
// Status (list statuses): staff pick from the statuses of the task's own ClickUp list.
// ClickUp fields: the brief, the details (dates, priority, people) and every ClickUp custom field
// are edited in place (TaskFields.tsx). Edits to a ClickUp task are queued for write-back, which is off.
import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { BookOpen, ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/components/page-kit";
import { useIsPhone, useTaskDetail, type TaskComment } from "@/hooks/useMyWork";
import { useTaskTimer } from "@/hooks/useTimer";
import { useAuth } from "@/contexts/AuthContext";
import { TimerToggle } from "@/components/TimerToggle";
import { shortDate } from "@/lib/homeData";
import { isLateDue, type MyTaskRow } from "@/lib/myWork";
import { PhaseDots } from "./PhaseDots";
import { CutReview } from "@/features/cut-review/CutReview";
import { brainPagePath, sectionFromParam } from "@/features/brain/model";
import { useBrainPlaybook } from "@/hooks/useBrainPlaybook";
import { useRolePrefix } from "@/hooks/useRolePath";
import { useExportChecklistOn } from "@/hooks/useExportChecklist";
import { displayStatus } from "@/lib/exportChecklist";
import { ExportChecklist } from "./ExportChecklist";
import { useTaskStatusOptions } from "@/hooks/useTaskStatuses";
import { useSetTaskStatus } from "@/hooks/useToday";
import { toFieldEntries } from "@/lib/taskFields";
import { BriefEditor, CustomFields, TaskDetails } from "./TaskFields";

function authorName(c: TaskComment): string {
  const a = c.author ?? {};
  return a.name || a.username || a.email || (c.from_clickup ? "ClickUp" : "Someone");
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="space-y-2 border-t border-border/60 pt-4" data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Thread({ label, comments, testId }: { label: string; comments: TaskComment[]; testId: string }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <h4 className="text-sm font-medium">{label}</h4>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md bg-secondary px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {authorName(c)} · {fmtDateTime(c.created_at)}
              </p>
              <p className="whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Brain playbook section for the task's content type, or a quiet note when there is none. */
function PlaybookLink({ contentType }: { contentType: string }) {
  const prefix = useRolePrefix();
  const { data, isLoading, isError } = useBrainPlaybook(contentType);
  if (isLoading || isError) return null;
  return (
    <Section title="Playbook" testId="task-panel-playbook">
      {data ? (
        <Link
          to={brainPagePath(prefix, sectionFromParam(data.section), data.slug, data.anchor)}
          className="inline-flex items-center gap-1 text-sm underline"
          data-testid="task-panel-playbook-link"
        >
          <BookOpen className="h-3 w-3" aria-hidden />
          {data.heading ? `${data.title}: ${data.heading}` : data.title}
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">No playbook section yet.</p>
      )}
    </Section>
  );
}

// OS-023: the switch is off until the editors agree, so the four export statuses show as they always
// have. These load only once a task is open.
function TaskStatus({ status }: { status: string }) {
  return <>{displayStatus(status, useExportChecklistOn())}</>;
}

/**
 * Staff change the status here. The choices are the statuses of the task's own ClickUp list, in
 * ClickUp order with ClickUp's names (os_task_status_options); the database refuses any other.
 * Hidden on read-only tasks and when there is nothing to offer.
 */
function StatusPicker({ task }: { task: MyTaskRow }) {
  const options = useTaskStatusOptions(task.read_only ? null : task.id);
  const setStatus = useSetTaskStatus();
  const [value, setValue] = useState(task.status);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(task.status), [task.status]);
  const list = options.data ?? [];
  if (task.read_only || list.length === 0) return null;
  const known = list.some((o) => o.status === value);
  return (
    <div className="space-y-1" data-testid="task-panel-status">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status</span>
        <select
          className="rounded-md border border-border bg-card px-2 py-1 text-sm"
          value={value}
          disabled={setStatus.isPending}
          onChange={(e) => {
            const next = e.target.value;
            const before = value;
            setValue(next);
            setError(null);
            setStatus.mutate(
              { id: task.id, status: next },
              {
                onError: (err) => {
                  setValue(before);
                  setError(`Could not change the status: ${(err as Error).message}`);
                },
              },
            );
          }}
        >
          {known ? null : (
            <option value={value} disabled>
              {value}
            </option>
          )}
          {list.map((o) => (
            <option key={o.status} value={o.status}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-sm text-[var(--gos-late)]" role="alert">{error}</p> : null}
    </div>
  );
}

function ExportChecklistSection({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  if (!useExportChecklistOn()) return null;
  return (
    <Section title="Export checklist" testId="task-panel-export-checklist">
      <ExportChecklist taskId={taskId} readOnly={readOnly} />
    </Section>
  );
}

export function TaskSidePanel({ task, today, onClose }: { task: MyTaskRow | null; today: string; onClose: () => void }) {
  const phone = useIsPhone();
  const { user } = useAuth();
  const timer = useTaskTimer(user?.id);
  const { data, isLoading, isError } = useTaskDetail(task?.id ?? null);
  const late = task ? isLateDue(task.due_date, today) : false;
  const detail = data?.detail;
  const assetLink = detail?.asset_url || detail?.clickup_url || null;
  const hasFieldEntries = toFieldEntries(detail?.clickup_fields).length > 0;

  return (
    <DialogPrimitive.Root open={!!task} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Content
          data-testid="task-panel"
          data-variant={phone ? "sheet" : "modal"}
          className={cn(
            "fixed z-50 flex flex-col overflow-y-auto bg-card p-5 shadow-[var(--gos-shadow-raised)] focus:outline-none",
            phone
              ? "task-panel-sheet inset-x-0 bottom-0 max-h-[85vh] rounded-t-[var(--gos-radius-panel)]"
              : "task-panel-modal left-1/2 top-1/2 max-h-[88vh] w-[calc(100%-2rem)] max-w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-[var(--gos-radius-panel)] border border-border",
          )}
        >
          {task ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <DialogPrimitive.Title className="text-lg font-semibold leading-snug">{task.title}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-sm text-muted-foreground">
                    {task.client?.name || task.client_slug || "No client"} · <TaskStatus status={task.status} /> ·{" "}
                    <span className={late ? "font-medium text-[var(--gos-late)]" : undefined}>Due {shortDate(task.due_date)}</span>
                  </DialogPrimitive.Description>
                  <PhaseDots stage={task.status_info?.stage} />
                  <StatusPicker task={task} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {task.read_only ? null : (
                    <TimerToggle title={task.title} running={timer.runningTaskId === task.id} onToggle={() => timer.toggle(task.id)} />
                  )}
                  <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-secondary" aria-label="Close">
                    <X className="h-4 w-4" />
                  </DialogPrimitive.Close>
                </div>
              </div>

              {isLoading ? (
                <p className="text-sm text-muted-foreground" data-testid="task-panel-loading">Loading details…</p>
              ) : isError ? (
                <p className="text-sm text-[var(--gos-late)]" data-testid="task-panel-error">The details could not load. Close and open the task to try again.</p>
              ) : (
                <>
                  <Section title="Brief" testId="task-panel-brief">
                    <BriefEditor taskId={task.id} detail={detail ?? null} readOnly={!!task.read_only} />
                    {detail?.hooks && detail.hooks.length > 0 && !hasFieldEntries ? (
                      <ul className="list-disc pl-5 text-sm">
                        {detail.hooks.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Section>

                  <Section title="Details" testId="task-panel-details">
                    <TaskDetails taskId={task.id} detail={detail ?? null} readOnly={!!task.read_only} fallbackDue={task.due_date} />
                  </Section>

                  <Section title="ClickUp fields" testId="task-panel-fields">
                    <CustomFields taskId={task.id} detail={detail ?? null} readOnly={!!task.read_only} />
                  </Section>

                  {detail?.content_type?.trim() ? <PlaybookLink contentType={detail.content_type} /> : null}

                  <Section title="Files" testId="task-panel-files">
                    {assetLink ? (
                      <a href={assetLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline">
                        {detail?.asset_url ? "Open the asset" : "Open in ClickUp"}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground">No file link yet.</p>
                    )}
                  </Section>

                  <Section title="Versions" testId="task-panel-versions">
                    <CutReview taskId={task.id} viewer="staff" canAdd={!task.read_only} />
                  </Section>

                  <Section title="Comments" testId="task-panel-comments">
                    <Thread label="Internal" testId="task-panel-thread-internal" comments={(data?.comments ?? []).filter((c) => c.thread !== "client")} />
                    <Thread label="Client" testId="task-panel-thread-client" comments={(data?.comments ?? []).filter((c) => c.thread === "client")} />
                  </Section>

                  <Section title="QA checklist" testId="task-panel-qa">
                    {detail?.qa_checklist && detail.qa_checklist.length > 0 ? (
                      <ul className="space-y-1 text-sm">
                        {detail.qa_checklist.map((q, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{q.item ?? "Item"}</span>
                            <span className="text-muted-foreground">{q.result || "Not checked"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No QA checklist.</p>
                    )}
                  </Section>

                  <ExportChecklistSection taskId={task.id} readOnly={!!task.read_only} />

                  <Section title="Status history" testId="task-panel-history">
                    {(data?.history ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No status changes recorded.</p>
                    ) : (
                      <ol className="space-y-1 text-sm">
                        {data!.history.map((h) => (
                          <li key={h.id} className="flex justify-between gap-3">
                            <span>{h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}</span>
                            <span className="shrink-0 text-muted-foreground">{fmtDateTime(h.changed_at)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </Section>
                </>
              )}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
