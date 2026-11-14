// Work: every client's ClickUp cards on one page, soonest due date first. Staff only (the route guard
// in App.tsx). Reads pipeline_tasks through the same staff row rule as the client hub Work tab.
//
// Filters: Due this week / Overdue / All, client, stage and a search on the task name. They live in
// the address (?view=, ?for=, ?stage=, ?q=) so a link from Home opens the same list. The client
// filter here is this page's own; it does not change the client picked at the top of the app.
// The board does not store who a card is assigned to, so there is no person filter.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField } from "@/components/page-kit";
import { ViewAssetLink } from "@/components/client/ViewAssetLink";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { useAllWorkTasks } from "@/hooks/useHomeData";
import { useTaskByClickupId } from "@/hooks/useMyWork";
import { useStaffDecisions } from "@/hooks/useClientDecisions";
import { currentDecision, isNewDecision, staffDecisionText } from "@/lib/clientDecisions";
import { hubPath } from "@/lib/clientHub";
import { ALL_STAGES, clickupTaskUrl, filterWork, isLate, shortDate, todayIso, type WorkView } from "@/lib/homeData";
import { HomeTabs } from "./HomeTabs";
import { TaskSidePanel } from "./TaskSidePanel";

const PAGE_SIZE = 25;
const VIEWS: Array<{ id: WorkView; label: string }> = [
  { id: "week", label: "Due this week" },
  { id: "overdue", label: "Overdue" },
  { id: "all", label: "All" },
];

const asView = (v: string | null): WorkView => (v === "overdue" || v === "all" ? v : "week");

export default function WorkPage() {
  const prefix = useRolePrefix();
  const { clients } = useClientSelection();
  const [params, setParams] = useSearchParams();
  const { data: tasks, isLoading, isError, refetch } = useAllWorkTasks();
  const decisions = useStaffDecisions();
  const [shown, setShown] = useState(PAGE_SIZE);
  // A card opens the task modal. A card with no task row behind it falls back to its ClickUp page.
  const [openCard, setOpenCard] = useState<Parameters<typeof clickupTaskUrl>[0] | null>(null);
  const opened = useTaskByClickupId(openCard?.clickup_task_id ?? null);
  const noTaskRow = !!openCard && opened.isFetched && opened.data === null;
  useEffect(() => {
    if (!noTaskRow || !openCard) return;
    const fallback = clickupTaskUrl(openCard);
    if (fallback) window.open(fallback, "_blank", "noopener,noreferrer");
    setOpenCard(null);
  }, [noTaskRow, openCard]);

  const view = asView(params.get("view"));
  const client = params.get("for") ?? "";
  const stage = params.get("stage") ?? "";
  const query = params.get("q") ?? "";

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShown(PAGE_SIZE);
  };

  const today = todayIso();
  const names = Object.fromEntries(clients.map((c) => [c.slug, c.name]));
  const rows = filterWork(tasks ?? [], { view, client, stage, query }, today);
  const visible = rows.slice(0, shown);
  const emptyTitle =
    (tasks ?? []).length === 0
      ? "No ClickUp cards have come in yet."
      : view === "overdue"
        ? "Nothing is overdue with these filters."
        : view === "week"
          ? "Nothing is due in the next 7 days with these filters. Try All."
          : "No cards match these filters.";

  return (
    <PageShell data-testid="work-page">
      <PageHeader title="Work" description="Every client's ClickUp cards, soonest due date first." className="mb-2" />
      <HomeTabs active="work" />

      <FilterBar search={{ value: query, onChange: (v) => set("q", v), label: "Search task names", placeholder: "Search task names" }}>
        <div className="flex overflow-hidden rounded-md border border-input" role="group" aria-label="Which cards">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => set("view", v.id === "week" ? "" : v.id)}
              className={`px-3 py-2 text-[13px] transition-colors ${view === v.id ? "bg-forest text-white" : "bg-background hover:bg-accent"}`}
              data-testid={`work-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <SelectField
          label="Client"
          hideLabel
          value={client}
          onChange={(e) => set("for", e.target.value)}
          data-testid="work-filter-client"
          placeholder="All clients"
          options={clients.map((c) => ({ value: c.slug, label: c.name }))}
          className="min-w-[10rem]"
        />
        <SelectField
          label="Stage"
          hideLabel
          value={stage}
          onChange={(e) => set("stage", e.target.value)}
          data-testid="work-filter-stage"
          placeholder="All stages"
          options={ALL_STAGES.map((s) => ({ value: s, label: s }))}
          className="min-w-[10rem]"
        />
      </FilterBar>
      <p className="text-xs text-muted-foreground">
        The content board does not record who a card is assigned to, so there is no filter by person.
      </p>

      {isLoading ? (
        <div data-testid="work-loading">
          <LoadingState label="Loading cards" />
        </div>
      ) : isError ? (
        <div data-testid="work-error">
          <ErrorState message="The cards could not load, so this is not the same as having none." onRetry={() => void refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="work-empty">
          <EmptyState title={emptyTitle} />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="work-count">
            {rows.length} {rows.length === 1 ? "card" : "cards"}
          </p>
          <ul className="divide-y divide-input rounded-lg border border-input">
            {visible.map((t) => {
              const late = isLate(t, today);
              const url = clickupTaskUrl(t);
              return (
                <li key={t.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm" data-testid="work-row" data-late={late ? "true" : undefined}>
                  <Link to={`${prefix}${hubPath(t.client_slug, "work")}`} className="w-40 shrink-0 truncate text-muted-foreground underline" data-testid="work-row-client">
                    {names[t.client_slug] ?? "A client"}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">
                    {t.clickup_task_id ? (
                      <span className="inline-flex max-w-full items-center gap-1.5">
                        <button type="button" onClick={() => setOpenCard(t)} className="truncate text-left font-medium hover:underline" data-testid="work-row-link">
                          {t.task_name || "Untitled task"}
                        </button>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0" data-testid="work-row-clickup" aria-label="Open in ClickUp">
                            <ExternalLink className="h-3 w-3 text-sage" aria-hidden />
                          </a>
                        ) : null}
                      </span>
                    ) : (
                      <span className="font-medium" data-testid="work-row-nolink" title="The link to this card is not available.">
                        {t.task_name || "Untitled task"}
                      </span>
                    )}
                  </span>
                  <ViewAssetLink link={t.asset_link} className="shrink-0" />
                  {(() => {
                    const d = currentDecision(decisions.data, t.clickup_task_id);
                    if (!d) return null;
                    return (
                      <span
                        className={`hidden max-w-[16rem] shrink-0 truncate rounded px-2 py-0.5 text-xs md:block ${d.decision === "approved" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"} ${isNewDecision(d) ? "font-semibold ring-1 ring-amber-300" : ""}`}
                        title={staffDecisionText(d)}
                        data-testid="work-row-decision"
                        data-new={isNewDecision(d) ? "true" : undefined}
                      >
                        {d.decision === "approved" ? "Client approved" : "Changes requested"}
                      </span>
                    );
                  })()}
                  <span className="hidden w-36 shrink-0 text-muted-foreground sm:block" data-testid="work-row-stage">{t.stage ?? "Preparing Content"}</span>
                  <span className={`w-16 shrink-0 text-right text-xs ${late ? "font-medium text-red-700" : "text-muted-foreground"}`} data-testid="work-row-due">
                    {shortDate(t.due_date)}
                  </span>
                </li>
              );
            })}
          </ul>
          {rows.length > visible.length ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)} data-testid="work-show-more">
              Show more ({rows.length - visible.length} left)
            </Button>
          ) : null}
        </>
      )}
      {openCard ? <TaskSidePanel task={opened.data ?? null} today={today} onClose={() => setOpenCard(null)} /> : null}
    </PageShell>
  );
}
