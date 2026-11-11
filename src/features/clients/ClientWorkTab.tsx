// Client hub, Work tab: the ClickUp content pipeline for this client, staff view. It reads
// pipeline_tasks by the client (client_slug), not by ad account, so a client with no ad account, or
// with several, still has its board. The client-facing board (/pipeline for a client login) is a
// different component with the client's wording.
import { Link } from "react-router-dom";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { fmtTimeAgo } from "@/lib/formatters";
import { bucketWork, WORK_COLUMNS } from "@/lib/clientWork";
import { useClientWork } from "@/hooks/useClientWork";
import { useStaffDecisions } from "@/hooks/useClientDecisions";
import { currentDecision, decidedTaskIds, isNewDecision, staffDecisionText } from "@/lib/clientDecisions";
import { dueDateLabel, lastSyncedAt } from "@/lib/pipelineBoard";
import { CLIENT_REVIEW_STAGE, waitingOnYou } from "@/lib/pipelineSummary";
import { ViewAssetLink } from "@/components/client/ViewAssetLink";
import { PageHeader, PageShell, LoadingState, ErrorState, EmptyState } from "@/components/page-kit";

export default function ClientWorkTab() {
  const prefix = useRolePrefix();
  const { selectedSlug, selectedClient } = useClientSelection();
  const { data: tasks, isLoading, isError, refetch } = useClientWork(selectedSlug);
  const decisions = useStaffDecisions(selectedSlug || undefined);
  const name = selectedClient?.name ?? selectedSlug;

  if (!selectedSlug) return null;

  const columns = bucketWork(tasks ?? []);
  const shown = WORK_COLUMNS.reduce((n, c) => n + columns[c].length, 0);
  const waiting = waitingOnYou(tasks, decisions.isError ? undefined : decidedTaskIds(decisions.data));
  const updated = fmtTimeAgo(lastSyncedAt(tasks));

  return (
    <PageShell wide data-testid="client-work">
      <PageHeader title="Work" description={`The ClickUp content pipeline for ${name}. Cards fill from this client's ClickUp folder.`} />
      {isLoading ? (
        <LoadingState label="Loading the work board" />
      ) : isError ? (
        <ErrorState
          message="The work board could not load, so this is not the same as an empty board."
          onRetry={() => void refetch()}
        />
      ) : shown === 0 ? (
        <div data-testid="client-work-empty">
          <EmptyState
            title={`Nothing in production for ${name}`}
            description={
              <>
                If ClickUp has cards for this client, check that its ClickUp folder is linked on the{" "}
                <Link className="underline" to={`${prefix}/clients/${encodeURIComponent(selectedSlug)}/setup`}>Setup tab</Link>.
              </>
            }
          />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="client-work-summary">
            {shown} {shown === 1 ? "card" : "cards"}. {waiting.count === 0 ? "None are waiting on the client." : `${waiting.count} waiting on the client.`}
            {waiting.answered > 0 ? ` ${waiting.answered} answered by the client.` : ""}
            {updated ? ` Updated ${updated}.` : ""}
          </p>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {WORK_COLUMNS.map((col) => (
              <section key={col} aria-label={col} className="w-[240px] flex-shrink-0 rounded-lg bg-muted/40 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold">
                  <span>{col}</span>
                  <span className="text-muted-foreground">{columns[col].length}</span>
                </h2>
                <ul className="space-y-2">
                  {columns[col].length === 0 ? <li className="px-2 py-1 text-xs text-muted-foreground">Nothing here</li> : null}
                  {columns[col].map((t) => {
                    const due = dueDateLabel(t.due_date, col);
                    return (
                      <li key={t.id} className="rounded-md border border-input bg-background px-3 py-2" data-testid="client-work-card" data-stage={col}>
                        {t.content_type ? <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.content_type}</p> : null}
                        <p className="text-[13px]">{t.task_name || "Untitled task"}</p>
                        {due ? <p className={`mt-1 text-[11px] ${due.urgent && col === CLIENT_REVIEW_STAGE ? "font-medium text-blue-600" : "text-muted-foreground"}`}>{due.text}</p> : null}
                        <ViewAssetLink link={t.asset_link} className="mt-2" />
                        {(() => {
                          const d = currentDecision(decisions.data, t.clickup_task_id);
                          if (!d) return null;
                          return (
                            <p
                              className={`mt-2 rounded px-2 py-1 text-[11px] ${d.decision === "approved" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}
                              data-testid="client-work-decision"
                              data-new={isNewDecision(d) ? "true" : undefined}
                            >
                              {staffDecisionText(d)}
                            </p>
                          );
                        })()}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
