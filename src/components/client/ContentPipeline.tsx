import { useCodaTasks, CodaTask } from "@/hooks/useCodaTasks";
import { differenceInDays, parseISO, format } from "date-fns";
import { PackageOpen } from "lucide-react";
import { ClientEmptyState } from "@/components/client/ClientEmptyState";

const STAGE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  Planning: { color: "text-amber-500", bg: "bg-amber-500", label: "Planning" },
  Production: { color: "text-emerald-500", bg: "bg-emerald-500", label: "Production" },
  Review: { color: "text-indigo-500", bg: "bg-indigo-500", label: "Review" },
  "Your Review": { color: "text-blue-500", bg: "bg-blue-500", label: "Your Review" },
  Complete: { color: "text-muted-foreground", bg: "bg-muted-foreground", label: "Complete" },
};

/**
 * The board renders only forward-looking, active stages as columns. "Complete"
 * is intentionally NOT a column — the pipeline answers "what are we making
 * next", not "what's done". A task whose stage is null defaults to Planning
 * (first active stage); a task whose stage is "Complete" or any unmapped/drifted
 * raw string falls into no column and is omitted from the board. If that leaves
 * nothing to show, the section degrades to the same calm onboarding state as a
 * truly empty pipeline.
 */
const COLUMN_ORDER = ["Planning", "Production", "Review", "Your Review"] as const;

function dueDateLabel(dueDateStr: string | null): { text: string; urgent: boolean } | null {
  if (!dueDateStr) return null;
  const due = parseISO(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = differenceInDays(due, today);

  if (diff < 0) return { text: `Overdue by ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? "s" : ""}`, urgent: true };
  if (diff === 0) return { text: "Due today", urgent: true };
  if (diff === 1) return { text: "Due tomorrow", urgent: false };
  if (diff <= 5) return { text: `Due in ${diff} days`, urgent: false };
  return { text: `Due ${format(due, "MMM d")}`, urgent: false };
}

/**
 * A single pipeline card in its stage column, framed in client language: what it
 * is (content type) and roughly when it lands. Intentionally READ-ONLY — no
 * click handler, no link-out, no internal task IDs or strategist-only fields
 * (US-007 AC2/AC3). The Coda URL on the task is deliberately NOT surfaced. The
 * card is a plain <div> with no interactive affordances.
 */
function TaskCard({ task, stage }: { task: CodaTask; stage: string }) {
  const dueInfo = dueDateLabel(task.due_date);

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
        {task.task_name || task.brief || "Untitled task"}
      </p>

      {dueInfo && (
        <p className={`font-body text-[11px] mt-1 ${dueInfo.urgent ? "text-destructive font-medium" : "text-muted-foreground"}`}>
          {dueInfo.urgent && "⚠️ "}{dueInfo.text}
        </p>
      )}
    </div>
  );
}

/** Group tasks into the active board columns, preserving incoming order. */
function bucketByColumn(tasks: CodaTask[]): Record<string, CodaTask[]> {
  const buckets: Record<string, CodaTask[]> = {};
  for (const col of COLUMN_ORDER) buckets[col] = [];
  for (const task of tasks) {
    const stage = task.stage || "Planning";
    if (buckets[stage]) buckets[stage].push(task);
    // "Complete" + any unmapped/drifted stage falls into no column → omitted.
  }
  return buckets;
}

/**
 * Pure, READ-ONLY presentational view of the content pipeline (US-007).
 *
 * Renders a transparency-only "what we're making next" surface. There are NO
 * comment / approve / request-changes / upload affordances and no link-out /
 * click-to-open interaction controls (out of scope for Phase C, AC2). When data
 * is unavailable — loading, fetch error, or simply nothing in production — the
 * section degrades to a friendly empty/onboarding state rather than erroring
 * (AC4/AC5), consistent with the rest of the client home.
 *
 * Takes its data as plain props so it can be rendered (and tested) without a
 * QueryClient. The exported `ContentPipeline` wraps it with `useCodaTasks`.
 */
export function ContentPipelineView({
  tasks,
  isLoading,
  isError,
}: {
  tasks?: CodaTask[];
  isLoading?: boolean;
  isError?: boolean;
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

  // Bucket into the active board columns. "Complete"/unmapped tasks fall out
  // here, so a pipeline of only-finished work reads as empty for board purposes.
  const columns = bucketByColumn(tasks ?? []);
  const hasBoardTasks = COLUMN_ORDER.some((col) => columns[col].length > 0);

  // AC4/AC5: no data for this account — fetch failed, nothing synced, or only
  // completed/unmapped work — degrades to the same calm, first-class onboarding
  // state (US-006) instead of surfacing an error.
  if (isError || !hasBoardTasks) {
    return (
      <div className="glass-panel p-7" data-testid="pipeline-empty">
        <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
        <ClientEmptyState
          icon={PackageOpen}
          heading="Nothing in production right now — your strategist will queue the next round"
          subcopy="When new creative is planned and underway, you&rsquo;ll see exactly what&rsquo;s coming next right here."
        />
      </div>
    );
  }

  return (
    <div className="glass-panel p-7" data-testid="content-pipeline">
      <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>

      {/* Horizontal-scroll kanban board — one column per active stage. */}
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
 * via `useCodaTasks` and delegates rendering to `ContentPipelineView`.
 */
export function ContentPipeline({ accountId }: { accountId: string }) {
  const { data: tasks, isLoading, isError } = useCodaTasks(accountId);
  return <ContentPipelineView tasks={tasks} isLoading={isLoading} isError={isError} />;
}
