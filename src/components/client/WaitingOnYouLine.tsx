// The top of a client's Overview (phase 5): the "Waiting on you" line, then the current cycle count
// ("November: 8 of 12 delivered" with a progress bar), each linking to the Content Pipeline. It reads the
// same cards the Content Pipeline board reads (useClientCycles with `own`: the client's own rows, the
// same query keys, so the board does not fetch twice) and uses the same rules (waitingOnYou, groupByCycle).
// Only mounted for a real client login. It changes no client data access.
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { useClientCycles } from "@/hooks/usePipelineTasks";
import { useOwnDecisions } from "@/hooks/useClientDecisions";
import { decidedTaskIds } from "@/lib/clientDecisions";
import { useRolePrefix } from "@/hooks/useRolePath";
import { waitingOnYou } from "@/lib/pipelineSummary";
import { deliveredCountText, formatCycleDates, groupByCycle } from "@/lib/pipelineCycles";
import { CycleProgress } from "@/components/client/ContentPipeline";

export function WaitingOnYouLine() {
  const prefix = useRolePrefix();
  const { tasks, engagements, isLoading, isError, pastCyclesFailed } = useClientCycles(undefined, true);
  const decisions = useOwnDecisions(true);
  if (isLoading || decisions.isLoading) return null;

  const to = `${prefix}/pipeline`;
  if (isError) {
    return (
      <p className="rounded-[8px] border border-input px-4 py-3 font-body text-[13px] text-muted-foreground" data-testid="waiting-on-you-line">
        We could not check what is waiting on you.{" "}
        <Link to={to} className="underline">Open your content pipeline</Link>
      </p>
    );
  }

  // Cards the client has already answered no longer wait on the client. If the answers could not load, every
  // card in Client Review is counted rather than hiding one.
  const answeredIds = decisions.isError ? undefined : decidedTaskIds(decisions.data);
  const { count, nextDueDate, answered } = waitingOnYou(tasks, answeredIds);
  // The current cycle count needs the earlier-delivered list too (a cycle can run past 30 days), so it is
  // left out rather than shown too low when that list could not load.
  const current = pastCyclesFailed ? undefined : groupByCycle(tasks, engagements, new Date(), answeredIds).find((g) => g.status === "current" && g.key !== "other");
  const dates = current ? formatCycleDates(current.dates) : null;

  return (
    <div className="space-y-3" data-testid="client-landing">
      {count === 0 ? (
        <p className="rounded-[8px] border border-input px-4 py-3 font-body text-[13px] text-muted-foreground" data-testid="waiting-on-you-line">
          {answered > 0 ? "Thank you. Everything you have reviewed is with our team now." : "Nothing is waiting on you right now."}{" "}
          <Link to={to} className="underline">Open your content pipeline</Link>
        </p>
      ) : (
        <p className="rounded-[8px] border border-blue-500/40 bg-blue-500/5 px-4 py-3 font-body text-[14px] text-foreground" data-testid="waiting-on-you-line">
          <span className="font-medium">Waiting on you:</span> {count} {count === 1 ? "asset is" : "assets are"} ready for your review
          {nextDueDate ? `, the earliest due ${format(parseISO(nextDueDate), "MMM d")}` : ""}.{" "}
          <Link to={to} className="underline">Review in your content pipeline</Link>
        </p>
      )}
      {current && (
        <div className="rounded-[8px] border border-input px-4 py-3" data-testid="landing-cycle">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-body text-[14px] text-foreground">
              <span className="font-medium">{current.label}</span>
              {dates ? <span className="text-muted-foreground">{` · ${dates}`}</span> : null}
            </p>
            <p className="font-body text-[14px] text-foreground" data-testid="landing-cycle-count">{deliveredCountText(current)}</p>
          </div>
          <div className="mt-2">
            <CycleProgress group={current} />
          </div>
          <p className="mt-2 font-body text-[12px] text-muted-foreground">
            <Link to={to} className="underline">See every cycle in your content pipeline</Link>
          </p>
        </div>
      )}
    </div>
  );
}
