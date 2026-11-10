// Operating costs: builder-only page (consolidation step 4d, port of the Goodo OS owner page
// src/pages/staff/OperatingCosts.tsx). Fixed monthly costs with where each figure comes
// from, the monthly budget with a warning amount below the limit, budget alerts and the
// history of every change. Writes go through checked database functions that refuse anyone
// but a builder (migration 20261111000003); employees and clients read none of it. A budget
// alert queues an owner alert through the shared job queue only when a confirmed owner alert
// channel exists, and nothing is ever sent from staging.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LastRunLine } from "@/components/LastRunLine";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ALERT_SELECT,
  alertDelivery,
  amount,
  BASES,
  basisLabel,
  type Budget,
  type BudgetAlert,
  budgetProblem,
  budgetState,
  BUDGET_STATE_LABEL,
  CATEGORIES,
  categoryLabel,
  type CostEntry,
  type CostEvent,
  type EntryForm,
  entryProblem,
  errorText,
  eventText,
  fixedTotal,
  MODEL_SPEND_NOTE,
  parseUsd,
  usd,
} from "./model";

// The operating cost tables are not in the generated types.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string, options?: { ascending: boolean }): Query;
  limit(n: number): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

const EMPTY: EntryForm = { entryKey: "", label: "", category: "other", monthlyUsd: "", basis: "proposed", sourceReference: "", active: true };

function EntryEditor({ entry, onSaved }: { entry: CostEntry | null; onSaved: () => void }) {
  const [form, setForm] = useState<EntryForm>(
    entry
      ? { entryKey: entry.entry_key, label: entry.label, category: entry.category, monthlyUsd: amount(entry.monthly_usd).toFixed(2), basis: entry.basis, sourceReference: entry.source_reference, active: entry.active }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const problem = entryProblem(form);
  const save = async () => {
    setError(null);
    const { error: e } = await db.rpc("record_operating_cost_entry", {
      p_entry_key: form.entryKey,
      p_label: form.label.trim(),
      p_category: form.category,
      p_monthly_usd: parseUsd(form.monthlyUsd, { min: 0, max: 100000, allowZero: true }),
      p_basis: form.basis,
      p_source_reference: form.sourceReference.trim(),
      p_active: form.active,
      p_expected_version: entry?.version ?? 0,
    });
    if (e) return setError(errorText(e.code, "The cost could not be saved."));
    if (!entry) setForm(EMPTY);
    onSaved();
  };
  const name = entry ? `Edit ${entry.label}` : "New cost";
  return (
    <div role="group" aria-label={name} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input aria-label="Key" className={field} placeholder="Key, for example supabase-pro" value={form.entryKey} disabled={!!entry}
          onChange={(e) => setForm({ ...form, entryKey: e.target.value })} />
        <input aria-label="Label" className={field} placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <select aria-label="Category" className={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as EntryForm["category"] })}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input aria-label="Monthly amount (USD)" className={field} inputMode="decimal" placeholder="Monthly amount in USD" value={form.monthlyUsd}
          onChange={(e) => setForm({ ...form, monthlyUsd: e.target.value })} />
        <select aria-label="Basis" className={field} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as EntryForm["basis"] })}>
          {BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <input aria-label="Source" className={field} placeholder="Where the figure comes from (invoice, quote, pricing page)" value={form.sourceReference}
          onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Counted this month
      </label>
      {problem && (form.entryKey || form.label || form.monthlyUsd) ? <p className="text-[12px] text-muted-foreground">{problem}</p> : null}
      <Button size="sm" disabled={!!problem} onClick={() => void save()}>{entry ? `Save version ${entry.version + 1}` : "Add cost"}</Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function BudgetEditor({ budget, onSaved }: { budget: Budget | null; onSaved: () => void }) {
  const [limit, setLimit] = useState(budget ? amount(budget.monthly_limit_usd).toFixed(2) : "");
  const [warning, setWarning] = useState(budget ? amount(budget.warning_usd).toFixed(2) : "");
  const [error, setError] = useState<string | null>(null);
  const problem = budgetProblem(limit, warning);
  const save = async () => {
    setError(null);
    const { error: e } = await db.rpc("record_operating_budget", {
      p_budget_key: "total",
      p_monthly_limit_usd: Number(limit.trim()),
      p_warning_usd: Number(warning.trim()),
      p_expected_version: budget?.version ?? 0,
    });
    if (e) return setError(errorText(e.code, "The budget could not be saved."));
    onSaved();
  };
  return (
    <div role="group" aria-label="Budget" className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input aria-label="Monthly limit (USD)" className={field} inputMode="decimal" placeholder="Monthly limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <input aria-label="Warning amount (USD)" className={field} inputMode="decimal" placeholder="Warning amount, below the limit" value={warning} onChange={(e) => setWarning(e.target.value)} />
      </div>
      {problem && (limit || warning) ? <p className="text-[12px] text-muted-foreground">{problem}</p> : null}
      <Button size="sm" disabled={!!problem} onClick={() => void save()}>{budget ? `Save budget version ${budget.version + 1}` : "Set budget"}</Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export default function OperatingCostsPage() {
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [events, setEvents] = useState<CostEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, b, a, h] = await Promise.all([
      db.from("operating_cost_entries").select("*").order("category"),
      db.from("operating_budgets").select("*").order("budget_key"),
      db.from("operating_budget_alerts").select(ALERT_SELECT).order("created_at", { ascending: false }).limit(50),
      db.from("operating_cost_events").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (e.error || b.error || a.error || h.error) {
      setError("Operating costs could not load.");
      return;
    }
    setError(null);
    setEntries((e.data ?? []) as CostEntry[]);
    setBudget(((b.data ?? []) as Budget[]).find((x) => x.budget_key === "total") ?? null);
    setAlerts((a.data ?? []) as BudgetAlert[]);
    setEvents((h.data ?? []) as CostEvent[]);
    setLoaded(true);
  }, []);
  useEffect(() => void load(), [load]);

  const check = async () => {
    setCheckMessage(null);
    const { data, error: e } = await db.rpc("evaluate_operating_budgets");
    if (e) return setCheckMessage(errorText(e.code, "The budgets could not be checked."));
    const n = Number(data ?? 0);
    setCheckMessage(n === 0 ? "No new threshold was crossed." : `${n} new budget alert${n === 1 ? "" : "s"} recorded.`);
    void load();
  };

  const total = fixedTotal(entries);
  const state = budgetState(total, budget);
  const month = new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6" data-testid="operating-costs">
      <PageHeader title="Operating costs" description="Fixed monthly costs, the monthly budget and its alerts. Builder only." />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {loaded ? (
        <>
          <section aria-labelledby="oc-month" className="space-y-1 rounded-lg border border-input bg-background p-4 text-sm">
            <h2 id="oc-month" className="text-base font-semibold">{month}</h2>
            <p data-testid="oc-fixed-total">Fixed costs: {usd(total)} a month</p>
            <p data-testid="oc-budget-state">
              {BUDGET_STATE_LABEL[state]}
              {budget ? ` · warning ${usd(budget.warning_usd)} · limit ${usd(budget.monthly_limit_usd)}` : ""}
            </p>
            <p className="text-muted-foreground">{MODEL_SPEND_NOTE}</p>
          </section>

          <section aria-labelledby="oc-entries" className="space-y-3">
            <h2 id="oc-entries" className="text-base font-semibold">Fixed costs</h2>
            {entries.length === 0 ? <p className="text-sm text-muted-foreground">No costs recorded yet.</p> : null}
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={`${e.entry_key}:${e.version}`} aria-label={`Cost ${e.label}`} className="space-y-1 rounded border border-input p-3 text-sm">
                  <p className="font-medium">{e.label} · {usd(e.monthly_usd)} a month{e.active ? "" : " · not counted"}</p>
                  <p className="text-[12px] text-muted-foreground">{categoryLabel(e.category)} · {basisLabel(e.basis)} · {e.source_reference} · version {e.version}</p>
                  <details>
                    <summary className="cursor-pointer text-[12px]">Edit</summary>
                    <div className="mt-2"><EntryEditor entry={e} onSaved={() => void load()} /></div>
                  </details>
                </li>
              ))}
            </ul>
            <details>
              <summary className="cursor-pointer text-sm font-medium">Add a cost</summary>
              <div className="mt-2"><EntryEditor entry={null} onSaved={() => void load()} /></div>
            </details>
          </section>

          <section aria-labelledby="oc-budget" className="space-y-3">
            <h2 id="oc-budget" className="text-base font-semibold">Monthly budget</h2>
            <BudgetEditor key={budget?.version ?? 0} budget={budget} onSaved={() => void load()} />
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" disabled={!budget} onClick={() => void check()}>Check budgets now</Button>
              {checkMessage ? <p role="status" className="text-sm">{checkMessage}</p> : null}
            </div>
            <LastRunLine checkKey="budget_check" scheduleNote="In production it also runs by itself every day." refresh={events.length} />
          </section>

          <section aria-labelledby="oc-alerts" className="space-y-2">
            <h2 id="oc-alerts" className="text-base font-semibold">Budget alerts</h2>
            {alerts.length === 0 ? <p className="text-sm text-muted-foreground">No budget threshold has been crossed.</p> : null}
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.id} className="rounded border border-input p-3 text-sm">
                  <p className="font-medium">
                    {a.level === "limit" ? "Limit reached" : "Warning passed"} · {a.period_month.slice(0, 7)} · {usd(a.spend_usd)} against {usd(a.threshold_usd)}
                  </p>
                  <p className="text-[12px] text-muted-foreground">Budget version {a.budget_version} · {alertDelivery(a)}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="oc-history" className="space-y-2">
            <h2 id="oc-history" className="text-base font-semibold">History</h2>
            <ol className="space-y-1 text-[12px] text-muted-foreground">
              {events.map((e) => (
                <li key={e.id}>{new Date(e.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {eventText(e)}</li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </div>
  );
}
