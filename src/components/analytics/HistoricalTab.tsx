import { useState, useMemo } from "react";
import { format, subMonths, subYears, startOfMonth, endOfMonth, differenceInDays, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUp, ArrowDown, Minus, Calendar, TrendingUp, Trophy, BarChart3 } from "lucide-react";
import type { DailyTrendPoint } from "@/hooks/useDailyTrends";

interface Props {
  trendData: DailyTrendPoint[] | undefined;
  creatives: any[];
  roasThreshold: number;
  onCreativeClick?: (c: any) => void;
}

// ─── helpers ───

interface PeriodMetrics {
  spend: number; roas: number; ctr: number; cpa: number; cpm: number;
  impressions: number; clicks: number; purchases: number; purchaseValue: number;
  activeCreatives: number;
  frequency: number; cpmr: number;
}

function aggregatePeriod(data: DailyTrendPoint[], from: string, to: string, creatives: any[]): PeriodMetrics {
  const rows = data.filter((d) => d.date >= from && d.date <= to);
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const purchases = rows.reduce((s, r) => s + r.purchases, 0);
  const purchaseValue = rows.reduce((s, r) => s + r.purchase_value, 0);
  const activeCreatives = creatives.filter((c) => {
    const created = c.created_at?.slice(0, 10);
    return created && created >= from && created <= to;
  }).length;

  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  // Frequency = impressions / unique reach; approximate from daily rows count
  const dayCount = rows.length || 1;
  const avgDailyImpressions = impressions / dayCount;
  // Use a simple proxy: total impressions / (unique creative count * days)
  const frequency = dayCount > 0 ? impressions / (Math.max(activeCreatives, 1) * dayCount) * (dayCount / 30) : 0;
  const cpmr = cpm * (frequency || 1);

  return {
    spend, impressions, clicks, purchases, purchaseValue, activeCreatives,
    roas: spend > 0 ? purchaseValue / spend : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    cpm,
    frequency,
    cpmr,
  };
}

function pctChange(a: number, b: number): number | null {
  if (a === 0 && b === 0) return null;
  if (a === 0) return null;
  return ((b - a) / a) * 100;
}

function formatMetric(key: string, val: number): string {
  switch (key) {
    case "roas": return `${val.toFixed(2)}x`;
    case "ctr": return `${val.toFixed(1)}%`;
    case "cpa": case "cpm": case "cpmr": case "spend": return `$${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}`;
    case "frequency": return val.toFixed(1);
    case "activeCreatives": return String(Math.round(val));
    default: return val.toFixed(1);
  }
}

function ChangeCell({ oldVal, newVal, metric }: { oldVal: number; newVal: number; metric: string }) {
  const change = pctChange(oldVal, newVal);
  if (change === null) return <span className="text-xs text-muted-foreground">—</span>;

  // For CPA, lower is better
  const isImprovement = metric === "cpa" || metric === "cpm" || metric === "cpmr" || metric === "frequency" ? change < 0 : change > 0;
  const abs = Math.abs(change);
  const Icon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : Minus;

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${isImprovement ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
      <Icon className="h-3.5 w-3.5" />
      {metric === "activeCreatives" ? `${change > 0 ? "+" : ""}${Math.round(newVal - oldVal)}` : `${change > 0 ? "+" : ""}${abs.toFixed(0)}%`}
    </span>
  );
}

// Mini sparkline SVG
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const COMPARISON_METRICS = [
  { key: "roas", label: "ROAS" },
  { key: "ctr", label: "CTR" },
  { key: "cpa", label: "CPA" },
  { key: "cpm", label: "CPM" },
  { key: "frequency", label: "Frequency" },
  { key: "cpmr", label: "CPMr" },
  { key: "spend", label: "Spend" },
  { key: "activeCreatives", label: "Active Creatives" },
];

// ─── Component ───

type ViewMode = "period" | "yoy" | "rolling";

export function HistoricalTab({ trendData, creatives, roasThreshold, onCreativeClick }: Props) {
  const [view, setView] = useState<ViewMode>("period");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // Period-over-period date pickers
  const now = new Date();
  const thisMonthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const thisMonthEnd = format(endOfMonth(now), "yyyy-MM-dd");
  const lastMonthStart = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd");
  const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd");

  const [periodAFrom, setPeriodAFrom] = useState(lastMonthStart);
  const [periodATo, setPeriodATo] = useState(lastMonthEnd);
  const [periodBFrom, setPeriodBFrom] = useState(thisMonthStart);
  const [periodBTo, setPeriodBTo] = useState(thisMonthEnd);

  const data = trendData || [];

  // ── Period over Period ──
  const periodComparison = useMemo(() => {
    if (!data.length) return null;
    const a = aggregatePeriod(data, periodAFrom, periodATo, creatives);
    const b = aggregatePeriod(data, periodBFrom, periodBTo, creatives);
    // Sparkline data for each metric
    const sparklines: Record<string, number[]> = {};
    const allInRange = data.filter((d) => d.date >= periodAFrom && d.date <= periodBTo);
    for (const m of COMPARISON_METRICS) {
      sparklines[m.key] = allInRange.map((d) => {
        if (m.key === "roas") return d.roas;
        if (m.key === "ctr") return d.ctr;
        if (m.key === "cpa") return d.cpa;
        if (m.key === "spend") return d.spend;
        return 0;
      });
    }
    return { a, b, sparklines };
  }, [data, periodAFrom, periodATo, periodBFrom, periodBTo, creatives]);

  // ── Same Period Last Year ──
  const yoyComparison = useMemo(() => {
    if (!data.length) return null;
    const thisStart = format(startOfMonth(now), "yyyy-MM-dd");
    const thisEnd = format(endOfMonth(now), "yyyy-MM-dd");
    const lastYearStart = format(startOfMonth(subYears(now, 1)), "yyyy-MM-dd");
    const lastYearEnd = format(endOfMonth(subYears(now, 1)), "yyyy-MM-dd");
    const hasLastYear = data.some((d) => d.date >= lastYearStart && d.date <= lastYearEnd);
    if (!hasLastYear) return null;
    const a = aggregatePeriod(data, lastYearStart, lastYearEnd, creatives);
    const b = aggregatePeriod(data, thisStart, thisEnd, creatives);
    return { a, b, labelA: format(subYears(now, 1), "MMMM yyyy"), labelB: format(now, "MMMM yyyy") };
  }, [data, creatives]);

  // ── Rolling 12 months ──
  const rolling12 = useMemo(() => {
    if (!data.length) return { months: [], insight: null };
    const months: { label: string; start: string; end: string; roas: number; spend: number; winRate: number; creativeCount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const m = subMonths(now, i);
      const start = format(startOfMonth(m), "yyyy-MM-dd");
      const end = format(endOfMonth(m), "yyyy-MM-dd");
      const rows = data.filter((d) => d.date >= start && d.date <= end);
      const spend = rows.reduce((s, r) => s + r.spend, 0);
      const pv = rows.reduce((s, r) => s + r.purchase_value, 0);
      const roas = spend > 0 ? pv / spend : 0;
      // Win rate = % of creatives with ROAS > 2 in that month range
      const monthCreatives = creatives.filter((c) => {
        const cd = c.created_at?.slice(0, 10);
        return cd && cd >= start && cd <= end;
      });
      const winners = monthCreatives.filter((c) => (c.roas || 0) >= roasThreshold);
      const winRate = monthCreatives.length > 0 ? (winners.length / monthCreatives.length) * 100 : 0;
      months.push({ label: format(m, "MMM yyyy"), start, end, roas, spend, winRate, creativeCount: monthCreatives.length });
    }

    // Best month insight
    const best = [...months].sort((a, b) => b.roas - a.roas)[0];
    const currentMonth = months[months.length - 1];
    const bestUgcCount = creatives.filter((c) => {
      const cd = c.created_at?.slice(0, 10);
      return cd && cd >= best.start && cd <= best.end && /ugc/i.test(c.ad_type || "");
    }).length;
    const currentUgcCount = creatives.filter((c) => {
      const cd = c.created_at?.slice(0, 10);
      return cd && cd >= currentMonth.start && cd <= currentMonth.end && /ugc/i.test(c.ad_type || "");
    }).length;

    const insight = best.roas > 0
      ? `Your best month in the last 12 was ${best.label} (${best.roas.toFixed(1)}x ROAS, ${best.winRate.toFixed(0)}% win rate). You had ${bestUgcCount} UGC creatives active that month vs ${currentUgcCount} today.`
      : null;

    return { months, insight };
  }, [data, creatives]);

  // Month click for rolling view
  const monthCreatives = useMemo(() => {
    if (!selectedMonth) return [];
    const m = rolling12.months.find((m) => m.label === selectedMonth);
    if (!m) return [];
    return creatives
      .filter((c) => {
        const cd = c.created_at?.slice(0, 10);
        return cd && cd >= m.start && cd <= m.end;
      })
      .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
      .slice(0, 10);
  }, [selectedMonth, rolling12.months, creatives]);

  // ── Chart helpers for rolling 12 ──
  const maxSpend = Math.max(...rolling12.months.map((m) => m.spend), 1);
  const maxRoas = Math.max(...rolling12.months.map((m) => m.roas), 1);

  // 3-month moving average
  const movingAvgRoas = rolling12.months.map((_, i, arr) => {
    if (i < 2) return null;
    return (arr[i].roas + arr[i - 1].roas + arr[i - 2].roas) / 3;
  });

  const chartW = 720;
  const chartH = 200;
  const barW = chartW / rolling12.months.length;

  function roasY(val: number) { return chartH - (val / (maxRoas * 1.2)) * chartH; }

  const roasLine = rolling12.months.map((m, i) => `${i * barW + barW / 2},${roasY(m.roas)}`).join(" ");
  const maLine = movingAvgRoas
    .map((v, i) => v !== null ? `${i * barW + barW / 2},${roasY(v)}` : null)
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-6">
      {/* View switcher */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant={view === "period" ? "default" : "outline"} onClick={() => setView("period")} className="gap-1.5 text-xs">
          <Calendar className="h-3.5 w-3.5" /> Period vs Period
        </Button>
        <Button size="sm" variant={view === "yoy" ? "default" : "outline"} onClick={() => setView("yoy")} className="gap-1.5 text-xs">
          <TrendingUp className="h-3.5 w-3.5" /> Year-over-Year
        </Button>
        <Button size="sm" variant={view === "rolling" ? "default" : "outline"} onClick={() => setView("rolling")} className="gap-1.5 text-xs">
          <BarChart3 className="h-3.5 w-3.5" /> Rolling 12 Months
        </Button>
      </div>

      {/* ═══ VIEW 1: Period over Period ═══ */}
      {view === "period" && (
        <div className="space-y-4">
          <div className="glass-panel p-5 space-y-4">
            <h3 className="card-title">Period Comparison</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Period A</Label>
                <div className="flex items-center gap-2">
                  <Input type="date" value={periodAFrom} onChange={(e) => setPeriodAFrom(e.target.value)} className="h-8 text-xs" />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input type="date" value={periodATo} onChange={(e) => setPeriodATo(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Period B</Label>
                <div className="flex items-center gap-2">
                  <Input type="date" value={periodBFrom} onChange={(e) => setPeriodBFrom(e.target.value)} className="h-8 text-xs" />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input type="date" value={periodBTo} onChange={(e) => setPeriodBTo(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
            </div>
          </div>

          {periodComparison && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Period A</TableHead>
                  <TableHead className="text-right">Period B</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="w-24">Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMPARISON_METRICS.map((m) => {
                  const aVal = (periodComparison.a as any)[m.key] as number;
                  const bVal = (periodComparison.b as any)[m.key] as number;
                  return (
                    <TableRow key={m.key}>
                      <TableCell className="font-medium text-sm">{m.label}</TableCell>
                      <TableCell className="text-right text-sm">{formatMetric(m.key, aVal)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold">{formatMetric(m.key, bVal)}</TableCell>
                      <TableCell className="text-right">
                        <ChangeCell oldVal={aVal} newVal={bVal} metric={m.key} />
                      </TableCell>
                      <TableCell>
                        <Sparkline
                          data={periodComparison.sparklines[m.key] || []}
                          color="hsl(var(--primary))"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ═══ VIEW 2: Year-over-Year ═══ */}
      {view === "yoy" && (
        <div className="space-y-4">
          {yoyComparison ? (
            <>
              <div className="glass-panel p-5">
                <h3 className="card-title">{yoyComparison.labelB} vs {yoyComparison.labelA}</h3>
                <p className="text-xs text-muted-foreground mt-1">Same month comparison, year-over-year</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead className="text-right">{yoyComparison.labelA}</TableHead>
                    <TableHead className="text-right">{yoyComparison.labelB}</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPARISON_METRICS.map((m) => {
                    const aVal = (yoyComparison.a as any)[m.key] as number;
                    const bVal = (yoyComparison.b as any)[m.key] as number;
                    return (
                      <TableRow key={m.key}>
                        <TableCell className="font-medium text-sm">{m.label}</TableCell>
                        <TableCell className="text-right text-sm">{formatMetric(m.key, aVal)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatMetric(m.key, bVal)}</TableCell>
                        <TableCell className="text-right">
                          <ChangeCell oldVal={aVal} newVal={bVal} metric={m.key} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          ) : (
            <div className="glass-panel p-8 text-center">
              <p className="text-sm text-muted-foreground">No data available for the same period last year.</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ VIEW 3: Rolling 12 Months ═══ */}
      {view === "rolling" && (
        <div className="space-y-4">
          {/* Key Insight */}
          {rolling12.insight && (
            <div className="glass-panel p-4 flex items-start gap-3 border-l-4 border-primary">
              <Trophy className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">{rolling12.insight}</p>
            </div>
          )}

          {/* Chart */}
          <div className="glass-panel p-5">
            <h3 className="card-title mb-4">Rolling 12-Month Performance</h3>
            <div className="overflow-x-auto">
              <svg width={chartW} height={chartH + 40} className="w-full" viewBox={`0 0 ${chartW} ${chartH + 40}`} preserveAspectRatio="xMidYMid meet">
                {/* Bars = spend */}
                {rolling12.months.map((m, i) => {
                  const barH = (m.spend / maxSpend) * chartH * 0.8;
                  const isSelected = selectedMonth === m.label;
                  return (
                    <g key={m.label} onClick={() => setSelectedMonth(isSelected ? null : m.label)} className="cursor-pointer">
                      <rect
                        x={i * barW + barW * 0.15}
                        y={chartH - barH}
                        width={barW * 0.7}
                        height={barH}
                        rx={3}
                        className={isSelected ? "fill-primary/40" : "fill-muted"}
                      />
                      <text
                        x={i * barW + barW / 2}
                        y={chartH + 16}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[9px]"
                      >
                        {m.label.slice(0, 3)}
                      </text>
                      <text
                        x={i * barW + barW / 2}
                        y={chartH + 30}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[8px]"
                      >
                        {m.label.slice(4)}
                      </text>
                    </g>
                  );
                })}
                {/* ROAS line */}
                <polyline points={roasLine} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {/* ROAS dots */}
                {rolling12.months.map((m, i) => (
                  <circle key={i} cx={i * barW + barW / 2} cy={roasY(m.roas)} r={3} className="fill-primary" />
                ))}
                {/* 3-month MA line */}
                {maLine && (
                  <polyline points={maLine} fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
                )}
              </svg>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary inline-block rounded" /> ROAS</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-destructive/60 inline-block rounded border-dashed" style={{ borderTop: "1.5px dashed" }} /> 3-mo Moving Avg</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-muted inline-block rounded" /> Spend</span>
            </div>
          </div>

          {/* Monthly detail table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right">Creatives</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rolling12.months].reverse().map((m) => (
                <TableRow
                  key={m.label}
                  className={`cursor-pointer ${selectedMonth === m.label ? "bg-primary/5" : ""}`}
                  onClick={() => setSelectedMonth(selectedMonth === m.label ? null : m.label)}
                >
                  <TableCell className="text-sm font-medium">{m.label}</TableCell>
                  <TableCell className="text-right text-sm">{formatMetric("spend", m.spend)}</TableCell>
                  <TableCell className="text-right text-sm">{m.roas.toFixed(2)}x</TableCell>
                  <TableCell className="text-right text-sm">{m.winRate.toFixed(0)}%</TableCell>
                  <TableCell className="text-right text-sm">{m.creativeCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Selected month top creatives */}
          {selectedMonth && monthCreatives.length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <h4 className="card-title text-sm">Top Creatives — {selectedMonth}</h4>
              <div className="space-y-2">
                {monthCreatives.map((c: any) => (
                  <div
                    key={c.ad_id}
                    className="flex items-center gap-3 py-2 px-3 rounded-md border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => onCreativeClick?.(c)}
                  >
                    {c.thumbnail_url && (
                      <div className="h-8 w-8 rounded bg-muted shrink-0 overflow-hidden">
                        <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.ad_name}</p>
                      <p className="text-[10px] text-muted-foreground">{c.unique_code}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                      <span>{(c.roas || 0).toFixed(2)}x</span>
                      <span>${(c.spend || 0).toFixed(0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
