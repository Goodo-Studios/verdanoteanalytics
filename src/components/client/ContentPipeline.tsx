import { usePipelineTasks, PipelineTask } from "@/hooks/usePipelineTasks";
import { parseISO, format } from "date-fns";
import { CloudOff, PackageOpen } from "lucide-react";
import { ClientEmptyState } from "@/components/client/ClientEmptyState";
import { Button } from "@/components/ui/button";
import { waitingOnYou } from "@/lib/pipelineSummary";
import { fmtTimeAgo } from "@/lib/formatters";
import { dueDateLabel, lastSyncedAt } from "@/lib/pipelineBoard";

const STAGE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  "Preparing Content": { color: "text-amber-500", bg: "bg-amber-500", label: "Preparing Content" },
  Production: { color: "text-emerald-500", bg: "bg-emerald-500", label: "Production" },
  Editing: { color: "text-violet-500", bg: "bg-violet-500", label: "Editing" },
  "Client Review": { color: "text-blue-500", bg: "bg-blue-500", label: "Client Review" },
  "Ready to Launch": { color: "text-green-500", bg: "bg-green-500", label: "Ready to Launch" },
};

/**
 * The board shows the delivery workflow as five client-facing columns (set with the
 * operator 2026-06-02). The display stage on each task is computed upstream by
 * the sync-clickup-tasks edge function's STAGE_MAP, so this component just buckets
 * by the already-mapped value. A task whose stage is null defaults to the first
 * column ("Preparing Content"); a task whose stage is any unmapped/drifted raw
 * string falls into no column and is omitted from the board. "Ready to Launch"
 * IS a column, but the sync only feeds it recently-shipped work, so it stays a
 * "just launched" lane rather than an all-time archive. If bucketing leaves
 * nothing to show, the section degrades to the same calm onboarding state as a
 * truly empty pipeline.
 */
const COLUMN_ORDER = [
  "Preparing Content",
  "Production",
  "Editing",
  "Client Review",
  "Ready to Launch",
] as const;

/** "Updated 2 hours ago". Omitted when there are no rows (or no sync time). */
function LastUpdated({ tasks }: { tasks?: PipelineTask[] }) {
  const ago = fmtTimeAgo(lastSyncedAt(tasks));
  if (!ago) return null;
  return (
    <p className="font-body text-[12px] text-muted-foreground -mt-3 mb-4" data-testid="pipeline-last-updated">
      Updated {ago}
    </p>
  );
}

/**
 * A single pipeline card in its stage column, framed in client language: what it
 * is (content type) and roughly when it lands. Intentionally READ-ONLY: no
 * click handler, no link-out, no internal task IDs or strategist-only fields
 * (US-007 AC2/AC3). No link to the task in ClickUp is stored or surfaced. The
 * card is a plain <div> with no interactive affordances.
 */
function TaskCard({ task, stage }: { task: PipelineTask; stage: string }) {
  const dueInfo = dueDateLabel(task.due_date, stage);

  return (
    <div
      className="rounded-[8px] border border-input bg-background/40 px-3 py-2.5"
      data-testid="pipeline-task"
      data-stage={stage}
    >
      {task.content_type && (
        <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground">
          {task.content_type}
        </span>
      )}

      <p className="font-body text-[13px] text-foreground mt-0.5">
        {task.task_name || "Untitled task"}
      </p>

      {dueInfo && (
        <p className={`font-body text-[11px] mt-1 ${dueInfo.urgent ? "text-blue-500 font-medium" : "text-muted-foreground"}`}>
          {dueInfo.text}
        </p>
      )}
    </div>
  );
}

/**
 * "Waiting on you": how many cards are in Client Review and the earliest due
 * date among them. Read-only text, no buttons or links. Derived from the rows
 * the board already has.
 */
function WaitingOnYouSummary({ tasks }: { tasks: PipelineTask[] }) {
  const { count, nextDueDate } = waitingOnYou(tasks);

  if (count === 0) {
    return (
      <div
        className="rounded-[8px] border border-input bg-background/40 px-4 py-3 mb-5"
        data-testid="pipeline-waiting-on-you"
      >
        <p className="font-body text-[13px] text-muted-foreground">
          Nothing is waiting on you right now.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-[8px] border border-blue-500/40 bg-blue-500/5 px-4 py-3 mb-5"
      data-testid="pipeline-waiting-on-you"
    >
      <p className="font-label text-[10px] uppercase tracking-wide font-medium text-blue-500">
        Waiting on you
      </p>
      <p className="font-body text-[14px] text-foreground mt-0.5">
        {count} {count === 1 ? "asset is" : "assets are"} ready for your review.
      </p>
      {nextDueDate && (
        <p className="font-body text-[12px] text-muted-foreground mt-0.5">
          Earliest due date: {format(parseISO(nextDueDate), "MMM d")}
        </p>
      )}
    </div>
  );
}

/** Group tasks into the active board columns, preserving incoming order. */
function bucketByColumn(tasks: PipelineTask[]): Record<string, PipelineTask[]> {
  const buckets: Record<string, PipelineTask[]> = {};
  for (const col of COLUMN_ORDER) buckets[col] = [];
  for (const task of tasks) {
    const stage = task.stage || "Preparing Content";
    if (buckets[stage]) buckets[stage].push(task);
    // Any unmapped/drifted stage falls into no column → omitted from the board.
  }
  return buckets;
}

/**
 * Pure, READ-ONLY presentational view of the content pipeline (US-007).
 *
 * Renders a transparency-only "what we're making next" surface. There are NO
 * comment / approve / request-changes / upload affordances and no link-out /
 * click-to-open interaction controls on the board (out of scope for Phase C,
 * AC2). Loading shows placeholders. A failed load shows its own message with a
 * Try again button, so a client never mistakes a load problem for an empty
 * pipeline. Nothing in production degrades to a friendly onboarding state (AC4).
 *
 * Takes its data as plain props so it can be rendered (and tested) without a
 * QueryClient. The exported `ContentPipeline` wraps it with `usePipelineTasks`.
 */
export function ContentPipelineView({
  tasks,
  isLoading,
  isError,
  onRetry,
}: {
  tasks?: PipelineTask[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}) {
  if (isLoading) {
    return (
      <div className="glass-panel p-7">
        <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-[6px] bg-muted/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // A failed load gets its own state. It must not look like an empty pipeline.
  if (isError) {
    return (
      <div className="glass-panel p-7" data-testid="pipeline-error">
        <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
        <ClientEmptyState
          icon={CloudOff}
          heading="We couldn't load your pipeline just now"
          subcopy="This one is on our side. Please try again in a moment."
        />
        {onRetry && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Bucket into the board columns. Unmapped/drifted-stage tasks fall out here,
  // so a pipeline of only-unmapped work reads as empty for board purposes.
  const columns = bucketByColumn(tasks ?? []);
  const hasBoardTasks = COLUMN_ORDER.some((col) => columns[col].length > 0);

  // AC4: nothing synced, or only completed/unmapped work, degrades to the calm,
  // first-class onboarding state (US-006).
  if (!hasBoardTasks) {
    return (
      <div className="glass-panel p-7" data-testid="pipeline-empty">
        <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
        <LastUpdated tasks={tasks} />
        <ClientEmptyState
          icon={PackageOpen}
          heading="Nothing in production right now. Your strategist will queue up the next round soon."
          subcopy="When new creative is planned and underway, you'll see exactly what's coming next right here."
        />
      </div>
    );
  }

  return (
    <div className="glass-panel p-7" data-testid="content-pipeline">
      <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
      <LastUpdated tasks={tasks} />

      <WaitingOnYouSummary tasks={tasks ?? []} />

      {/* Horizontal-scroll kanban board: one column per active stage. */}
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {COLUMN_ORDER.map((col) => {
          const cfg = STAGE_CONFIG[col];
          const colTasks = columns[col];
          return (
            <div key={col} className="flex-shrink-0 w-[240px] snap-start">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className={`flex items-center gap-1.5 font-label text-[10px] uppercase tracking-wide font-medium ${cfg.color}`}>
                  <span className={`h-2 w-2 rounded-full ${cfg.bg}`} />
                  {cfg.label}
                </span>
                <span className="font-label text-[10px] tracking-wide text-muted-foreground">
                  {colTasks.length}
                </span>
              </div>

              <div className="space-y-2">
                {colTasks.length > 0 ? (
                  colTasks.map((t) => <TaskCard key={t.id} task={t} stage={col} />)
                ) : (
                  <p className="font-body text-[12px] text-muted-foreground/60 px-3 py-2">
                    Nothing here yet
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Read-only client view of in-flight + upcoming creative (US-007). Self-fetches
 * via `usePipelineTasks` and delegates rendering to `ContentPipelineView`.
 * `own` loads the signed-in client's own rows (see `usePipelineTasks`).
 */
export function ContentPipeline({ accountId, own }: { accountId?: string; own?: boolean }) {
  const { data: tasks, isLoading, isError, refetch } = usePipelineTasks(accountId, own);
  return (
    <ContentPipelineView
      tasks={tasks}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
    />
  );
}
