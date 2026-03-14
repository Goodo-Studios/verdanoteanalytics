import { useState, useMemo, forwardRef } from "react";
import { Loader2, LineChart, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { startOfWeek, startOfMonth, format } from "date-fns";
import { MultiLineTrendChart, type TrendLine } from "@/components/MultiLineTrendChart";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DailyTrendPoint } from "@/hooks/useDailyTrends";

type Granularity = "daily" | "weekly" | "monthly";

interface TrendsTabProps {
  trendData: DailyTrendPoint[] | undefined;
  isLoading: boolean;
}

const METRIC_OPTIONS: { key: string; label: string; color: string; prefix?: string; suffix?: string; decimals?: number; invertColor?: boolean; compute?: (d: any) => number }[] = [
  { key: "spend", label: "Spend", color: "hsl(var(--primary))", prefix: "$", decimals: 0 },
  { key: "cpm", label: "CPM", color: "hsl(262, 83%, 58%)", prefix: "$", decimals: 2, invertColor: true },
  { key: "cpa", label: "CPA", color: "hsl(0, 84%, 60%)", prefix: "$", decimals: 2, invertColor: true },
  { key: "cpmr", label: "CPMR", color: "hsl(25, 95%, 53%)", prefix: "$", decimals: 2, invertColor: true, compute: (d: any) => (Number(d.cpm) || 0) * (Number(d.frequency) || 0) },
  { key: "frequency", label: "Frequency", color: "hsl(199, 89%, 48%)", decimals: 2 },
];

function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === "daily") return date;
  const d = new Date(date + "T12:00:00");
  if (granularity === "weekly") return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
  return format(startOfMonth(d), "yyyy-MM-dd");
}

function aggregateBuckets(data: DailyTrendPoint[], granularity: Granularity) {
  if (granularity === "daily") return data;

  const buckets: Record<string, { spend: number; impressions: number; clicks: number; purchases: number; purchase_value: number; adds_to_cart: number; video_views: number }> = {};

  for (const d of data) {
    const key = bucketKey(d.date, granularity);
    if (!buckets[key]) buckets[key] = { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0, adds_to_cart: 0, video_views: 0 };
    const b = buckets[key];
    b.spend += d.spend;
    b.impressions += d.impressions;
    b.clicks += d.clicks;
    b.purchases += d.purchases;
    b.purchase_value += d.purchase_value;
    b.adds_to_cart += d.adds_to_cart;
    b.video_views += d.video_views;
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      ...b,
      ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
      cpm: b.impressions > 0 ? (b.spend / b.impressions) * 1000 : 0,
      cpc: b.clicks > 0 ? b.spend / b.clicks : 0,
      cpa: b.purchases > 0 ? b.spend / b.purchases : 0,
      roas: b.spend > 0 ? b.purchase_value / b.spend : 0,
      cost_per_atc: b.adds_to_cart > 0 ? b.spend / b.adds_to_cart : 0,
    }));
}

function SummaryCard({ label, value, change, invertColor }: { label: string; value: string; change: number | null; invertColor: boolean }) {
  const isPositive = change !== null && change > 0;
  const isNeutral = change === null || Math.abs(change) < 0.5;
  const isGood = change !== null ? (invertColor ? change < 0 : change > 0) : false;

  return (
    <div className="py-3 px-4">
      <p className="font-label text-[10px] uppercase tracking-[0.05em] text-sage font-medium mb-1.5">{label}</p>
      <div className="flex items-end gap-2">
        <span className="font-data text-[28px] font-semibold text-charcoal tracking-tight leading-none">{value}</span>
        {change !== null && (
          <span className={`inline-flex items-center gap-0.5 font-data text-[17px] font-medium mb-0.5 ${isNeutral ? "text-muted-foreground" : isGood ? "text-verdant" : "text-red-700"}`}>
            {isNeutral ? <Minus className="h-3 w-3" /> : isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPositive ? "+" : ""}{change.toFixed(1)}%
          </span>
        )}
      </div>
      <p className="font-body text-[11px] text-sage mt-1">vs previous period</p>
    </div>
  );
}

export const TrendsTab = forwardRef<HTMLDivElement, TrendsTabProps>(function TrendsTab({ trendData, isLoading }, ref) {
  const granularity: Granularity = "daily";
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(["spend", "cpa"]));

  const chartData = useMemo(() => {
    if (!trendData) return [];
    return aggregateBuckets(trendData, granularity);
  }, [trendData, granularity]);

  const summary = useMemo(() => {
    if (!trendData || trendData.length < 1) return null;
    const mid = Math.floor(trendData.length / 2);
    const curr = trendData.slice(mid);
    const prev = trendData.slice(0, mid);

    const sumSpend = (arr: DailyTrendPoint[]) => arr.reduce((s, d) => s + d.spend, 0);
    const avgMetric = (arr: DailyTrendPoint[], key: "cpa" | "cpm") => {
      const vals = arr.filter(d => d[key] > 0);
      return vals.length > 0 ? vals.reduce((s, d) => s + d[key], 0) / vals.length : 0;
    };
    const pctChange = (curr: number, prev: number) => prev === 0 ? null : ((curr - prev) / prev) * 100;

    return {
      totalSpend: sumSpend(trendData),
      avgCpa: avgMetric(trendData, "cpa"),
      avgCpm: avgMetric(trendData, "cpm"),
      spendChange: pctChange(sumSpend(curr), sumSpend(prev)),
      cpaChange: pctChange(avgMetric(curr, "cpa"), avgMetric(prev, "cpa")),
      cpmChange: pctChange(avgMetric(curr, "cpm"), avgMetric(prev, "cpm")),
    };
  }, [trendData]);

  const toggleMetric = (key: string) => {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const trendLines: TrendLine[] = useMemo(() => {
    return METRIC_OPTIONS
      .filter((m) => selectedMetrics.has(m.key))
      .map((m) => ({
        key: m.key,
        label: m.label,
        color: m.color,
        prefix: m.prefix,
        suffix: m.suffix,
        decimals: m.decimals,
        values: chartData.map((d) => Number(d[m.key]) || 0),
      }));
  }, [chartData, selectedMetrics]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!trendData || trendData.length === 0) {
    return (
      <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
        <LineChart className="h-10 w-10 text-muted-foreground mb-3" />
        <h3 className="text-lg font-medium mb-1">No trend data yet</h3>
        <p className="text-sm text-muted-foreground max-w-md">Sync creatives to populate daily performance metrics for trend analysis.</p>
      </div>
    );
  }

  const granLabel = granularity === "daily" ? "days" : granularity === "weekly" ? "weeks" : "months";
  const dataRangeLabel = trendData && trendData.length > 0
    ? `${trendData.length} days · ${chartData.length} ${granLabel}`
    : `${chartData.length} ${granLabel}`;

  return (
    <div ref={ref}>
      <div className="flex items-center justify-end mb-1">
        <span className="font-label text-[11px] text-sage tracking-wide">{dataRangeLabel}</span>
      </div>

      {summary && (
        <div className="flex items-stretch divide-x divide-border-light mb-2">
          <SummaryCard label="Total Spend" value={`$${summary.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} change={summary.spendChange} invertColor={false} />
          <SummaryCard label="Avg CPA" value={`$${summary.avgCpa.toFixed(2)}`} change={summary.cpaChange} invertColor />
          <SummaryCard label="Avg CPM" value={`$${summary.avgCpm.toFixed(2)}`} change={summary.cpmChange} invertColor />
        </div>
      )}

      {/* Metric toggles */}
      <div className="flex flex-wrap gap-3 mb-3">
        {METRIC_OPTIONS.map((m) => (
          <label
            key={m.key}
            className="flex items-center gap-1.5 cursor-pointer select-none"
          >
            <Checkbox
              checked={selectedMetrics.has(m.key)}
              onCheckedChange={() => toggleMetric(m.key)}
              className="h-3.5 w-3.5"
              style={{ borderColor: m.color, ...(selectedMetrics.has(m.key) ? { backgroundColor: m.color } : {}) }}
            />
            <span className="font-body text-[12px] text-slate">{m.label}</span>
          </label>
        ))}
      </div>

      <MultiLineTrendChart
        dates={chartData.map((d) => d.date)}
        lines={trendLines}
        height={300}
      />
    </div>
  );
});
