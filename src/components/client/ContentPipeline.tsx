import { useClientCycles, PipelineTask } from "@/hooks/usePipelineTasks";
import { parseISO, format } from "date-fns";
import { CloudOff, PackageOpen } from "lucide-react";
import { ClientEmptyState } from "@/components/client/ClientEmptyState";
import { Button } from "@/components/ui/button";
import { ViewAssetLink } from "@/components/client/ViewAssetLink";
import { waitingOnYou } from "@/lib/pipelineSummary";
import { fmtTimeAgo } from "@/lib/formatters";
import { dueDateLabel, lastSyncedAt } from "@/lib/pipelineBoard";
import {
  BOARD_STAGES,
  DELIVERED_STAGE,
  cardTitle,
  deliveredCountText,
  deliveredLine,
  formatCycleDates,
  groupByCycle,
  stageOf,
  type CycleEngagement,
  type CycleGroup,
  type CycleTask,
} from "@/lib/pipelineCycles";

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
 * string falls into no column and is omitted from the board.
 *
 * Since phase 5 the work is grouped by cycle (the month named in the task). The current
 * cycle is open and shows the five columns; earlier and later cycles are collapsed and
 * show a plain list: delivered items with their delivery day, then what is still in
 * progress. Delivered work stays after 30 days (see pipeline_delivered), so a finished
 * cycle keeps its tasks. If nothing is left to show, the section degrades to the same
 * calm onboarding state as a truly empty pipeline.
 */

/** "Updated 2 hours ago". Omitted when there are no rows (or no sync time). */
function LastUpdated({ tasks }: { tasks?: CycleTask[] }) {
  const ago = fmtTimeAgo(lastSyncedAt(tasks));
  if (!ago) return null;
  return (
    <p className="font-body text-[12px] text-muted-foreground -mt-3 mb-4" data-testid="pipeline-last-updated">
      Updated {ago}
    </p>
  );
}

/**
 * A single pipeline card in its stage column, framed in client language: a clean title, the
 * asset number and content type as a small label, and roughly when it lands (or when it was
 * delivered). No internal task IDs or strategist-only fields (US-007 AC2/AC3). The only link-out is
 * the "View asset" button, which opens the Air review link in a new tab and appears only when the
 * card has one.
 */
function TaskCard({ task, stage }: { task: CycleTask; stage: string }) {
  const { title, label } = cardTitle(task);
  const dueInfo = stage === DELIVERED_STAGE ? null : dueDateLabel(task.due_date, stage);
  // A delivered card shows the day it was delivered when that day is stored, and no date otherwise.
  const delivered = stage === DELIVERED_STAGE ? deliveredLine(task) : null;

  return (
    <div
      className="rounded-[8px] border border-input bg-background/40 px-3 py-2.5"
      data-testid="pipeline-task"
      data-stage={stage}
    >
      {label && (
        <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}

      <p className="font-body text-[13px] text-foreground mt-0.5">{title}</p>

      {dueInfo && (
        <p className={`font-body text-[11px] mt-1 ${dueInfo.urgent ? "text-blue-500 font-medium" : "text-muted-foreground"}`}>
          {dueInfo.text}
        </p>
      )}
      {delivered && <p className="font-body text-[11px] mt-1 text-muted-foreground">{delivered}</p>}
      <ViewAssetLink link={task.asset_link} className="mt-2" />
    </div>
  );
}

/**
 * "Waiting on you": how many cards are in Client Review and the earliest due
 * date among them. Read-only text, no buttons or links. Derived from the rows
 * the board already has.
 */
function WaitingOnYouSummary({ tasks }: { tasks: CycleTask[] }) {
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

/** Group a cycle's tasks into the board columns, preserving incoming order. */
function bucketByColumn(tasks: CycleTask[]): Record<string, CycleTask[]> {
  const buckets: Record<string, CycleTask[]> = {};
  for (const col of BOARD_STAGES) buckets[col] = [];
  for (const task of tasks) buckets[stageOf(task)]?.push(task);
  return buckets;
}

/** Horizontal-scroll kanban board for one cycle: one column per stage. */
function CycleBoard({ tasks }: { tasks: CycleTask[] }) {
  const columns = bucketByColumn(tasks);
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
      {BOARD_STAGES.map((col) => {
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
  );
}

/** One timeline row: what was made, and the day it was delivered when that day is stored. */
function TimelineRow({ task, delivered }: { task: CycleTask; delivered: boolean }) {
  const { title, label } = cardTitle(task);
  const when = delivered ? deliveredLine(task) : `In ${stageOf(task)}`;
  return (
    <li className="flex items-start gap-3 py-2" data-testid="pipeline-timeline-row" data-delivered={delivered ? "yes" : "no"}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${delivered ? "bg-green-500" : "bg-muted-foreground/40"}`} />
      <div className="min-w-0 flex-1">
        {label && <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>}
        <p className="font-body text-[13px] text-foreground">{title}</p>
      </div>
      <ViewAssetLink link={task.asset_link} className="shrink-0" />
      {when && <span className="shrink-0 font-body text-[11px] text-muted-foreground">{when}</span>}
    </li>
  );
}

/** Delivered first, oldest delivery first (undated last), then what is still in progress. */
function CycleTimeline({ tasks }: { tasks: CycleTask[] }) {
  const done = tasks
    .filter((t) => stageOf(t) === DELIVERED_STAGE)
    .sort((a, b) => (a.delivered_at ?? "9999").localeCompare(b.delivered_at ?? "9999"));
  const open = tasks.filter((t) => stageOf(t) !== DELIVERED_STAGE);
  return (
    <div>
      {done.length > 0 && (
        <ul className="divide-y divide-border/60" aria-label="Delivered">
          {done.map((t) => <TimelineRow key={t.id} task={t} delivered />)}
        </ul>
      )}
      {open.length > 0 && (
        <>
          <p className="font-label text-[10px] uppercase tracking-wide text-muted-foreground mt-3 mb-1">Still in progress</p>
          <ul className="divide-y divide-border/60" aria-label="Still in progress">
            {open.map((t) => <TimelineRow key={t.id} task={t} delivered={false} />)}
          </ul>
        </>
      )}
    </div>
  );
}

/** The header facts of a cycle, shared by the page and the landing summary. */
export function CycleProgress({ group }: { group: CycleGroup }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden" role="progressbar"
      aria-label={`${group.label}: ${deliveredCountText(group)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={group.percent}>
      <div className="h-full rounded-full bg-green-500" style={{ width: `${group.percent}%` }} />
    </div>
  );
}

function CycleSection({ group }: { group: CycleGroup }) {
  const dates = formatCycleDates(group.dates);
  const notes = [
    group.waiting > 0 ? `${group.waiting} waiting on you` : null,
    group.status !== "current" && group.inProgress > 0 && group.waiting < group.inProgress
      ? `${group.inProgress - group.waiting} still in progress`
      : null,
  ].filter(Boolean);

  return (
    <details
      open={group.defaultOpen}
      className="group rounded-[8px] border border-input bg-background/30 mb-4"
      data-testid="pipeline-cycle"
      data-cycle={group.key}
      data-status={group.status}
    >
      <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-2">
            <h3 className="font-heading text-[16px] text-foreground" data-testid="pipeline-cycle-label">{group.label}</h3>
            {group.status === "current" && group.key !== "other" && (
              <span className="font-label text-[10px] uppercase tracking-wide text-green-600">Current</span>
            )}
            {group.status === "upcoming" && (
              <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground">Coming up</span>
            )}
          </div>
          <span className="font-body text-[13px] text-foreground" data-testid="pipeline-cycle-count">{deliveredCountText(group)}</span>
        </div>
        {(dates || notes.length > 0) && (
          <p className="font-body text-[12px] text-muted-foreground mt-0.5" data-testid="pipeline-cycle-meta">
            {[dates, ...notes].filter(Boolean).join(" · ")}
          </p>
        )}
        <div className="mt-2">
          <CycleProgress group={group} />
        </div>
      </summary>
      <div className="px-4 pb-4 pt-1">
        {group.status === "current" ? <CycleBoard tasks={group.tasks} /> : <CycleTimeline tasks={group.tasks} />}
      </div>
    </details>
  );
}

/**
 * Pure, READ-ONLY presentational view of the content pipeline (US-007).
 *
 * Renders a transparency-only "what we're making next" surface, grouped by cycle. There are NO
 * comment / approve / request-changes / upload affordances and no link-out /
 * click-to-open interaction controls on the board (out of scope for Phase C,
 * AC2). The only controls are the cycle headers that open and close a cycle. Loading shows
 * placeholders. A failed load shows its own message with a Try again button, so a client never
 * mistakes a load problem for an empty pipeline. Nothing in production degrades to a friendly
 * onboarding state (AC4).
 *
 * Takes its data as plain props so it can be rendered (and tested) without a
 * QueryClient. The exported `ContentPipeline` wraps it with `useClientCycles`.
 */
export function ContentPipelineView({
  tasks,
  isLoading,
  isError,
  onRetry,
  engagements,
  pastCyclesFailed,
  now,
}: {
  tasks?: PipelineTask[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  engagements?: CycleEngagement[];
  /** The earlier-cycles list failed to load while the board did load. */
  pastCyclesFailed?: boolean;
  now?: Date;
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

  // Group into cycles. Unmapped/drifted-stage tasks fall out here, so a pipeline of
  // only-unmapped work reads as empty for board purposes.
  const groups = groupByCycle(tasks ?? [], engagements ?? [], now);

  // AC4: nothing synced, or only completed/unmapped work, degrades to the calm,
  // first-class onboarding state (US-006).
  if (groups.length === 0) {
    return (
      <div className="glass-panel p-7" data-testid="pipeline-empty">
        <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
        <LastUpdated tasks={tasks} />
        <ClientEmptyState
          icon={PackageOpen}
          heading="Nothing in production right now. Your strategist will queue up the next round soon."
          subcopy="When new creative is planned and underway, you'll see exactly what's coming next right here."
        />
        {pastCyclesFailed && (
          <p className="mt-3 text-center font-body text-[12px] text-muted-foreground" data-testid="pipeline-past-failed">
            Earlier cycles could not load just now. Refresh in a moment to try again.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="glass-panel p-7" data-testid="content-pipeline">
      <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
      <LastUpdated tasks={tasks} />

      <WaitingOnYouSummary tasks={tasks ?? []} />

      {groups.map((group) => (
        <CycleSection key={group.key} group={group} />
      ))}

      {pastCyclesFailed && (
        <p className="font-body text-[12px] text-muted-foreground" data-testid="pipeline-past-failed">
          Earlier cycles could not load just now. Refresh in a moment to try again.
        </p>
      )}
    </div>
  );
}

/**
 * Read-only client view of in-flight + upcoming creative, by cycle (US-007, phase 5). Self-fetches
 * via `useClientCycles` and delegates rendering to `ContentPipelineView`.
 * `own` loads the signed-in client's own rows (see `usePipelineTasks`).
 */
export function ContentPipeline({ accountId, own }: { accountId?: string; own?: boolean }) {
  const { tasks, engagements, isLoading, isError, pastCyclesFailed, refetch } = useClientCycles(accountId, own);
  return (
    <ContentPipelineView
      tasks={tasks}
      engagements={engagements}
      pastCyclesFailed={pastCyclesFailed}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
    />
  );
}
