// Growth Dashboard: the old goodo-growth-dashboard.vercel.app page, inside the staff
// area. Builder only (route guard in App.tsx, and the table's row rules allow builders
// only). The numbers live in public.growth_dashboard_data instead of the browser.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ACTS,
  EXPORT_CONSOLE_COMMAND,
  H2_MONTHS,
  MONTHS,
  monthName,
  emptyWeek,
  QUOTES,
  allTimeTotal,
  calendarCells,
  callTallyPill,
  cellStatus,
  channelTotal,
  computeKpis,
  dealTally,
  emptyPlan,
  fmtMoney,
  iso,
  monthCallTotal,
  monthOut,
  newDealId,
  parseGrowthImport,
  parseISO,
  planFromRow,
  planMonth,
  planSummary,
  progressTiles,
  revenueSeries,
  scoreTiles,
  sheetWeeks,
  sortedDeals,
  stateFromRow,
  targetSum,
  validatePlan,
  weekActs,
  weekExempt,
  weekRange,
  weekTotalStatus,
  weeksInMonth,
  type GrowthPlan,
  type GrowthState,
  type ImportResult,
  type PlanMonth,
  type Pill,
  type Status,
  type Tile,
} from "./model";

const GROWTH_TABLE = "growth_dashboard_data";
const GROWTH_QUERY_KEY = ["growth-dashboard"] as const;
const SAVE_DELAY_MS = 700;
// Repeated class names, kept once so the page chunk stays small (bundle budget).
const KK0 = "w-full text-[14px]";
const KK1 = "px-2 py-1.5 font-semibold";
const KK2 = "list-disc pl-5 text-[13px] text-red-700";
const KK3 = "flex flex-wrap items-center gap-2";
const KK4 = "min-w-full text-center text-[14px]";
const KK5 = "bg-muted/40 px-3 py-2";
const KK6 = "px-3 py-1.5 text-left font-semibold";
const KK7 = "border-t-2 border-input font-semibold";
const KK8 = "text-amber-700";
const K0 = "font-label text-[10px] uppercase tracking-[0.08em] text-sage";
const K1 = "px-2 py-1.5 tabular-nums";
const K2 = "text-[24px] font-semibold tabular-nums text-forest";
const K3 = "text-[12px] text-muted-foreground";
const K4 = "border-b border-input text-left font-label text-[10px] uppercase tracking-[0.06em] text-sage";
const K5 = "mt-1 overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[12px] text-forest";
const K6 = "text-[13px] text-muted-foreground";
const K7 = "border-b border-input font-label text-[10px] uppercase text-sage";
const K8 = "border-t-2 border-input bg-muted/40 font-semibold";
const K9 = "flex items-baseline gap-2";
const K10 = "flex items-center gap-1.5";
const K11 = "border-b border-input/50";
const K12 = "px-2 py-2";
const K13 = "overflow-x-auto";

/** Message of an Error or of a Supabase error object (a plain object with `message`). */
function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && typeof (e as { message?: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

type Rows = { state: unknown; plan: unknown };

async function loadRows(): Promise<Rows> {
  const { data, error } = await supabase.from(GROWTH_TABLE).select("key, data");
  if (error) throw error;
  const byKey = new Map((data ?? []).map((r) => [r.key, r.data]));
  return { state: byKey.get("state") ?? null, plan: byKey.get("plan") ?? null };
}

async function saveRow(key: "state" | "plan", payload: GrowthState | GrowthPlan): Promise<void> {
  const { error } = await supabase
    .from(GROWTH_TABLE)
    .upsert({ key, data: payload as unknown as Json }, { onConflict: "key" });
  if (error) throw error;
}

// ---------------------------------------------------------------- small pieces

const STATUS_CELL: Record<Status, string> = {
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  crit: "bg-red-50 text-red-700",
  na: "text-muted-foreground",
};
const STRIPE: Record<Tile["cls"], string> = {
  "s-good": "bg-emerald-600",
  "s-warn": "bg-amber-600",
  "s-crit": "bg-red-600",
  "s-accent": "bg-verdant",
};

function Tiles({ tiles, testId }: { tiles: Tile[]; testId: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid={testId}>
      {tiles.map((t) => (
        <div key={t.label} className="relative overflow-hidden rounded-lg border border-input bg-background px-4 py-3">
          <div className={cn("absolute inset-y-0 left-0 w-1", STRIPE[t.cls])} />
          <div className={K0}>{t.label}</div>
          <div
            className={cn(
              "mt-1 text-[26px] font-semibold tabular-nums text-forest",
              t.cls === "s-good" && "text-emerald-700",
              t.cls === "s-crit" && "text-red-700",
            )}
          >
            {t.value}
          </div>
          <div className={K3}>{t.foot}</div>
        </div>
      ))}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-input bg-background p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-[16px] font-semibold text-forest">{title}</h2>
        {hint && <p className="max-w-xl text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function PillTag({ pill }: { pill: Pill }) {
  if (!pill) return null;
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 font-label text-[10px] font-semibold uppercase tracking-[0.05em]", STATUS_CELL[pill.cls], pill.cls === "na" && "bg-muted")}>
      {pill.text}
    </span>
  );
}

/** Number input handler: "" clears (null), anything that is not a number is ignored. */
function onNumber(fn: (v: number | null) => void) {
  return (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.value === "") return fn(null);
    const v = Number(e.target.value);
    if (Number.isFinite(v)) fn(v);
  };
}

/** Copy of a map with one key set, or removed when the value is null. */
function setOrDelete(obj: Record<string, number>, k: string | number, v: number | null): Record<string, number> {
  const out = { ...obj };
  if (v == null) delete out[k];
  else out[k] = v;
  return out;
}

function RevenueChart({ state, plan, withEntered }: { state: GrowthState; plan: GrowthPlan | null; withEntered: boolean }) {
  const data = useMemo(() => revenueSeries(state, plan, withEntered), [state, plan, withEntered]);
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} />
          <YAxis tickFormatter={(v: number) => fmtMoney(v)} width={64} />
          <Tooltip formatter={(v) => (v == null ? "-" : fmtMoney(Number(v)))} />
          <Line dataKey="goal" name="Goal" stroke="#B07D1B" strokeDasharray="2 3" dot={false} isAnimationActive={false} />
          <Line dataKey="plan" name="Plan" stroke="#1B7A4E" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          <Line dataKey="actual" name="Actual (Jan to Jun)" stroke="#2C2C2C" strokeWidth={2.5} isAnimationActive={false} />
          {withEntered && (
            <Line dataKey="entered" name="Actual entered" stroke="#2C2C2C" strokeWidth={2.5} strokeDasharray="6 4" isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- Plan tab

const PLAN_FIELDS: Array<{ k: keyof PlanMonth; label: string }> = [
  { k: "signings", label: "Sign" },
  { k: "active", label: "Active" },
  { k: "newMrr", label: "New MRR" },
  { k: "base", label: "Base" },
  { k: "projects", label: "Projects" },
  { k: "rev", label: "Total" },
  { k: "calls", label: "Calls target" },
];

function PlanTab({ state, plan, onSave }: { state: GrowthState; plan: GrowthPlan | null; onSave: (p: GrowthPlan) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  if (editing || !plan) {
    return (
      <PlanEditor
        initial={plan ?? emptyPlan(new Date().getFullYear())}
        isNew={!plan}
        onCancel={plan ? () => setEditing(false) : undefined}
        onSave={async (p) => {
          await onSave(p);
          setEditing(false);
        }}
      />
    );
  }
  const s = planSummary(plan);
  const k = (v: number) => `$${Math.round(v / 1000)}k`;
  return (
    <div className="space-y-5">
      <Block
        title={`The growth model: plan to ${fmtMoney(s.goal)}`}
        hint={`Signings ramp from ${s.firstSignings} in July to ${s.lastSignings} in December.`}
      >
        <Tiles
          testId="growth-plan-tiles"
          tiles={[
            { cls: "s-accent", label: `${plan.year} goal`, value: fmtMoney(s.goal), foot: "full-year revenue" },
            { cls: s.projectedFinish >= s.goal ? "s-good" : "s-warn", label: "Projected finish", value: fmtMoney(s.projectedFinish), foot: "at the planned ramp" },
            { cls: "s-accent", label: "Exit run-rate", value: fmtMoney(s.exitRunRate), foot: "December, per month" },
            { cls: "s-accent", label: "Clients to sign", value: `${s.clientsToSign}`, foot: `${s.activeByDec} active by Dec` },
          ]}
        />
        <RevenueChart state={state} plan={plan} withEntered={false} />
      </Block>
      <Block title="Monthly plan (H2)">
        <div className={K13}>
          <table className={KK0} data-testid="growth-plan-table">
            <thead>
              <tr className={K4}>
                <th className={K12}>Month</th>
                {PLAN_FIELDS.slice(0, 6).map((f) => (
                  <th key={f.k} className={K12}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.months.map((m, i) => (
                <tr key={i} className={K11}>
                  <td className={KK1}>{MONTHS[i + 6]}</td>
                  <td className={K1}>{m.signings}</td>
                  <td className={K1}>{m.active}</td>
                  <td className={K1}>{k(m.newMrr)}</td>
                  <td className={K1}>{k(m.base)}</td>
                  <td className={K1}>{k(m.projects)}</td>
                  <td className="px-2 py-1.5 font-semibold tabular-nums">{k(m.rev)}</td>
                </tr>
              ))}
              <tr className={K8}>
                <td className="px-2 py-1.5">Total</td>
                <td className={K1}>{s.clientsToSign}</td>
                <td className={K1}>{s.activeByDec}</td>
                <td className="px-2 py-1.5 text-muted-foreground" colSpan={3}>H2 revenue</td>
                <td className={K1}>{fmtMoney(s.h2Revenue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {plan.assumptions && (
          <div>
            <div className={K0}>Model assumptions</div>
            <p className="mt-1 text-[13px] text-muted-foreground">{plan.assumptions}</p>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit plan
        </Button>
      </Block>
    </div>
  );
}

function PlanEditor({
  initial,
  isNew,
  onCancel,
  onSave,
}: {
  initial: GrowthPlan;
  isNew: boolean;
  onCancel?: () => void;
  onSave: (p: GrowthPlan) => Promise<void>;
}) {
  const [draft, setDraft] = useState<GrowthPlan>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v === "" ? NaN : Number(v));
  const setMonth = (i: number, f: keyof PlanMonth, v: string) =>
    setDraft((d) => ({ ...d, months: d.months.map((m, j) => (j === i ? { ...m, [f]: num(v) } : m)) }));
  const shown = (v: number) => (Number.isFinite(v) ? String(v) : "");

  return (
    <Block
      title={isNew ? "Enter the plan" : "Edit the plan"}
      hint="Amounts in dollars. Stored in the database, builder only."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={K3}>
          Year
          <Input type="number" aria-label="Plan year" value={shown(draft.year)} onChange={(e) => setDraft({ ...draft, year: num(e.target.value) })} />
        </label>
        <label className={K3}>
          Full-year goal ($)
          <Input type="number" aria-label="Full-year goal" value={shown(draft.goal)} onChange={(e) => setDraft({ ...draft, goal: num(e.target.value) })} />
        </label>
        <label className={K3}>
          Judge weeks against targets from
          <Input type="date" aria-label="Targets from" value={draft.targetsFrom} onChange={(e) => setDraft({ ...draft, targetsFrom: e.target.value })} />
        </label>
      </div>
      <div>
        <div className={K0}>January to June actual revenue, per month ($)</div>
        <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {draft.h1Actuals.map((v, i) => (
            <label key={i} className={K3}>
              {MONTHS[i]}
              <Input
                type="number"
                aria-label={`${MONTHS[i]} actual revenue`}
                value={shown(v)}
                onChange={(e) => setDraft((d) => ({ ...d, h1Actuals: d.h1Actuals.map((x, j) => (j === i ? num(e.target.value) : x)) }))}
              />
            </label>
          ))}
        </div>
      </div>
      <div className={K13}>
        <table className="text-[13px]">
          <thead>
            <tr className="text-left font-label text-[10px] uppercase tracking-[0.06em] text-sage">
              <th className="px-1 py-1">Month</th>
              {PLAN_FIELDS.map((f) => (
                <th key={f.k} className="px-1 py-1">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.months.map((m, i) => (
              <tr key={i}>
                <td className="px-1 py-1 font-semibold">{MONTHS[i + 6]}</td>
                {PLAN_FIELDS.map((f) => (
                  <td key={f.k} className="px-1 py-1">
                    <Input
                      type="number"
                      className="w-28"
                      aria-label={`${MONTHS[i + 6]} ${f.label}`}
                      value={shown(m[f.k])}
                      onChange={(e) => setMonth(i, f.k, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="block text-[12px] text-muted-foreground">
        Model assumptions (shown under the plan table)
        <Textarea aria-label="Model assumptions" value={draft.assumptions} onChange={(e) => setDraft({ ...draft, assumptions: e.target.value })} />
      </label>
      {errors.length > 0 && (
        <ul className={KK2} role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            const errs = validatePlan(draft);
            setErrors(errs);
            if (errs.length) return;
            setBusy(true);
            try {
              await onSave(draft);
            } catch (e) {
              setErrors([`Could not save the plan: ${errorText(e)}`]);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save plan
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </Block>
  );
}

// ---------------------------------------------------------------- Progress tab

function ProgressTab({
  state,
  plan,
  now,
  update,
}: {
  state: GrowthState;
  plan: GrowthPlan | null;
  now: Date;
  update: (fn: (s: GrowthState) => GrowthState) => void;
}) {
  const [calMonth, setCalMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [dealDate, setDealDate] = useState(() => iso(now));
  const [dealClient, setDealClient] = useState("");
  const [dealPrice, setDealPrice] = useState("");

  const kpis = computeKpis(state, plan, now);
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const callTotal = monthCallTotal(state, y, m);
  const callTarget = planMonth(plan, m)?.calls ?? null;
  const tally = dealTally(state, plan, now);
  const todayKey = iso(now);
  const deals = sortedDeals(state);
  const dealTotal = state.deals.reduce((a, d) => a + (+d.price || 0), 0);

  const addDeal = () => {
    const price = Number(dealPrice);
    if (!price) return;
    update((s) => ({
      ...s,
      deals: [...s.deals, { id: newDealId(), date: dealDate || iso(new Date()), client: dealClient.trim(), price }],
    }));
    setDealClient("");
    setDealPrice("");
  };

  return (
    <div className="space-y-5">
      <Tiles testId="growth-progress-tiles" tiles={progressTiles(kpis, plan)} />

      <Block title="Revenue vs. plan" hint="Enter each month's actual as it closes.">
        <RevenueChart state={state} plan={plan} withEntered />
        <div className={K0}>Enter monthly actual revenue ($)</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {H2_MONTHS.map((mi) => (
            <label key={mi} className="rounded-md border border-input bg-muted/30 px-2.5 py-2 text-[11px] uppercase text-sage">
              {MONTHS[mi]}
              <span className="ml-1 normal-case text-muted-foreground">plan {planMonth(plan, mi) ? fmtMoney(planMonth(plan, mi)!.rev) : "-"}</span>
              <Input
                type="number"
                min={0}
                step={1000}
                aria-label={`${MONTHS[mi]} actual revenue`}
                value={state.rev[mi] ?? ""}
                onChange={onNumber((v) => update((s) => ({ ...s, rev: setOrDelete(s.rev, mi, v) })))}
              />
            </label>
          ))}
        </div>
      </Block>

      <Block title="Calls booked">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setCalMonth(new Date(y, m - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] font-heading text-[17px] text-forest" data-testid="growth-cal-label">
            {monthName(m)} {y}
          </span>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setCalMonth(new Date(y, m + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="ml-auto flex items-center gap-3" data-testid="growth-cal-tally">
            <span className={K2}>{callTotal}</span>
            <span className={K6}>of {callTarget ?? "-"} target</span>
            <PillTag pill={callTallyPill(callTotal, callTarget, y, m, now)} />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="text-center font-label text-[10px] uppercase text-sage">{d}</div>
          ))}
          {calendarCells(y, m).map((c, i) =>
            c ? (
              <div
                key={c.key}
                className={cn(
                  "flex min-h-[58px] flex-col rounded-md border border-input px-1.5 py-1",
                  c.weekend ? "bg-muted/40" : "bg-background",
                  c.key === todayKey && "border-verdant ring-1 ring-verdant",
                )}
              >
                <span className="text-[10px] text-muted-foreground">{c.day}</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={`Calls on ${c.key}`}
                  className="w-full flex-1 bg-transparent text-center text-[18px] font-semibold tabular-nums text-forest focus:outline-none"
                  value={state.calls[c.key] ?? ""}
                  onChange={onNumber((v) => update((s) => ({ ...s, calls: setOrDelete(s.calls, c.key, v) })))}
                />
              </div>
            ) : (
              <div key={`blank-${i}`} />
            ),
          )}
        </div>
      </Block>

      <Block title="Deals closed" hint="Every deal closed and its monthly billing (MRR), against the signing goal.">
        <div className="flex flex-wrap items-center gap-6" data-testid="growth-deal-tally">
          {(
            [
              [`${tally.count}${tally.target != null ? ` / ${tally.target}` : ""}`, `${tally.month} deals`, tally.pill],
              [`${fmtMoney(tally.value)}/mo`, "new MRR this month", null],
              [`${fmtMoney(tally.allValue)}/mo`, "total MRR booked", null],
            ] as const
          ).map(([v, label, pill]) => (
            <div key={label} className={K9}>
              <span className={K2}>{v}</span>
              <span className={K6}>{label}</span>
              <PillTag pill={pill} />
            </div>
          ))}
        </div>
        <div className={KK3}>
          <Input type="date" className="w-40" aria-label="Deal date" value={dealDate} onChange={(e) => setDealDate(e.target.value)} />
          <Input className="min-w-[150px] flex-1" placeholder="Client name" aria-label="Client name" value={dealClient} onChange={(e) => setDealClient(e.target.value)} />
          <Input
            type="number"
            min={0}
            className="w-32"
            placeholder="Monthly $"
            aria-label="Monthly price"
            value={dealPrice}
            onChange={(e) => setDealPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addDeal();
            }}
          />
          <Button onClick={addDeal}>Add deal</Button>
        </div>
        <div className={K13}>
          <table className={KK0} data-testid="growth-deal-table">
            <thead>
              <tr className={K4}>
                <th className={K12}>Date</th>
                <th className={K12}>Client</th>
                <th className={K12}>Monthly</th>
                <th className={K12} />
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted-foreground">No deals logged yet.</td>
                </tr>
              )}
              {deals.map((d) => {
                const dt = parseISO(d.date);
                return (
                  <tr key={d.id} className={K11}>
                    <td className={KK1}>{`${MONTHS[dt.getMonth()]} ${dt.getDate()}`}</td>
                    <td className="px-2 py-1.5">{d.client || "-"}</td>
                    <td className={K1}>${(+d.price || 0).toLocaleString()}/mo</td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        aria-label={`Delete deal ${d.client || d.date}`}
                        className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-700"
                        onClick={() => update((s) => ({ ...s, deals: s.deals.filter((x) => x.id !== d.id) }))}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {deals.length > 0 && (
                <tr className={K8}>
                  <td className="px-2 py-1.5">Total MRR</td>
                  <td />
                  <td className={K1}>${dealTotal.toLocaleString()}/mo</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Block>
    </div>
  );
}

// ---------------------------------------------------------------- Outputs tab

function OutputsTab({
  state,
  plan,
  now,
  update,
}: {
  state: GrowthState;
  plan: GrowthPlan | null;
  now: Date;
  update: (fn: (s: GrowthState) => GrowthState) => void;
}) {
  const year = plan?.year ?? now.getFullYear();
  const ts = targetSum(state);
  const weeks = sheetWeeks(state, now, year);
  const months = H2_MONTHS;
  const goals = months.map((mi) => ts * weeksInMonth(mi, year));

  return (
    <div className="space-y-5">
      <Block title="Marketing and advertising output">
        <Tiles testId="growth-score-tiles" tiles={scoreTiles(state, plan)} />
        <div className={K0}>Monthly output vs. goal</div>
        <div className={K13}>
          <table className={KK4} data-testid="growth-monthly-table">
            <thead>
              <tr className={K7}>
                <th className="px-3 py-2 text-left" />
                {months.map((mi) => (
                  <th key={mi} className="px-3 py-2">{MONTHS[mi]}</th>
                ))}
                <th className={KK5}>H2</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={KK6}>Output</td>
                {months.map((mi) => (
                  <td key={mi} className="px-3 py-1.5 tabular-nums">{monthOut(state, mi)}</td>
                ))}
                <td className="bg-muted/40 px-3 py-1.5 font-semibold tabular-nums">{allTimeTotal(state).toLocaleString()}</td>
              </tr>
              <tr>
                <td className={KK6}>Goal</td>
                {goals.map((g, i) => (
                  <td key={i} className="px-3 py-1.5 text-[12px] text-muted-foreground">{g}</td>
                ))}
                <td className="bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground">{goals.reduce((a, g) => a + g, 0)}</td>
              </tr>
              <tr className={KK7}>
                <td className="px-3 py-1.5 text-left">% to goal</td>
                {months.map((mi, i) => {
                  const o = monthOut(state, mi);
                  const p = goals[i] ? Math.round((o / goals[i]) * 100) : 0;
                  const st: Status | null = o <= 0 ? null : p >= 100 ? "good" : p >= 60 ? "warn" : "crit";
                  return (
                    <td key={mi} className={cn("px-3 py-1.5 tabular-nums", st && STATUS_CELL[st])}>
                      {o > 0 ? `${p}%` : "-"}
                    </td>
                  );
                })}
                <td className="bg-muted/40" />
              </tr>
            </tbody>
          </table>
        </div>
      </Block>

      <Block
        title="Weekly log: the spreadsheet"
        hint="One column per week (Mon to Sun). Cells turn green at target."
      >
        <div className="flex flex-wrap gap-4 text-[12px] text-muted-foreground">
          <span className={K10}><span className="h-3 w-3 rounded-sm bg-emerald-600" />Hit target</span>
          <span className={K10}><span className="h-3 w-3 rounded-sm bg-amber-600" />Within 60%</span>
          <span className={K10}><span className="h-3 w-3 rounded-sm bg-red-600" />Under target</span>
        </div>
        <div className="overflow-x-auto rounded-md border border-input">
          <table className={KK4} data-testid="growth-sheet">
            <thead>
              <tr className={K7}>
                <th className="sticky left-0 bg-background px-3 py-2 text-left">Channel</th>
                <th className={K12}>Tgt</th>
                {weeks.map((k) => {
                  const [a, b] = weekRange(k);
                  return (
                    <th key={k} className="px-2 py-2 whitespace-nowrap">
                      {a}
                      <br />
                      to {b}
                      {weekExempt(k, plan) && <span className="block text-[9px] normal-case text-muted-foreground">no target</span>}
                    </th>
                  );
                })}
                <th className={KK5}>Total</th>
              </tr>
            </thead>
            <tbody>
              {ACTS.map((a) => {
                const t = +state.targets[a.k];
                return (
                  <tr key={a.k} className={K11}>
                    <td className="sticky left-0 whitespace-nowrap bg-background px-3 py-1 text-left font-semibold">{a.n}</td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min={0}
                        aria-label={`${a.n} weekly target`}
                        className="w-14 rounded border border-input bg-background px-1 py-1 text-center tabular-nums"
                        value={Number.isFinite(t) ? t : ""}
                        onChange={onNumber((v) => update((s) => ({ ...s, targets: { ...s.targets, [a.k]: v ?? 0 } })))}
                      />
                    </td>
                    {weeks.map((k) => {
                      const v = state.weeks[k]?.acts?.[a.k];
                      const st = weekExempt(k, plan) ? null : cellStatus(v, t);
                      return (
                        <td key={k} className={cn("px-0.5 py-0.5", st && STATUS_CELL[st])}>
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            aria-label={`${a.n}, week ending ${k}`}
                            className="w-14 rounded border border-transparent bg-transparent px-1 py-1.5 text-center text-[16px] tabular-nums focus:border-verdant focus:outline-none"
                            value={v ?? ""}
                            onChange={onNumber((nv) =>
                              update((s) => {
                                const prev = s.weeks[k] ?? emptyWeek();
                                return { ...s, weeks: { ...s.weeks, [k]: { ...prev, acts: setOrDelete(prev.acts, a.k, nv) } } };
                              }),
                            )}
                          />
                        </td>
                      );
                    })}
                    <td className="bg-muted/40 px-3 py-1 font-semibold tabular-nums">{channelTotal(state, a.k).toLocaleString()}</td>
                  </tr>
                );
              })}
              <tr className={KK7}>
                <td className="sticky left-0 bg-background px-3 py-1.5 text-left">Weekly total</td>
                <td className="px-2 py-1.5 text-[12px] text-muted-foreground">{ts}</td>
                {weeks.map((k) => {
                  const has = Object.keys(state.weeks[k]?.acts ?? {}).length > 0;
                  const v = weekActs(state, k);
                  const st = weekExempt(k, plan) || !has ? null : weekTotalStatus(v, ts);
                  return (
                    <td key={k} className={cn("px-2 py-1.5 tabular-nums", st && STATUS_CELL[st])} data-testid={`growth-week-total-${k}`}>
                      {has ? v : ""}
                    </td>
                  );
                })}
                <td className="bg-muted/40 px-3 py-1.5 tabular-nums">{allTimeTotal(state).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Block>
    </div>
  );
}

// ---------------------------------------------------------------- Import tab

function ImportTab({ hasData, onImport }: { hasData: boolean; onImport: (s: GrowthState) => Promise<void> }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setText(t);
    setResult(parseGrowthImport(t));
    setDone(null);
  };

  return (
    <Block
      title="One-time import from the old Growth Dashboard"
      hint="Plan figures go on the Plan tab."
    >
      <ol className="list-decimal space-y-2 pl-5 text-[13px] text-muted-foreground">
        <li>In that browser, open goodo-growth-dashboard.vercel.app and its developer console.</li>
        <li>
          Run this to copy the numbers (the old page's "Copy data (JSON)" button does the same):
          <pre className={K5} data-testid="growth-export-command">
            {EXPORT_CONSOLE_COMMAND}
          </pre>
        </li>
        <li>Paste the result below (or choose a saved file), check it, then save.</li>
      </ol>
      <Textarea
        aria-label="Exported JSON"
        className="min-h-[140px] font-mono text-[12px]"
        placeholder="Exported JSON"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
          setDone(null);
        }}
      />
      <div className={KK3}>
        <Input type="file" accept=".json,.txt" aria-label="Exported JSON file" className="w-auto" onChange={readFile} />
        <Button variant="outline" onClick={() => setResult(parseGrowthImport(text))}>
          Check
        </Button>
      </div>
      {result && !result.ok && (
        <ul className={KK2} role="alert" data-testid="growth-import-errors">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {result && result.ok && (
        <div className="space-y-2 rounded-md border border-input bg-muted/30 p-3 text-[13px]" data-testid="growth-import-summary">
          <p>
            Found {result.summary.revMonths} months of revenue, {result.summary.callDays} days of calls, {result.summary.deals} deals
            and {result.summary.weeks} weeks of output counts.
          </p>
          {result.warnings.map((w) => (
            <p key={w} className={KK8}>{w}</p>
          ))}
          {hasData && <p className={KK8}>Saving replaces the numbers already stored in Verdanote.</p>}
          {saveError && <p className="text-red-700" role="alert">{saveError}</p>}
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setSaveError(null);
              try {
                await onImport(result.state);
                setDone("Imported. The numbers are now stored in Verdanote.");
                setResult(null);
                setText("");
              } catch (e) {
                setSaveError(`Could not save: ${errorText(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {hasData ? "Replace saved numbers" : "Save to Verdanote"}
          </Button>
        </div>
      )}
      {done && <p className="text-[13px] text-emerald-700" role="status">{done}</p>}
    </Block>
  );
}

// ---------------------------------------------------------------- page

type SaveStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error"; message: string };

function hasNumbers(s: GrowthState): boolean {
  return Object.keys(s.rev).length + Object.keys(s.calls).length + s.deals.length + Object.keys(s.weeks).length > 0;
}

export default function GrowthDashboardPage({ now: nowProp }: { now?: Date } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: GROWTH_QUERY_KEY, queryFn: loadRows });
  const [state, setState] = useState<GrowthState | null>(null);
  const [plan, setPlan] = useState<GrowthPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [tab, setTab] = useState("plan");
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const stateRef = useRef<GrowthState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialised = useRef(false);

  useEffect(() => {
    if (!query.data || initialised.current) return;
    initialised.current = true;
    const s = stateFromRow(query.data.state);
    if (s.error) setLoadError(s.error);
    stateRef.current = s.state;
    setState(s.state);
    setPlan(planFromRow(query.data.plan));
  }, [query.data]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const persistState = useCallback(async (next: GrowthState) => {
    setSaveStatus({ kind: "saving" });
    try {
      await saveRow("state", next);
      setSaveStatus({ kind: "saved", at: new Date() });
    } catch (e) {
      setSaveStatus({ kind: "error", message: errorText(e) });
    }
  }, []);

  const update = useCallback(
    (fn: (s: GrowthState) => GrowthState) => {
      const cur = stateRef.current;
      if (!cur) return;
      const next = fn(cur);
      stateRef.current = next;
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persistState(next), SAVE_DELAY_MS);
    },
    [persistState],
  );

  const savePlan = useCallback(
    async (p: GrowthPlan) => {
      await saveRow("plan", p);
      setPlan(p);
      void queryClient.invalidateQueries({ queryKey: GROWTH_QUERY_KEY });
    },
    [queryClient],
  );

  const importState = useCallback(
    async (s: GrowthState) => {
      if (timer.current) clearTimeout(timer.current);
      await saveRow("state", s);
      stateRef.current = s;
      setState(s);
      setLoadError(null);
      setSaveStatus({ kind: "saved", at: new Date() });
      void queryClient.invalidateQueries({ queryKey: GROWTH_QUERY_KEY });
    },
    [queryClient],
  );

  const header = (
    <PageHeader
      title="Growth Dashboard"
      description="Revenue, calls, deals and weekly output. Builder only."
      actions={
        <div className="text-right">
          <div className={K0}>Today</div>
          <div className="text-[14px] font-semibold">
            {now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      }
    />
  );

  if (query.isLoading || (query.data && !initialised.current && !query.error)) {
    return (
      <div>
        {header}
        <p className={K6}>Loading the numbers...</p>
      </div>
    );
  }
  if (query.error) {
    return (
      <div>
        {header}
        <p className="text-[13px] text-red-700" role="alert">
          Could not load the Growth Dashboard: {errorText(query.error)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <div className="flex flex-col gap-1 rounded-lg border border-input bg-sage-light px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="font-label text-[11px] uppercase tracking-[0.12em] text-verdant">Today's fuel</span>
        <span className="font-heading text-[17px] text-forest" data-testid="growth-quote">{quote}</span>
      </div>

      {loadError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">
          Stored numbers failed the checks, so editing is off. Import a fresh export to replace them: {loadError}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="progress" disabled={!state}>Progress</TabsTrigger>
          <TabsTrigger value="outputs" disabled={!state}>Outputs</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>
        <TabsContent value="plan">
          <PlanTab state={state ?? { rev: {}, weeks: {}, targets: {}, calls: {}, deals: [] }} plan={plan} onSave={savePlan} />
        </TabsContent>
        {state && (
          <TabsContent value="progress">
            <ProgressTab state={state} plan={plan} now={now} update={update} />
          </TabsContent>
        )}
        {state && (
          <TabsContent value="outputs">
            <OutputsTab state={state} plan={plan} now={now} update={update} />
          </TabsContent>
        )}
        <TabsContent value="import">
          <ImportTab hasData={!!state && hasNumbers(state)} onImport={importState} />
        </TabsContent>
      </Tabs>

      <div className={K3} data-testid="growth-save-status">
        {saveStatus.kind === "idle" && "Changes save automatically."}
        {saveStatus.kind === "saving" && "Saving..."}
        {saveStatus.kind === "saved" &&
          `Saved ${saveStatus.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}
        {saveStatus.kind === "error" && <span className="text-red-700">Not saved: {saveStatus.message}</span>}
      </div>
    </div>
  );
}
