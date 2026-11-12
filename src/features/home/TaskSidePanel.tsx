// The task side panel on My work (OS-009). Opens over the list without leaving the page: a panel
// on the right on wider screens, a bottom sheet on phones. Radix Dialog gives the focus trap,
// Escape to close and the aria labelling. Details load only when it opens (useTaskDetail).
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/components/page-kit";
import { useIsPhone, useTaskDetail, type TaskComment } from "@/hooks/useMyWork";
import { shortDate } from "@/lib/homeData";
import { isLateDue, type MyTaskRow } from "@/lib/myWork";
import { PhaseDots } from "./PhaseDots";

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

export function TaskSidePanel({ task, today, onClose }: { task: MyTaskRow | null; today: string; onClose: () => void }) {
  const phone = useIsPhone();
  const { data, isLoading, isError } = useTaskDetail(task?.id ?? null);
  const late = task ? isLateDue(task.due_date, today) : false;
  const detail = data?.detail;
  const assetLink = detail?.asset_url || detail?.clickup_url || null;

  return (
    <DialogPrimitive.Root open={!!task} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/10" />
        <DialogPrimitive.Content
          data-testid="task-panel"
          data-variant={phone ? "sheet" : "side"}
          className={cn(
            "fixed z-50 flex flex-col overflow-y-auto bg-card p-5 shadow-[var(--gos-shadow-raised)] focus:outline-none",
            phone
              ? "task-panel-sheet inset-x-0 bottom-0 max-h-[85vh] rounded-t-[var(--gos-radius-panel)]"
              : "task-panel-side inset-y-0 right-0 w-full max-w-[32rem] border-l border-border",
          )}
        >
          {task ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <DialogPrimitive.Title className="text-lg font-semibold leading-snug">{task.title}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-sm text-muted-foreground">
                    {task.client?.name || task.client_slug || "No client"} · {task.status} ·{" "}
                    <span className={late ? "font-medium text-[var(--gos-late)]" : undefined}>Due {shortDate(task.due_date)}</span>
                  </DialogPrimitive.Description>
                  <PhaseDots stage={task.status_info?.stage} />
                </div>
                <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-secondary" aria-label="Close">
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>

              {isLoading ? (
                <p className="text-sm text-muted-foreground" data-testid="task-panel-loading">Loading details…</p>
              ) : isError ? (
                <p className="text-sm text-[var(--gos-late)]" data-testid="task-panel-error">The details could not load. Close and open the task to try again.</p>
              ) : (
                <>
                  <Section title="Brief" testId="task-panel-brief">
                    {detail?.brief || detail?.description ? (
                      <p className="whitespace-pre-wrap break-words text-sm">{detail.brief || detail.description}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No brief yet.</p>
                    )}
                    {detail?.hooks && detail.hooks.length > 0 ? (
                      <ul className="list-disc pl-5 text-sm">
                        {detail.hooks.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Section>

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
