// Work: every client's ClickUp cards on one page, soonest due date first. Staff only (the route guard
// in App.tsx). Reads pipeline_tasks through the same staff row rule as the client hub Work tab.
//
// Filters: Due this week / Overdue / All, client, stage and a search on the task name. They live in
// the address (?view=, ?for=, ?stage=, ?q=) so a link from Home opens the same list. The client
// filter here is this page's own; it does not change the client picked at the top of the app.
// The board does not store who a card is assigned to, so there is no person filter.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { useAllWorkTasks } from "@/hooks/useHomeData";
import { hubPath } from "@/lib/clientHub";
import { ALL_STAGES, clickupTaskUrl, filterWork, isLate, shortDate, todayIso, type WorkView } from "@/lib/homeData";
import { HomeTabs } from "./HomeTabs";

const PAGE_SIZE = 25;
const SELECT =
  "h-9 max-w-[220px] rounded-md border border-input bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
  const [shown, setShown] = useState(PAGE_SIZE);

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

  return (
    <div className="space-y-4 p-6" data-testid="work-page">
      <PageHeader title="Work" description="Every client's ClickUp cards, soonest due date first." className="mb-2" />
      <HomeTabs active="work" />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div className="flex overflow-hidden rounded-md border border-input" role="group" aria-label="Which cards">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => set("view", v.id === "week" ? "" : v.id)}
              className={`px-3 py-1.5 text-[13px] transition-colors ${view === v.id ? "bg-forest text-white" : "bg-background hover:bg-accent"}`}
              data-testid={`work-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <select aria-label="Client" className={SELECT} value={client} onChange={(e) => set("for", e.target.value)} data-testid="work-filter-client">
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <select aria-label="Stage" className={SELECT} value={stage} onChange={(e) => set("stage", e.target.value)} data-testid="work-filter-stage">
          <option value="">All stages</option>
          {ALL_STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Search task names"
          placeholder="Search task names"
          value={query}
          onChange={(e) => set("q", e.target.value)}
          className="h-9 w-56 rounded-md border border-input bg-background px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="work-search"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The content board does not record who a card is assigned to, so there is no filter by person.
      </p>

      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="work-loading">Loading cards...</p>
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm" data-testid="work-error">
          The cards could not load, so this is not the same as having none.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>Try again</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="work-empty">
          {(tasks ?? []).length === 0
            ? "No ClickUp cards have come in yet."
            : view === "overdue"
              ? "Nothing is overdue with these filters."
              : view === "week"
                ? "Nothing is due in the next 7 days with these filters. Try All."
                : "No cards match these filters."}
        </p>
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
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline" data-testid="work-row-link">
                        <span className="truncate">{t.task_name || "Untitled task"}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-sage" aria-label="Opens in ClickUp" />
                      </a>
                    ) : (
                      <span className="font-medium" data-testid="work-row-nolink" title="The link to this card is not available.">
                        {t.task_name || "Untitled task"}
                      </span>
                    )}
                  </span>
                  <span className="hidden w-36 shrink-0 text-muted-foreground sm:block" data-testid="work-row-stage">{t.stage ?? "Preparing Content"}</span>
                  <span className={`w-16 shrink-0 text-right text-xs ${late ? "font-medium text-red-700" : "text-muted-foreground"}`} data-testid="work-row-due">
                    {shortDate(t.due_date)}
                  </span>
                </li>
              );
            })}
          </ul>
          {rows.length > visible.length ? (
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              data-testid="work-show-more"
            >
              Show more ({rows.length - visible.length} left)
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
