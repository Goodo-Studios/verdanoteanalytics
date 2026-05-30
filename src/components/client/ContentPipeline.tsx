import { useCodaTasks, CodaTask } from "@/hooks/useCodaTasks";
import { differenceInDays, parseISO, format } from "date-fns";
import { CheckCircle2 } from "lucide-react";

const STAGE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  Planning: { color: "text-amber-500", bg: "bg-amber-500", label: "Planning" },
  Production: { color: "text-emerald-500", bg: "bg-emerald-500", label: "Production" },
  Review: { color: "text-indigo-500", bg: "bg-indigo-500", label: "Review" },
  "Your Review": { color: "text-blue-500", bg: "bg-blue-500", label: "Your Review" },
  Complete: { color: "text-muted-foreground", bg: "bg-muted-foreground", label: "Complete" },
};

const DEFAULT_STAGE_CONFIG = { color: "text-muted-foreground", bg: "bg-muted-foreground", label: "Other" };

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
 * A single pipeline item, framed in client language: what it is (content type),
 * what stage it's at, and roughly when it lands. Intentionally READ-ONLY — no
 * click handler, no link-out, no internal task IDs or strategist-only fields
 * (US-007 AC2/AC3). The Coda URL on the task is deliberately NOT surfaced.
 */
function TaskRow({ task }: { task: CodaTask }) {
  const stage = task.stage || "Planning";
  const config = STAGE_CONFIG[stage] || DEFAULT_STAGE_CONFIG;
  const isComplete = stage === "Complete";
  const dueInfo = !isComplete ? dueDateLabel(task.due_date) : null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-[6px]">
      {/* Stage dot */}
      <div className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${config.bg}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-label text-[10px] uppercase tracking-wide font-medium ${config.color}`}>
            {config.label}
          </span>
          {task.content_type && (
            <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground">
              · {task.content_type}
            </span>
          )}
        </div>

        <p className="font-body text-[14px] text-foreground mt-0.5 truncate">
          {isComplete && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />}
          {task.task_name || task.brief || "Untitled task"}
        </p>

        {dueInfo && (
          <p className={`font-body text-[12px] mt-0.5 ${dueInfo.urgent ? "text-destructive font-medium" : "text-muted-foreground"}`}>
            {dueInfo.urgent && "⚠️ "}{dueInfo.text}
          </p>
        )}
      </div>
    </div>
  );
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

  // AC4/AC5: no data for this account — whether the fetch failed or the
  // pipeline is simply empty — degrades to the same calm onboarding state
  // instead of surfacing an error.
  if (isError || !tasks?.length) {
    return (
      <div className="glass-panel p-7">
        <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
        <p className="font-body text-[14px] text-muted-foreground italic">
          Nothing in production yet — new creative will show up here as we plan and build it.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel p-7">
      <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>

      <div className="space-y-1">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-5 pt-4 border-t border-input">
        {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
          <span key={key} className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${cfg.bg}`} />
            {cfg.label}
          </span>
        ))}
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
