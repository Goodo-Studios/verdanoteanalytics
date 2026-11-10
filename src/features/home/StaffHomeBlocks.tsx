// The staff Home blocks: what to do today. Everyone on staff sees Due this week, Waiting on the client,
// My handoffs and My support requests. A builder also sees Clients needing attention at the top.
// Each block reads its own data and shows its own loading, error and empty state.
import { useMemo } from "react";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import {
  useAllWorkTasks,
  useBudgetAlerts,
  useOpenSupport,
  useReadyHandoffs,
  useStaffHomeAccess,
} from "@/hooks/useHomeData";
import { hubPath } from "@/lib/clientHub";
import { clientsNeedingAttention, dueThisWeek, isLate, shortDate, todayIso, waitingOnClient, type HomeTask } from "@/lib/homeData";
import { HomeBlock, type BlockRow, type BlockStatus } from "./HomeBlock";

const ROLE_LABEL: Record<string, string> = {
  strategist: "as strategist",
  editor: "as editor",
  qa_reviewer: "as QA reviewer",
  delivery_owner: "as delivery owner",
};

function statusOf(q: { isLoading: boolean; isError: boolean }): BlockStatus {
  return q.isError ? "error" : q.isLoading ? "loading" : "ready";
}

export function StaffHomeBlocks() {
  const prefix = useRolePrefix();
  const { clients } = useClientSelection();
  const { isBuilder, userId } = useStaffHomeAccess();
  const tasks = useAllWorkTasks();
  const handoffs = useReadyHandoffs();
  const support = useOpenSupport();
  const budget = useBudgetAlerts();

  const names = useMemo(() => Object.fromEntries(clients.map((c) => [c.slug, c.name])), [clients]);
  const nameOf = (slug: string) => names[slug] ?? "A client";
  const today = todayIso();

  const taskRow = (t: HomeTask): BlockRow => ({
    key: t.id,
    primary: t.task_name || "Untitled task",
    secondary: `${nameOf(t.client_slug)} · ${t.stage ?? "Preparing Content"}`,
    to: hubPath(t.client_slug, "work"),
    right: shortDate(t.due_date),
    late: isLate(t, today),
  });

  const dueRows = (tasks.data ? dueThisWeek(tasks.data, today) : []).map(taskRow);
  const waitingRows = (tasks.data ? waitingOnClient(tasks.data) : []).map(taskRow);

  const myHandoffs = (handoffs.data ?? []).filter((h) => h.receiver_id === userId).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const handoffRows: BlockRow[] = myHandoffs.map((h) => ({
    key: h.id,
    primary: `Handoff for ${nameOf(h.client_slug)}`,
    secondary: ROLE_LABEL[h.receiving_role] ?? "",
    to: hubPath(h.client_slug, "scope", "handoffs"),
    right: `Due ${shortDate(h.due_date)}`,
    late: h.due_date < today,
  }));

  const mySupport = (support.data ?? [])
    .filter((r) => r.accountable_user_id === userId || r.backup_user_id === userId)
    .sort((a, b) => a.next_update_target.localeCompare(b.next_update_target));
  const supportRows: BlockRow[] = mySupport.map((r) => ({
    key: r.id,
    primary: r.subject,
    secondary: nameOf(r.client_slug),
    to: `/admin/support?client=${encodeURIComponent(r.client_slug)}`,
    right: `Update by ${shortDate(r.next_update_target)}`,
    late: r.next_update_target < today,
  }));

  // Builder: one list from late work, support, sync staleness and budget alerts. The list is only drawn once
  // each source it needs has loaded, and says so when one of them failed.
  const attentionStatus: BlockStatus = tasks.isError || support.isError || budget.isError ? "error" : tasks.isLoading || support.isLoading || budget.isLoading ? "loading" : "ready";
  const attentionRows: BlockRow[] =
    attentionStatus === "ready"
      ? clientsNeedingAttention({ tasks: tasks.data ?? [], support: support.data ?? [], budgetAlerts: budget.data ?? [], clientNames: names }).map((r) => ({
          key: r.key,
          primary: r.name,
          secondary: r.reason,
          to: r.to,
          late: r.late,
        }))
      : [];

  const retryAttention = () => {
    void tasks.refetch();
    void support.refetch();
    void budget.refetch();
  };

  return (
    <div className="max-w-3xl space-y-6" data-testid="staff-home-blocks">
      {isBuilder ? (
        <HomeBlock
          id="attention"
          title="Clients needing attention"
          status={attentionStatus}
          rows={attentionRows}
          emptyText="Every client looks fine right now."
          seeAllTo="/clients"
          prefix={prefix}
          onRetry={retryAttention}
        />
      ) : null}
      <HomeBlock
        id="due"
        title="Due this week"
        status={statusOf(tasks)}
        rows={dueRows}
        emptyText="Nothing is due in the next 7 days."
        seeAllTo="/work?view=week"
        prefix={prefix}
        onRetry={() => void tasks.refetch()}
      />
      <HomeBlock
        id="waiting"
        title="Waiting on the client"
        status={statusOf(tasks)}
        rows={waitingRows}
        emptyText="Nothing is waiting on a client right now."
        seeAllTo="/work?view=all&stage=Client+Review"
        prefix={prefix}
        onRetry={() => void tasks.refetch()}
      />
      <HomeBlock
        id="handoffs"
        title="My handoffs"
        status={statusOf(handoffs)}
        rows={handoffRows}
        emptyText="Nothing is waiting for you."
        seeAllTo={handoffRows.length > 0 ? hubPath(myHandoffs[0].client_slug, "scope", "handoffs") : "/clients"}
        prefix={prefix}
        onRetry={() => void handoffs.refetch()}
      />
      <HomeBlock
        id="support"
        title="My support requests"
        status={statusOf(support)}
        rows={supportRows}
        emptyText="You have no open support requests."
        seeAllTo="/admin/support"
        prefix={prefix}
        onRetry={() => void support.refetch()}
      />
    </div>
  );
}
