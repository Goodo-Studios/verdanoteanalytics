import { useCodaTasks, CodaTask } from "@/hooks/useCodaTasks";
import { differenceInDays, parseISO, format } from "date-fns";
import { ExternalLink, CheckCircle2 } from "lucide-react";

const STAGE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  Planning: { color: "text-amber-500", bg: "bg-amber-500", label: "Planning" },
  Production: { color: "text-emerald-500", bg: "bg-emerald-500", label: "Production" },
  Review: { color: "text-indigo-500", bg: "bg-indigo-500", label: "Review" },
  "Your Review": { color: "text-blue-500", bg: "bg-blue-500", label: "Your Review" },
  Complete: { color: "text-muted-foreground", bg: "bg-muted-foreground", label: "Complete" },
};

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

function TaskRow({ task }: { task: CodaTask }) {
  const stage = task.stage || "Planning";
  const config = STAGE_CONFIG[stage] || STAGE_CONFIG.Planning;
  const isComplete = stage === "Complete";
  const dueInfo = !isComplete ? dueDateLabel(task.due_date) : null;

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-3 rounded-[6px] transition-colors ${
        task.coda_url ? "cursor-pointer hover:bg-accent/50" : ""
      }`}
      onClick={() => {
        if (task.coda_url) window.open(task.coda_url, "_blank", "noopener");
      }}
    >
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

      {task.coda_url && (
        <ExternalLink className="h-3.5 w-3.5 mt-1.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </div>
  );
}

export function ContentPipeline({ accountId }: { accountId: string }) {
  const { data: tasks, isLoading } = useCodaTasks(accountId);

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

  if (!tasks?.length) {
    return (
      <div className="glass-panel p-7">
        <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
        <p className="font-body text-[14px] text-muted-foreground italic">No active content in pipeline</p>
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
