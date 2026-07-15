import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Download, Loader2 } from "lucide-react";

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

// Feature 3 (Creative Rotation) ships behind the builder account first
// (roadmap §4 "Rollout sequencing" — dogfood on Goodo before any account-wide
// rollout). Gate = builder ROLE (matches the /agency, /tagging, /ad-library
// role gates) AND the selected account being the builder account.
const BUILDER_ACCOUNT_ID = "act_782159176742035"; // Goodo Studios

const FRESH_OPTIONS: FreshDays[] = [7, 14, 30];

const fmtMoney = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${(n ?? 0).toFixed(1)}%`;
const fmtDays = (n: number) => `${(n ?? 0).toFixed(1)}d`;
const fmtNum = (n: number) => (n ?? 0).toLocaleString();

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-body text-[12px] text-slate">{label}</p>
        <p className="font-heading text-[24px] text-charcoal mt-1">{value}</p>
        {sub && <p className="font-body text-[12px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const CreativeRotationPage = () => {
  const { isBuilder } = useAuth();
  const { selectedAccountId, selectedAccount, isLoading: accountLoading } = useAccountContext();

  const [freshDays, setFreshDays] = useState<FreshDays>(14);
  const [dateFrom, setDateFrom] = useState<string | undefined>(
    () => format(subDays(new Date(), 90), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState<string | undefined>(
    () => format(subDays(new Date(), 1), "yyyy-MM-dd"),
  );

  const gated = isBuilder && selectedAccountId === BUILDER_ACCOUNT_ID;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["creative-rotation", selectedAccountId, dateFrom, dateTo, freshDays],
    enabled: gated && !!selectedAccountId && !!dateFrom && !!dateTo,
    queryFn: () => getCreativeRotation(selectedAccountId!, dateFrom!, dateTo!, freshDays),
  });

  // Weekly series for the two charts (stacked spend-by-age + freshness-vs-CPA).
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

  const handleExportCohorts = () => {
    const headers = ["Launch Week", "Creatives", "Still Live", "Spend", "Spend Share %", "Purchases", "Purchase Value", "CPA", "ROAS"];
    const rows = (data?.cohorts ?? []).map((c) => [
      c.launch_week, String(c.creative_count), String(c.still_live),
      c.spend.toFixed(2), c.spend_share.toFixed(1), String(c.purchases),
      c.purchase_value.toFixed(2), c.cpa.toFixed(2), c.roas.toFixed(2),
    ]);
    downloadCSV(`creative-rotation-cohorts-${dateFrom}_${dateTo}.csv`, headers, rows);
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
              Creative Rotation is currently available on the builder account only while we validate it.
              Switch to the Goodo Studios account to view this report.
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
        description="How fresh is your creative? Spend by age, fresh vs stale CPA, launch cohorts, and new-ad cadence."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-border-light overflow-hidden">
              {FRESH_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setFreshDays(n)}
                  className={`px-3 py-1.5 font-body text-[13px] ${
                    freshDays === n ? "bg-verdant text-white" : "text-slate hover:bg-cream-dark"
                  }`}
                >
                  {n}d
                </button>
              ))}
            </div>
            <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
          </div>
        }
      />

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
          {/* Freshness KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label={`% Spend on ≤${freshDays}d creative`} value={fmtPct(kpis.fresh_spend_pct)} sub={`${fmtMoney(kpis.fresh_spend)} of ${fmtMoney(kpis.total_spend)}`} />
            <Kpi label="Spend-weighted creative age" value={fmtDays(kpis.spend_weighted_age)} />
            <Kpi label="Fresh CPA" value={fmtMoney(kpis.fresh_cpa)} sub={`${fmtNum(kpis.fresh_purchases)} purchases`} />
            <Kpi label="Stale CPA" value={fmtMoney(kpis.stale_cpa)} sub={`${fmtNum(kpis.stale_purchases)} purchases`} />
          </div>

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
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-[16px]">Launch cohorts</CardTitle>
              <Button size="sm" variant="outline" onClick={handleExportCohorts} disabled={!(data?.cohorts?.length)}>
                <Download className="h-3.5 w-3.5 mr-1.5" />Export CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border-light text-left text-slate">
                      <th className="py-2 pr-4 font-medium">Launch week</th>
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
                    {(data?.cohorts ?? []).map((c) => (
                      <tr key={c.launch_week} className="border-b border-border-light/50">
                        <td className="py-2 pr-4">{format(new Date(c.launch_week), "MMM d, yyyy")}</td>
                        <td className="py-2 pr-4 text-right">{fmtNum(c.creative_count)}</td>
                        <td className="py-2 pr-4 text-right">{fmtNum(c.still_live)}</td>
                        <td className="py-2 pr-4 text-right">{fmtMoney(c.spend)}</td>
                        <td className="py-2 pr-4 text-right">{fmtPct(c.spend_share)}</td>
                        <td className="py-2 pr-4 text-right">{fmtNum(c.purchases)}</td>
                        <td className="py-2 pr-4 text-right">{fmtMoney(c.cpa)}</td>
                        <td className="py-2 pr-4 text-right">{(c.roas ?? 0).toFixed(2)}x</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
