import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Download, HelpCircle, ChevronDown } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { MultiLineTrendChart, type TrendLine } from "@/components/MultiLineTrendChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { ChartSkeleton } from "@/components/skeletons/ChartSkeleton";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { getCreativeRotation, type FreshDays } from "@/lib/api";
import { downloadCSV } from "@/lib/csv";

const FRESH_OPTIONS: FreshDays[] = [7, 14, 30];

const fmtMoney = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtMoney2 = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${(n ?? 0).toFixed(1)}%`;
const fmtNum = (n: number) => (n ?? 0).toLocaleString();

type CohortView = "weekly" | "monthly";
interface CohortRow {
  launch_week: string;
  creative_count: number;
  still_live: number;
  spend: number;
  spend_share: number;
  purchases: number;
  purchase_value: number;
  cpa: number;
  roas: number;
}

/** Big headline KPI tile (matches the Data-Druid reference top strip). `accent`
 *  emphasises the freshness tile; `delta` shows the vs-prior trend chip. */
function KpiTile({
  label, value, sub, accent = false, delta,
}: {
  label: string; value: string; sub?: string; accent?: boolean;
  delta?: { pp: number } | null;
}) {
  return (
    <Card className={accent ? "border-verdant/40 bg-sage-light/30" : undefined}>
      <CardContent className="p-4">
        <p className="font-body text-[11px] uppercase tracking-wide text-slate leading-tight">{label}</p>
        <p className={`font-heading text-[28px] mt-1 ${accent ? "text-verdant" : "text-charcoal"}`}>{value}</p>
        {sub && <p className="font-body text-[12px] text-muted-foreground mt-0.5">{sub}</p>}
        {delta && (
          <p className={`font-body text-[12px] mt-0.5 ${delta.pp < 0 ? "text-red-500" : "text-verdant"}`}>
            {delta.pp < 0 ? "▼" : "▲"} {Math.abs(delta.pp).toFixed(1)}pp vs prior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const HELP_KEY = "verdanote:rotation-help-collapsed";

/** Plain-language "how to read this page" panel. Defaults open so first-time
 *  viewers discover what the page is for; collapses to a one-line header and
 *  remembers the choice (localStorage) so repeat users aren't nagged. */
function RotationHelp({ freshDays }: { freshDays: FreshDays }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(HELP_KEY) === "1"; } catch { return false; }
  });
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(HELP_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <Card className="border-verdant/30 bg-sage-light/10">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <HelpCircle className="h-4 w-4 text-verdant shrink-0" />
        <span className="font-body text-[14px] font-semibold text-charcoal flex-1">
          How to read this page
        </span>
        <span className="font-body text-[12px] text-slate">{collapsed ? "Show" : "Hide"}</span>
        <ChevronDown className={`h-4 w-4 text-slate transition-transform ${collapsed ? "" : "rotate-180"}`} />
      </button>

      {!collapsed && (
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          <p className="font-body text-[13px] leading-relaxed text-charcoal">
            Meta ads get more expensive as they age — audiences see them too many times and stop
            responding (&ldquo;creative fatigue&rdquo;). The cure is a steady flow of new creative. This page
            shows <span className="font-semibold">how much of your spend is going to fresh vs. older
            creative</span>, and whether the fresh stuff is actually converting more cheaply — so you can
            tell if you&rsquo;re launching enough, and whether it&rsquo;s paying off.
          </p>
          <p className="font-body text-[13px] leading-relaxed text-charcoal">
            The <span className="font-semibold">&ldquo;New = ≤{freshDays} days&rdquo;</span> toggle (top right) sets what
            counts as &ldquo;fresh.&rdquo; Everything below re-calculates against it.
          </p>
          <ul className="font-body text-[13px] leading-relaxed text-charcoal space-y-1.5 pl-1">
            <li><span className="font-semibold">Freshness</span> — the share of spend going to fresh creative. Higher means more of your budget is behind new ads.</li>
            <li><span className="font-semibold">Spend-weighted creative age</span> — the average age of a dollar you spent. A rising number means your budget is leaning on older ads.</li>
            <li><span className="font-semibold">Fresh vs. Stale CPA</span> — what a purchase costs from new vs. old creative. If stale CPA is higher, aging ads are dragging your efficiency down.</li>
            <li><span className="font-semibold">Weekly spend by creative age</span> — how each week&rsquo;s budget split across fresh / mid / stale.</li>
            <li><span className="font-semibold">Freshness vs. CPA</span> — whether weeks with more fresh spend actually had a lower cost per purchase.</li>
            <li><span className="font-semibold">Launch cohorts</span> — ads grouped by when they launched, so you can see how each &ldquo;generation&rdquo; performs and how long it keeps spending.</li>
            <li><span className="font-semibold">New ads over time</span> — your launch cadence: how many new ads you&rsquo;re shipping.</li>
          </ul>
          <p className="font-body text-[13px] leading-relaxed text-charcoal">
            <span className="font-semibold">How to use it:</span> if freshness is trending down while stale CPA
            climbs, that&rsquo;s your cue to ship more new creative. The launch cohorts tell you which recent
            batches are still carrying spend — and which have already faded.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

const CreativeRotationPage = () => {
  const { isBuilder, isEmployee } = useAuth();
  const { selectedAccountId, selectedAccount, isLoading: accountLoading } = useAccountContext();

  const [freshDays, setFreshDays] = useState<FreshDays>(14);
  const [cohortView, setCohortView] = useState<CohortView>("weekly");
  const [dateFrom, setDateFrom] = useState<string | undefined>(
    () => format(subDays(new Date(), 90), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState<string | undefined>(
    () => format(subDays(new Date(), 1), "yyyy-MM-dd"),
  );

  // Staff rollout (2026-07-21): available (here `gated` means allowed) to builder
  // AND employee roles on ANY account; the route gates clients away.
  // NOTE the boolean coercion: `a || b` can be undefined, and react-query treats
  // `enabled: undefined` as ENABLED — a bare disjunction would let non-staff
  // roles fire the query.
  const gated = !!(isBuilder || isEmployee);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["creative-rotation", selectedAccountId, dateFrom, dateTo, freshDays],
    enabled: gated && !!selectedAccountId && !!dateFrom && !!dateTo,
    queryFn: () => getCreativeRotation(selectedAccountId!, dateFrom!, dateTo!, freshDays),
  });

  const weekly = data?.weekly_age ?? [];
  const weekDates = useMemo(() => weekly.map((w) => w.week_start), [weekly]);

  const spendByAgeLines = useMemo<TrendLine[]>(() => [
    { key: "fresh", label: `Fresh (≤${freshDays}d)`, color: "#22c55e", prefix: "$", decimals: 0, values: weekly.map((w) => w.fresh_spend) },
    { key: "mid", label: `Mid (≤${freshDays * 2}d)`, color: "#eab308", prefix: "$", decimals: 0, values: weekly.map((w) => w.mid_spend) },
    { key: "stale", label: "Stale", color: "#ef4444", prefix: "$", decimals: 0, values: weekly.map((w) => w.stale_spend) },
  ], [weekly, freshDays]);

  const freshnessVsCpaLines = useMemo<TrendLine[]>(() => [
    { key: "fresh_pct", label: "% Spend Fresh", color: "#22c55e", suffix: "%", decimals: 1, values: weekly.map((w) => w.fresh_spend_pct) },
    { key: "fresh_cpa", label: "Fresh CPA", color: "#3b82f6", prefix: "$", decimals: 2, values: weekly.map((w) => w.fresh_cpa) },
    { key: "stale_cpa", label: "Stale CPA", color: "#ef4444", prefix: "$", decimals: 2, values: weekly.map((w) => w.stale_cpa) },
  ], [weekly]);

  const newAdsLines = useMemo<TrendLine[]>(() => {
    const t = data?.new_ads_timeline ?? [];
    return [
      { key: "new_ads", label: "New ads", color: "#8b5cf6", decimals: 0, values: t.map((r) => r.new_ads) },
      { key: "cumulative", label: "Cumulative", color: "#64748b", decimals: 0, values: t.map((r) => r.cumulative) },
    ];
  }, [data]);
  const newAdsDates = useMemo(() => (data?.new_ads_timeline ?? []).map((r) => r.week_start), [data]);

  // Freshness vs prior: spend-weighted % on ≤freshDays creative over the most
  // recent N weeks (N = the "New" window) vs the N weeks before it.
  const freshnessDelta = useMemo(() => {
    const w = weekly.filter((x) => x.total_spend > 0);
    const span = Math.max(1, Math.round(freshDays / 7));
    if (w.length < span * 2) return null;
    const freshPct = (arr: typeof w) => {
      const t = arr.reduce((a, x) => ({ f: a.f + x.fresh_spend, s: a.s + x.total_spend }), { f: 0, s: 0 });
      return t.s > 0 ? (t.f / t.s) * 100 : 0;
    };
    const cur = freshPct(w.slice(-span));
    const prev = freshPct(w.slice(-span * 2, -span));
    return { cur, prev, pp: cur - prev };
  }, [weekly, freshDays]);

  // Insight banner: median account CPA in the weeks with the most vs least fresh spend.
  const insight = useMemo(() => {
    const w = weekly.filter((x) => x.total_spend > 0);
    if (w.length < 6) return null;
    const n = Math.min(6, Math.floor(w.length / 2));
    const byFresh = [...w].sort((a, b) => b.fresh_spend_pct - a.fresh_spend_pct);
    const weekCpa = (x: typeof w[number]) => {
      const p = (x.fresh_purchases ?? 0) + (x.stale_purchases ?? 0);
      return p > 0 ? x.total_spend / p : null;
    };
    const median = (arr: typeof w) => {
      const v = arr.map(weekCpa).filter((x): x is number => x != null).sort((a, b) => a - b);
      if (!v.length) return null;
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const top = byFresh.slice(0, n), bottom = byFresh.slice(-n);
    const topCpa = median(top), botCpa = median(bottom);
    if (topCpa == null || botCpa == null) return null;
    const avgFresh = (arr: typeof w) => arr.reduce((s, x) => s + x.fresh_spend_pct, 0) / arr.length;
    return { n, topCpa, botCpa, topFresh: avgFresh(top), botFresh: avgFresh(bottom) };
  }, [weekly]);

  // Launch cohorts: filter to the selected date window, aggregate weekly→monthly
  // when requested, recompute share over the visible set, and order recent-first.
  const cohortRows = useMemo<CohortRow[]>(() => {
    let rows: CohortRow[] = (data?.cohorts ?? []).filter(
      (c) => (!dateFrom || c.launch_week >= dateFrom) && (!dateTo || c.launch_week <= dateTo),
    );
    if (cohortView === "monthly") {
      const byMonth = new Map<string, CohortRow>();
      for (const c of rows) {
        const key = c.launch_week.slice(0, 7); // YYYY-MM
        const m = byMonth.get(key) ?? {
          launch_week: `${key}-01`, creative_count: 0, still_live: 0, spend: 0,
          spend_share: 0, purchases: 0, purchase_value: 0, cpa: 0, roas: 0,
        };
        m.creative_count += c.creative_count; m.still_live += c.still_live; m.spend += c.spend;
        m.purchases += c.purchases; m.purchase_value += c.purchase_value;
        byMonth.set(key, m);
      }
      rows = [...byMonth.values()];
    }
    const grand = rows.reduce((s, c) => s + c.spend, 0) || 1;
    rows = rows.map((c) => ({
      ...c,
      spend_share: (c.spend / grand) * 100,
      cpa: c.purchases > 0 ? c.spend / c.purchases : 0,
      roas: c.spend > 0 ? c.purchase_value / c.spend : 0,
    }));
    return rows.sort((a, b) => b.launch_week.localeCompare(a.launch_week)); // recent first
  }, [data, dateFrom, dateTo, cohortView]);

  const cohortLabel = (launchWeek: string) =>
    cohortView === "monthly"
      ? format(new Date(launchWeek), "MMM yyyy")
      : `Wk of ${format(new Date(launchWeek), "MMM d, yyyy")}`;

  const handleExportCohorts = () => {
    const headers = [cohortView === "monthly" ? "Month" : "Launch week", "Creatives", "Still Live", "Spend", "Share %", "Purchases", "Purchase Value", "CPA", "ROAS"];
    const rows = cohortRows.map((c) => [
      cohortLabel(c.launch_week), String(c.creative_count), String(c.still_live),
      c.spend.toFixed(2), c.spend_share.toFixed(1), String(c.purchases),
      c.purchase_value.toFixed(2), c.cpa.toFixed(2), c.roas.toFixed(2),
    ]);
    downloadCSV(`creative-rotation-cohorts-${cohortView}-${dateFrom}_${dateTo}.csv`, headers, rows);
  };

  if (accountLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 rounded-md bg-muted relative overflow-hidden"><div className="absolute inset-0 shimmer-slide" /></div>
        <MetricCardSkeletonRow />
        <ChartSkeleton />
      </div>
    );
  }

  if (!gated) {
    return (
      <>
        <PageHeader title="Creative Rotation" description="Creative freshness, age, and launch cadence." />
        <Card>
          <CardContent className="p-8 text-center">
            <p className="font-body text-[14px] text-slate">
              Creative Rotation is available to the builder role. Switch to a builder account to view it.
            </p>
          </CardContent>
        </Card>
      </>
    );
  }

  const kpis = data?.kpis;

  return (
    <>
      <PageHeader
        title="Creative Rotation"
        description="How much spend goes to new creative — and what happens to CPA as spend concentrates on fresh vs old."
        actions={
          <div className="flex items-center gap-2">
            <span className="font-body text-[12px] text-slate">&ldquo;New&rdquo; =</span>
            <div className="flex items-center rounded-md border border-border-light overflow-hidden">
              {FRESH_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setFreshDays(n)}
                  className={`px-3 py-1.5 font-body text-[13px] ${
                    freshDays === n ? "bg-verdant text-white" : "text-slate hover:bg-cream-dark"
                  }`}
                >
                  ≤{n} days
                </button>
              ))}
            </div>
            <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
          </div>
        }
      />

      <div className="mb-6">
        <RotationHelp freshDays={freshDays} />
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <MetricCardSkeletonRow />
          <ChartSkeleton />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="font-body text-[14px] text-red-500">
              {error instanceof Error ? error.message : "Failed to load Creative Rotation."}
            </p>
          </CardContent>
        </Card>
      ) : !kpis || kpis.total_spend <= 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="font-body text-[14px] text-slate">No spend in this window for {selectedAccount?.name ?? "this account"}.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Headline KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile
              accent
              label={`Freshness · % of spend on ≤${freshDays}d creative`}
              value={fmtPct(kpis.fresh_spend_pct)}
              sub={`${fmtMoney(kpis.fresh_spend)} of ${fmtMoney(kpis.total_spend)}`}
              delta={freshnessDelta ? { pp: freshnessDelta.pp } : null}
            />
            <KpiTile
              label="Spend-weighted creative age"
              value={`${Math.round(kpis.spend_weighted_age ?? 0)} days`}
              sub="mean age of a spent dollar"
            />
            <KpiTile
              label={`Fresh CPA (≤${freshDays}d)`}
              value={fmtMoney2(kpis.fresh_cpa)}
              sub={`${fmtNum(kpis.fresh_purchases)} purchases`}
            />
            <KpiTile
              label={`Stale CPA (>${freshDays}d)`}
              value={fmtMoney2(kpis.stale_cpa)}
              sub={kpis.stale_cpa > kpis.fresh_cpa ? "fresh converts cheaper" : "stale converts cheaper"}
            />
          </div>

          {/* Insight banner */}
          {insight && (
            <div className="rounded-md border-l-2 border-verdant bg-sage-light/20 px-4 py-3">
              <p className="font-body text-[14px] text-charcoal">
                In the {insight.n} weeks with the most spend on fresh creative (~{Math.round(insight.topFresh)}% ≤{freshDays}d),
                median CPA was {fmtMoney2(insight.topCpa)} — vs {fmtMoney2(insight.botCpa)} in the {insight.n} weeks with the least
                (~{Math.round(insight.botFresh)}%).
              </p>
            </div>
          )}

          {/* Weekly spend share by creative age */}
          <Card>
            <CardHeader><CardTitle className="text-[16px]">Weekly spend by creative age</CardTitle></CardHeader>
            <CardContent>
              <MultiLineTrendChart dates={weekDates} lines={spendByAgeLines} height={280} />
            </CardContent>
          </Card>

          {/* Freshness vs CPA */}
          <Card>
            <CardHeader><CardTitle className="text-[16px]">Freshness vs CPA</CardTitle></CardHeader>
            <CardContent>
              <MultiLineTrendChart dates={weekDates} lines={freshnessVsCpaLines} height={280} />
            </CardContent>
          </Card>

          {/* Launch-cohort table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-[16px]">Launch cohorts — spend & CPA of creatives by when they launched</CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-md border border-border-light overflow-hidden">
                  {(["weekly", "monthly"] as CohortView[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setCohortView(v)}
                      className={`px-3 py-1.5 font-body text-[13px] capitalize ${
                        cohortView === v ? "bg-verdant text-white" : "text-slate hover:bg-cream-dark"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="outline" onClick={handleExportCohorts} disabled={!cohortRows.length}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {cohortRows.length === 0 ? (
                <p className="font-body text-[13px] text-slate py-4">No creatives launched in the selected window.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border-light text-left text-slate">
                        <th className="py-2 pr-4 font-medium">Cohort</th>
                        <th className="py-2 pr-4 font-medium text-right">Creatives</th>
                        <th className="py-2 pr-4 font-medium text-right">Still live</th>
                        <th className="py-2 pr-4 font-medium text-right">Spend</th>
                        <th className="py-2 pr-4 font-medium text-right">Share</th>
                        <th className="py-2 pr-4 font-medium text-right">Purchases</th>
                        <th className="py-2 pr-4 font-medium text-right">CPA</th>
                        <th className="py-2 pr-4 font-medium text-right">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohortRows.map((c) => (
                        <tr key={c.launch_week} className="border-b border-border-light/50">
                          <td className="py-2 pr-4">{cohortLabel(c.launch_week)}</td>
                          <td className="py-2 pr-4 text-right">{fmtNum(c.creative_count)}</td>
                          <td className="py-2 pr-4 text-right">{fmtNum(c.still_live)}</td>
                          <td className="py-2 pr-4 text-right">{fmtMoney(c.spend)}</td>
                          <td className="py-2 pr-4 text-right">{fmtPct(c.spend_share)}</td>
                          <td className="py-2 pr-4 text-right">{fmtNum(c.purchases)}</td>
                          <td className="py-2 pr-4 text-right">{fmtMoney2(c.cpa)}</td>
                          <td className="py-2 pr-4 text-right">{(c.roas ?? 0).toFixed(2)}x</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* New ads added over time */}
          <Card>
            <CardHeader><CardTitle className="text-[16px]">New ads added over time</CardTitle></CardHeader>
            <CardContent>
              <MultiLineTrendChart dates={newAdsDates} lines={newAdsLines} height={260} />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
};

export default CreativeRotationPage;
