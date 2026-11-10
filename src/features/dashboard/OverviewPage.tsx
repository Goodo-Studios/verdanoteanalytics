// Client overview: staff page (consolidation step 5a, port of the old
// dashboard's Overview). Active creator clients, lowest completion first, with
// the At risk and Stale tiles. Each card also shows the client's Content
// Pipeline cards (pipeline_tasks, fed from ClickUp; the board itself stays on
// /pipeline) and its active 45-day cycle (engagements, PR 143). Read only.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertOctagon, AlertTriangle, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { loadOverview, type OverviewData } from "./api";
import {
  boardSummary,
  clientHealth,
  creatorClients,
  cycleDay,
  formatAgo,
  formatDay,
  groupBySlug,
  overviewCounts,
  sortByProgress,
  type ActiveEngagement,
  type BoardCard,
  type DashboardClient,
} from "./model";

const CARD = "rounded-lg border border-border bg-card p-4";

function Tile({ label, value, Icon, tone }: { label: string; value: number; Icon: typeof Users; tone: string }) {
  return (
    <div className={CARD} data-testid={`overview-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${tone}`} aria-hidden />
        <span>{label}</span>
      </div>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

const HEALTH_LABEL = { stale: "Stale", at_risk: "At risk", ok: null, manual: null } as const;

function ClientCard({ client, cards, engagement, now, prefix }: {
  client: DashboardClient;
  cards: BoardCard[];
  engagement: ActiveEngagement | undefined;
  now: Date;
  prefix: string;
}) {
  const pct = typeof client.pct_complete === "number" ? Math.max(0, Math.min(100, client.pct_complete)) : null;
  const health = clientHealth(client, now);
  const board = boardSummary(cards);
  const day = engagement ? cycleDay(engagement.start_date, now) : null;
  return (
    <Link to={`${prefix}/clients/${encodeURIComponent(client.slug)}`} className={`${CARD} block hover:bg-accent`} data-testid={`overview-client-${client.slug}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-medium">{client.name}</h2>
        {HEALTH_LABEL[health] && (
          <span className={`rounded px-2 py-0.5 text-xs ${health === "stale" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700"}`}>
            {HEALTH_LABEL[health]}
          </span>
        )}
      </div>
      <div className="mt-3 h-2 w-full rounded bg-muted" aria-label={`Progress ${pct ?? 0} percent`} role="img">
        <div className="h-2 rounded bg-primary" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{pct === null ? "No progress recorded" : `${pct}% complete`}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Strategist</dt>
        <dd>{client.strategist ?? "Unassigned"}</dd>
        <dt className="text-muted-foreground">Contract end</dt>
        <dd>{formatDay(client.contract_end)}</dd>
        <dt className="text-muted-foreground">Cycle</dt>
        <dd>{engagement ? `Cycle ${engagement.cycle_number}${day ? `, day ${day} of 45` : ""}` : "No active cycle"}</dd>
        <dt className="text-muted-foreground">Content board</dt>
        <dd>{board.total === 0 ? "No cards" : `${board.total} cards, ${board.waitingOnClient} in client review`}</dd>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {health === "manual" ? "Added by hand" : `Updated by the HQ sync ${formatAgo(client.last_synced, now)}`}
      </p>
    </Link>
  );
}

export default function OverviewPage() {
  const prefix = useRolePrefix();
  const now = useMemo(() => new Date(), []);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await loadOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load clients.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const clients = useMemo(() => (data ? sortByProgress(creatorClients(data.clients)) : []), [data]);
  const counts = useMemo(() => overviewCounts(clients, now), [clients, now]);
  const cardsBySlug = useMemo(() => groupBySlug(data?.cards ?? []), [data]);
  const cycleBySlug = useMemo(() => new Map((data?.engagements ?? []).map((e) => [e.client_slug, e])), [data]);

  return (
    <div className="p-6 space-y-6" data-testid="client-overview-page">
      <PageHeader title="Client overview" description="Active creator clients, lowest completion first." />
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
          Could not load clients: {error}{" "}
          <button type="button" className="underline" onClick={() => void load()}>Try again</button>
        </div>
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">Loading clients...</p>
      ) : clients.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No active creator clients.</p>
      ) : (
        <>
          <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Tile label="Creator clients" value={counts.total} Icon={Users} tone="text-primary" />
            <Tile label="At risk" value={counts.atRisk} Icon={AlertTriangle} tone="text-amber-700" />
            <Tile label="Stale" value={counts.stale} Icon={AlertOctagon} tone="text-destructive" />
          </section>
          <section aria-label="Active clients" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <ClientCard key={c.slug} client={c} cards={cardsBySlug.get(c.slug) ?? []} engagement={cycleBySlug.get(c.slug)} now={now} prefix={prefix} />
            ))}
          </section>
          <p className="text-xs text-muted-foreground">
            At risk: under half done and no sync update in 14 days. Stale: no sync update in 21 days. Clients added by hand are not counted in either.
          </p>
        </>
      )}
    </div>
  );
}
