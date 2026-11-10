// "Waiting on you" line at the top of a client's Overview, linking to the Content Pipeline. It reads the
// same cards the Content Pipeline board reads (usePipelineTasks with `own`, the client's own rows, the
// same query key, so the board does not fetch twice) and uses the same summary rule (waitingOnYou).
// Only mounted for a real client login. It changes no client data access.
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { usePipelineTasks } from "@/hooks/usePipelineTasks";
import { useRolePrefix } from "@/hooks/useRolePath";
import { waitingOnYou } from "@/lib/pipelineSummary";

export function WaitingOnYouLine() {
  const prefix = useRolePrefix();
  const { data, isLoading, isError } = usePipelineTasks(undefined, true);
  if (isLoading) return null;

  const to = `${prefix}/pipeline`;
  if (isError) {
    return (
      <p className="rounded-[8px] border border-input px-4 py-3 font-body text-[13px] text-muted-foreground" data-testid="waiting-on-you-line">
        We could not check what is waiting on you.{" "}
        <Link to={to} className="underline">Open your content pipeline</Link>
      </p>
    );
  }

  const { count, nextDueDate } = waitingOnYou(data);
  if (count === 0) {
    return (
      <p className="rounded-[8px] border border-input px-4 py-3 font-body text-[13px] text-muted-foreground" data-testid="waiting-on-you-line">
        Nothing is waiting on you right now.{" "}
        <Link to={to} className="underline">Open your content pipeline</Link>
      </p>
    );
  }
  return (
    <p className="rounded-[8px] border border-blue-500/40 bg-blue-500/5 px-4 py-3 font-body text-[14px] text-foreground" data-testid="waiting-on-you-line">
      <span className="font-medium">Waiting on you:</span> {count} {count === 1 ? "asset is" : "assets are"} ready for your review
      {nextDueDate ? `, the earliest due ${format(parseISO(nextDueDate), "MMM d")}` : ""}.{" "}
      <Link to={to} className="underline">Review in your content pipeline</Link>
    </p>
  );
}
