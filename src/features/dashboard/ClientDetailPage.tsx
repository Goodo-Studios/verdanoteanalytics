// Client page: staff page (consolidation step 5a, port of the old dashboard's
// Client Detail). The one page per client in Verdanote: details, scope,
// progress and deliverables from the old dashboard, plus what Verdanote now
// holds for the same clients.slug: linked ad accounts, 45-day cycles
// (engagements), the Content Pipeline cards from ClickUp (pipeline_tasks; the
// board stays on /pipeline), creator assignments and outside-system mappings.
// This page is the Overview tab of the client hub (/clients/:slug). Cycle setup and
// deliverable approvals are on the hub's Scope tab.
//
// Writes go through the checked functions: set_client_details (builder, manual
// clients only), set_client_scope and set_client_active (builder).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextField } from "@/components/page-kit";
import { useAuth } from "@/contexts/AuthContext";
import { ClientMonthHours } from "@/features/clients/ClientMonthHours";
import { hubPath } from "@/lib/clientHub";
import { useRolePrefix } from "@/hooks/useRolePath";
import { STATUS_LABEL as ENGAGEMENT_STATUS_LABEL, type EngagementStatus } from "@/features/engagements/model";
import {
  DashboardError,
  loadClientDetail,
  saveClientActive,
  saveClientDetails,
  saveClientScope,
  type ClientDetailData,
  type ClientDetailsPatch,
} from "./api";
import {
  BOARD_COLUMNS,
  CLIENT_STATUSES,
  DELIVERABLE_LABEL,
  DELIVERABLE_STATUS_LABEL,
  MANUAL_PROGRESS_NOTE,
  SYNCED_DETAILS_NOTE,
  boardSummary,
  cycleDay,
  deliverablesFor,
  errorText,
  deliveryText,
  deriveMonthDelivery,
  lastUpdatedLine,
  progressText,
  formatDay,
  formatMonth,
  isSyncedClient,
  monthKey,
  monthOptions,
  serviceLines,
  stageCounts,
  type DashboardClient,
} from "./model";

const CARD = "rounded-lg border border-border bg-card p-4";
const H2 = "text-sm font-semibold";

/** "ending / transitioning" -> "Ending / transitioning". */
function sentenceCase(value: string | null | undefined): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "22023" ? e.message : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={CARD}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function DetailsForm({ client, onSaved }: { client: DashboardClient; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState<ClientDetailsPatch>({
    service_type: client.service_type, strategist: client.strategist,
    contract_start: client.contract_start, contract_end: client.contract_end, status: client.status,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ClientDetailsPatch) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value || null });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveClientDetails(client.slug, form);
      onSaved("Details saved.");
    } catch (e) {
      setError(messageOf(e, "The details could not be saved."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={`${CARD} space-y-2`} aria-label="Edit details" role="group">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label="Service type" hideLabel placeholder="Service type" value={form.service_type ?? ""} onChange={set("service_type")} />
        <TextField label="Strategist" hideLabel placeholder="Strategist" value={form.strategist ?? ""} onChange={set("strategist")} />
        <TextField label="Contract start" hideLabel type="date" value={form.contract_start ?? ""} onChange={set("contract_start")} />
        <TextField label="Contract end" hideLabel type="date" value={form.contract_end ?? ""} onChange={set("contract_end")} />
        <SelectField label="Status" hideLabel value={form.status ?? ""} onChange={set("status")} options={CLIENT_STATUSES.map((s) => ({ value: s, label: s }))} />
      </div>
      <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
        Save details
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function ScopeField({ client, canEdit, onSaved }: { client: DashboardClient; canEdit: boolean; onSaved: (msg: string) => void }) {
  const [value, setValue] = useState(client.scope ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await saveClientScope(client.slug, value.trim() || null);
      onSaved("Scope saved.");
    } catch (e) {
      setError(messageOf(e, "The scope could not be saved."));
    }
  };
  return (
    <div className={CARD}>
      <h2 className={H2}>Scope</h2>
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <TextField label="Scope" hideLabel className="min-w-[14rem] flex-1" maxLength={240} value={value} onChange={(e) => setValue(e.target.value)} placeholder="For example 4 UGC videos per month" />
          <Button type="button" variant="outline" onClick={() => void save()}>Save scope</Button>
        </div>
      ) : (
        <p className="mt-1 text-sm">{client.scope ?? "Not set"}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">What was contracted, as a reference for the team. Not enforced anywhere.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export default function ClientDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const prefix = useRolePrefix();
  const { isBuilder } = useAuth();
  const now = useMemo(() => new Date(), []);
  const current = monthKey(now);
  const [month, setMonth] = useState(current);
  const [data, setData] = useState<ClientDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await loadClientDetail(slug));
    } catch (e) {
      setError(messageOf(e, "Could not load this client."));
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);

  const saved = (msg: string) => {
    setNotice(msg);
    void load();
  };
  const toggleActive = async (client: DashboardClient) => {
    setNotice(null);
    try {
      await saveClientActive(client.slug, !client.active);
      saved(client.active ? "Hidden from the client list." : "Shown on the client list.");
    } catch (e) {
      setError(messageOf(e, "Could not change whether this client shows on the client list."));
    }
  };

  const back = (
    <Link to={`${prefix}/clients`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Clients
    </Link>
  );

  if (error && !data) {
    return (
      <PageShell wide data-testid="client-detail-page">
        {back}
        <ErrorState message={error} onRetry={() => void load()} />
      </PageShell>
    );
  }
  if (!data) return <PageShell wide data-testid="client-detail-page"><LoadingState label="Loading client" variant="cards" /></PageShell>;
  const { client } = data;
  if (!client) {
    return (
      <PageShell wide data-testid="client-detail-page">
        {back}
        <EmptyState
          title="We couldn't find this client."
          description="It may have been removed, or the link may be out of date."
          action={<Link to={`${prefix}/clients`} className="text-sm underline">Go to Clients</Link>}
        />
      </PageShell>
    );
  }

  const synced = isSyncedClient(client.origin);
  const canEditDetails = isBuilder && !synced;
  const months = monthOptions(data.deliverables, current);
  const monthRows = deliverablesFor(data.deliverables, month);
  const board = boardSummary(data.cards.map((c) => ({ client_slug: slug, stage: c.stage, due_date: c.due_date })));
  const review = data.cards.filter((c) => c.stage === "Client Review");
  const stages = stageCounts(data.assignments);
  const derived = deriveMonthDelivery(data.tasks ?? [], data.deliveredTasks ?? [], month);
  const pct = typeof client.pct_complete === "number" ? Math.max(0, Math.min(100, client.pct_complete)) : null;

  return (
    <PageShell wide className="space-y-6" data-testid="client-detail-page">
      <PageHeader
        title={client.name}
        description={[...serviceLines(client), sentenceCase(client.status), synced ? "Synced from its knowledge file" : "Added by hand"].join(" · ")}
        actions={isBuilder ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void toggleActive(client)}>
            {client.active ? "Hide from client list" : "Show on client list"}
          </Button>
        ) : undefined}
      />
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <section aria-label="Details" className="space-y-2">
        {canEditDetails ? (
          <DetailsForm key={`${client.slug}-${client.status}-${client.strategist}`} client={client} onSaved={saved} />
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Service type" value={client.service_type ?? "Not set"} />
              <Field label="Strategist" value={client.strategist ?? "Unassigned"} />
              <Field label="Contract start" value={formatDay(client.contract_start)} />
              <Field label="Contract end" value={formatDay(client.contract_end)} />
            </dl>
            {synced && <p className="text-xs text-muted-foreground">{SYNCED_DETAILS_NOTE}</p>}
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ScopeField key={client.scope ?? ""} client={client} canEdit={isBuilder} onSaved={saved} />
        <ClientMonthHours slug={client.slug} />
        <div className={CARD}>
          <h2 className={H2}>Production progress</h2>
          <div className="mt-2 h-2 w-full rounded bg-muted" role="img" aria-label={`Progress ${pct ?? 0} percent`}>
            <div className="h-2 rounded bg-primary" style={{ width: `${pct ?? 0}%` }} />
          </div>
          <p className="mt-1 text-xs">{progressText(pct, client)}</p>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="client-last-updated">{lastUpdatedLine(client, now)}</p>
          {!synced && <p className="text-xs text-muted-foreground">{MANUAL_PROGRESS_NOTE}</p>}
          {derived?.lastDelivery && <p className="text-xs text-muted-foreground" data-testid="client-last-delivery">Last delivery {formatDay(derived.lastDelivery)}, from ClickUp</p>}
        </div>
      </div>

      <section aria-label="Deliverables" className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={H2}>Deliverables, {formatMonth(month)}</h2>
          <SelectField label="Deliverables month" hideLabel className="w-44" inputClassName="h-9" value={month} onChange={(e) => setMonth(e.target.value)} options={months.map((m) => ({ value: m, label: formatMonth(m) }))} />
        </div>
        {monthRows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No deliverables logged for {formatMonth(month)}.</p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {monthRows.map((d) => (
              <li key={d.id} className="flex justify-between py-1.5">
                <span>{DELIVERABLE_LABEL[d.type] ?? d.type}</span>
                <span className="text-muted-foreground">
                  {d.type === "delivery" && derived ? `${deliveryText(derived)}, from ClickUp` : DELIVERABLE_STATUS_LABEL[d.status] ?? d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Cycles" className={CARD}>
          <h2 className={H2}>45-day cycles</h2>
          {data.engagements.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No cycles recorded.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {data.engagements.map((e) => {
                const day = e.status === "active" ? cycleDay(e.start_date, now) : null;
                return (
                  <li key={e.id} data-testid={`client-cycle-${e.cycle_number}`}>
                    Cycle {e.cycle_number}: {ENGAGEMENT_STATUS_LABEL[e.status as EngagementStatus] ?? e.status}{day ? `, day ${day} of 45` : ""}. Start {formatDay(e.start_date)}
                    {e.day45_date ? `, day 30 ${formatDay(e.day30_date)}, day 45 ${formatDay(e.day45_date)}` : ""}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Content Pipeline" className={CARD}>
          <div className="flex items-center justify-between">
            <h2 className={H2}>Content Pipeline (ClickUp)</h2>
            <Link to={`${prefix}${hubPath(client.slug, "work")}`} className="text-xs underline">Open the board</Link>
          </div>
          {board.total === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No cards. The board fills from this client&rsquo;s ClickUp folder.</p>
          ) : (
            <>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-center text-xs sm:grid-cols-3 lg:grid-cols-5" aria-label="Cards per column">
                {BOARD_COLUMNS.map((col) => (
                  <li key={col} className="rounded bg-muted p-1"><div className="font-semibold">{board.byColumn[col]}</div>{col}</li>
                ))}
              </ul>
              {review.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">Waiting on the client: {review.map((c) => c.task_name ?? "Untitled").join(", ")}</p>
              )}
            </>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Creators" className={CARD}>
          <div className="flex items-center justify-between">
            <h2 className={H2}>Creators</h2>
            <Link to={`${prefix}/talent/pipeline`} className="text-xs underline">Open in Creator pipeline</Link>
          </div>
          {stages.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No creators on this client yet.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2 text-xs">
              {stages.map((s) => <li key={s.stage} className="rounded bg-muted px-2 py-1">{s.label}: {s.count}</li>)}
            </ul>
          )}
        </section>

        <section aria-label="Linked accounts" className={CARD}>
          <h2 className={H2}>Ad accounts and linked systems</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.adAccounts.map((a) => <li key={a.account_id}>Ad account: {a.ad_accounts?.name ?? a.account_id}</li>)}
            {data.mappings.map((m) => <li key={`${m.provider}-${m.kind}-${m.external_id}`}>{m.provider} {m.kind.replace(/_/g, " ")}: {m.label ?? m.external_id}</li>)}
            {data.adAccounts.length === 0 && data.mappings.length === 0 && <li className="text-muted-foreground">None linked.</li>}
          </ul>
        </section>
      </div>

      <section aria-label="Cycles and deliverables" className={CARD} data-testid="client-detail-engagement-links">
        <h2 className={H2}>Cycles and deliverables</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up cycles, terms and milestones under{" "}
          <Link to={`${prefix}${hubPath(client.slug, "scope", "engagements")}`} className="underline">Scope: Engagements</Link>. Track deliverable
          rounds and approvals under{" "}
          <Link to={`${prefix}${hubPath(client.slug, "scope", "deliverables")}`} className="underline">Scope: Deliverables</Link>. Both are for{" "}
          {client.name}.
        </p>
      </section>
    </PageShell>
  );
}
