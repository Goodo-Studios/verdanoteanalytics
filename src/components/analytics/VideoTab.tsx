import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { gradeCreatives, GRADE_STYLES, type Grade } from "@/lib/creativeGrading";
import { GradeBadge } from "@/components/creatives/GradeBadge";
import { MetricCard } from "@/components/MetricCard";
import { SortableTableHead, type SortConfig } from "@/components/SortableTableHead";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Film, Eye, MousePointerClick, Clock, Play, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmt$ } from "@/lib/formatters";
import {
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type ScatterPointItem,
} from "recharts";
import {
  axisProps,
  CHART_ANIMATE_IN,
  CHART_CURSOR,
  CHART_GRADE_COLORS,
  CHART_SEMANTIC,
  gridProps,
} from "@/lib/chartTheme";
import { CartesianGrid } from "recharts";

interface VideoTabProps {
  creatives: any[];
  onCreativeClick?: (c: any) => void;
}

// Grade to color for scatter bubbles — token-backed so it follows dark mode.
const GRADE_COLORS: Record<Grade, string> = CHART_GRADE_COLORS;

/** The derived shape the `videoCreatives` memo produces, narrowed to the fields
 *  the scatter and its tooltip actually read. */
interface VideoCreative {
  ad_id: string;
  ad_name: string;
  hook_rate: number;
  hold_rate_val: number;
  spend_val: number;
  roas_val: number;
  grade: Grade;
  [key: string]: unknown;
}

/** One bubble: hold rate (x), hook rate (y), spend (z) + the source creative. */
interface ScatterPoint {
  x: number;
  y: number;
  z: number;
  creative: VideoCreative;
}

/** Narrow a Recharts point item back to the datum we fed it. */
const pointDatum = (point: ScatterPointItem): ScatterPoint | undefined =>
  point?.payload as ScatterPoint | undefined;

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

export function VideoTab({ creatives, onCreativeClick }: VideoTabProps) {
  const [sort, setSort] = useState<SortConfig>({ key: "hook_rate", direction: "desc" });
  const [hoveredBubble, setHoveredBubble] = useState<string | null>(null);
  const [minSpendOverride, setMinSpendOverride] = useState<string>("");
  const effectiveMinSpend = minSpendOverride !== "" ? Math.max(0, Number(minSpendOverride) || 0) : 100;

  const grades = useMemo(() => gradeCreatives(creatives), [creatives]);

  // Filter to video creatives and compute video metrics
  const videoCreatives = useMemo(() => {
    return creatives
      .filter(c => ((Number(c.video_views) || 0) > 0 || (Number(c.thumb_stop_rate) || 0) > 0) && (Number(c.spend) || 0) >= effectiveMinSpend)
      .map(c => {
        const views = Number(c.video_views) || 0;
        const impressions = Number(c.impressions) || 0;
        const clicks = Number(c.clicks) || 0;
        const spend = Number(c.spend) || 0;
        const holdRateRaw = Number(c.hold_rate) || 0;
        // hold_rate is stored as a percentage (e.g. 45.2 = 45.2%), convert to 0-1 ratio
        const holdRate = holdRateRaw / 100;
        const rawHookRate = Number(c.thumb_stop_rate) || 0;
        // thumb_stop_rate is stored as a percentage (e.g. 31.5 = 31.5%), convert to 0-1 ratio
        const hookRate = rawHookRate > 0 ? rawHookRate / 100 : (impressions > 0 ? views / impressions : 0);
        const ctr = Number(c.ctr) || 0;
        const viewToClick = ctr > 0 ? ctr / 100 : (impressions > 0 ? clicks / impressions : 0);
        // thruplay ≈ hold_rate * video_views (reverse-engineered)
        const thruplay = holdRate * views;
        const costPerThruplay = thruplay > 0 ? spend / thruplay : 0;
        const avgPlayTime = Number(c.video_avg_play_time) || 0;
        const roas = Number(c.roas) || 0;
        const grade = grades.get(c.ad_id)?.grade || "C";

        return {
          ...c,
          hook_rate: hookRate,
          hold_rate_val: holdRate,
          view_to_click: viewToClick,
          cost_per_thruplay: costPerThruplay,
          avg_play_time: avgPlayTime,
          spend_val: spend,
          roas_val: roas,
          grade,
        };
      });
  }, [creatives, grades, effectiveMinSpend]);

  // Aggregated metrics
  const agg = useMemo(() => {
    if (videoCreatives.length === 0) return null;
    const avgHook = videoCreatives.reduce((s, c) => s + c.hook_rate, 0) / videoCreatives.length;
    const avgHold = videoCreatives.reduce((s, c) => s + c.hold_rate_val, 0) / videoCreatives.length;
    const avgVTC = videoCreatives.reduce((s, c) => s + c.view_to_click, 0) / videoCreatives.length;
    const totalSpend = videoCreatives.reduce((s, c) => s + c.spend_val, 0);
    const totalThruplay = videoCreatives.reduce((s, c) => s + c.hold_rate_val * (Number(c.video_views) || 0), 0);
    const avgCPT = totalThruplay > 0 ? totalSpend / totalThruplay : 0;
    const avgPlayTime = videoCreatives.reduce((s, c) => s + c.avg_play_time, 0) / videoCreatives.length;
    const bestHook = videoCreatives.reduce((best, c) => c.hook_rate > best.hook_rate ? c : best, videoCreatives[0]);
    return { avgHook, avgHold, avgVTC, avgCPT, avgPlayTime, bestHook, count: videoCreatives.length };
  }, [videoCreatives]);

  // Sorted data for table
  const sorted = useMemo(() => {
    if (!sort.direction) return videoCreatives;
    return [...videoCreatives].sort((a, b) => {
      const av = Number(a[sort.key]) || 0;
      const bv = Number(b[sort.key]) || 0;
      return sort.direction === "asc" ? av - bv : bv - av;
    });
  }, [videoCreatives, sort]);

  // Top 10 by hook rate for bar chart
  const top10Hook = useMemo(
    () => [...videoCreatives].sort((a, b) => b.hook_rate - a.hook_rate).slice(0, 10),
    [videoCreatives]
  );

  const handleSort = (key: string) => {
    setSort(prev =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : prev.direction === "desc" ? null : "asc" }
        : { key, direction: "desc" }
    );
  };

  if (!agg || videoCreatives.length === 0) {
    return (
      <div className="glass-panel p-8 text-center">
        <Film className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="font-body text-[14px] text-muted-foreground">No video creatives found in the current dataset.</p>
      </div>
    );
  }

  const maxSpend = Math.max(...videoCreatives.map(c => c.spend_val), 1);

  // Use account averages as quadrant dividers
  const HOOK_BENCHMARK = agg.avgHook;
  const HOLD_BENCHMARK = agg.avgHold;

  // Quadrants in data space — X = Hold Rate, Y = Hook Rate, both in [0,1].
  const quadrants = [
    { label: "Hooks & Holds", x1: HOLD_BENCHMARK, x2: 1, y1: HOOK_BENCHMARK, y2: 1, tint: CHART_SEMANTIC.positive },
    { label: "Hooks, doesn't hold", x1: 0, x2: HOLD_BENCHMARK, y1: HOOK_BENCHMARK, y2: 1, tint: CHART_SEMANTIC.caution },
    { label: "Holds, doesn't hook", x1: HOLD_BENCHMARK, x2: 1, y1: 0, y2: HOOK_BENCHMARK, tint: CHART_SEMANTIC.caution },
    { label: "Losing them", x1: 0, x2: HOLD_BENCHMARK, y1: 0, y2: HOOK_BENCHMARK, tint: CHART_SEMANTIC.negative },
  ];

  const scatterData = videoCreatives.map(c => ({
    x: Math.min(c.hold_rate_val, 1),
    y: Math.min(c.hook_rate, 1),
    z: c.spend_val,
    creative: c,
  }));

  // Evenly-spaced ticks. The old hand-rolled axis mixed 0.1 steps with 0.25
  // steps but positioned them linearly, so the gaps lied about the values.
  const RATE_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

  const maxBarHook = top10Hook.length > 0 ? top10Hook[0].hook_rate : 1;

  return (
    <div className="space-y-6">
      {/* Min spend control + insight callouts */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <p className="font-body text-[13px] text-foreground">
              Your average hook rate is <span className="font-data font-semibold text-primary">{pct(agg.avgHook)}</span>.
              Industry benchmark is 25–35%.
            </p>
            <p className="font-body text-[13px] text-foreground">
              Best hook: <span className="font-data font-semibold">{agg.bestHook.ad_name}</span> at{" "}
              <span className="font-data font-semibold text-primary">{pct(agg.bestHook.hook_rate)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="font-label text-[11px] uppercase tracking-wide text-muted-foreground font-semibold whitespace-nowrap flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Min Spend
            </label>
            <Input
              type="number"
              placeholder="100"
              value={minSpendOverride}
              onChange={(e) => setMinSpendOverride(e.target.value)}
              className="w-[100px] h-8 font-body text-[13px]"
            />
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border-light rounded-card overflow-hidden shadow-card border border-border-light">
        <MetricCard label="Video Creatives" value={agg.count} icon={<Film className="h-4 w-4" />} />
        <MetricCard label="Avg Hook Rate" value={pct(agg.avgHook)} icon={<Eye className="h-4 w-4" />} />
        <MetricCard label="Avg Hold Rate" value={pct(agg.avgHold)} icon={<Play className="h-4 w-4" />} />
        <MetricCard label="View-to-Click" value={pct(agg.avgVTC)} icon={<MousePointerClick className="h-4 w-4" />} />
        <MetricCard label="Cost / ThruPlay" value={fmt$(agg.avgCPT)} icon={<Eye className="h-4 w-4" />} />
        <MetricCard label="Avg Watch Time" value={agg.avgPlayTime > 0 ? `${agg.avgPlayTime.toFixed(1)}s` : "—"} icon={<Clock className="h-4 w-4" />} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Scatter plot */}
        <div className="glass-panel p-4 space-y-2">
          <h3 className="font-label text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            Hook Rate vs Hold Rate
          </h3>
          <div
            className={CHART_ANIMATE_IN}
            role="img"
            aria-label={`Bubble chart of ${videoCreatives.length} video creatives plotting hook rate against hold rate, sized by spend`}
          >
            <ResponsiveContainer width="100%" height={380}>
              <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 4 }}>
                <CartesianGrid {...gridProps} vertical />

                {/* Quadrant tints — faint enough to orient without competing with the marks. */}
                {quadrants.map(q => (
                  <ReferenceArea
                    key={`area-${q.label}`}
                    x1={q.x1} x2={q.x2} y1={q.y1} y2={q.y2}
                    fill={q.tint}
                    fillOpacity={0.05}
                    stroke="none"
                    label={{
                      value: q.label,
                      position: "center",
                      fill: q.tint,
                      fontSize: 11,
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 600,
                      opacity: 0.85,
                    }}
                  />
                ))}

                {/* Account-average dividers */}
                <ReferenceLine x={HOLD_BENCHMARK} stroke={CHART_CURSOR} strokeDasharray="4 4" strokeWidth={1} opacity={0.5} />
                <ReferenceLine y={HOOK_BENCHMARK} stroke={CHART_CURSOR} strokeDasharray="4 4" strokeWidth={1} opacity={0.5} />

                <XAxis
                  type="number" dataKey="x" name="Hold rate"
                  domain={[0, 1]} ticks={RATE_TICKS}
                  {...axisProps}
                  tickMargin={8}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  label={{
                    value: "Hold Rate →", position: "insideBottom", offset: -16,
                    fill: axisProps.tick.fill, fontSize: 11, fontFamily: "'Space Grotesk', sans-serif",
                  }}
                />
                <YAxis
                  type="number" dataKey="y" name="Hook rate"
                  domain={[0, 1]} ticks={RATE_TICKS}
                  {...axisProps}
                  width={48}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  label={{
                    value: "Hook Rate →", angle: -90, position: "insideLeft",
                    style: { textAnchor: "middle" },
                    fill: axisProps.tick.fill, fontSize: 11, fontFamily: "'Space Grotesk', sans-serif",
                  }}
                />
                <ZAxis type="number" dataKey="z" range={[60, 2200]} domain={[0, maxSpend]} name="Spend" />

                <Tooltip
                  cursor={false}
                  content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ScatterPoint }> }) => {
                    const c = active ? payload?.[0]?.payload?.creative : undefined;
                    if (!c) return null;
                    return (
                      <div className="pointer-events-none space-y-0.5 rounded-md border border-border bg-popover p-2 font-body text-[11px] shadow-lg">
                        <p className="max-w-[220px] truncate font-semibold text-foreground">{c.ad_name}</p>
                        <p className="text-muted-foreground">Hook: <span className="font-data font-semibold text-foreground">{pct(c.hook_rate)}</span> · Hold: <span className="font-data font-semibold text-foreground">{pct(c.hold_rate_val)}</span></p>
                        <p className="text-muted-foreground">ROAS: <span className="font-data font-semibold text-foreground">{c.roas_val.toFixed(2)}x</span></p>
                        <p className="text-muted-foreground">Spend: <span className="font-data font-semibold text-foreground">${c.spend_val.toFixed(0)}</span></p>
                      </div>
                    );
                  }}
                />

                <Scatter
                  data={scatterData}
                  isAnimationActive={false}
                  // Recharts hands back its own point item, which carries the
                  // source datum on `payload` (typed `any`), not spread at the top.
                  onClick={(point: ScatterPointItem) => onCreativeClick?.(pointDatum(point)?.creative)}
                  onMouseEnter={(point: ScatterPointItem) => setHoveredBubble(pointDatum(point)?.creative?.ad_id ?? null)}
                  onMouseLeave={() => setHoveredBubble(null)}
                  className="cursor-pointer"
                >
                  {scatterData.map(point => {
                    const isHovered = hoveredBubble === point.creative.ad_id;
                    return (
                      <Cell
                        key={point.creative.ad_id}
                        fill={GRADE_COLORS[point.creative.grade as Grade]}
                        fillOpacity={isHovered ? 0.9 : 0.55}
                        stroke={isHovered ? "hsl(var(--foreground))" : "none"}
                        strokeWidth={isHovered ? 1.5 : 0}
                      />
                    );
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top 10 bar chart */}
        <div className="glass-panel p-4 space-y-3">
          <h3 className="font-label text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            Top 10 by Hook Rate
          </h3>
          <div className="space-y-1.5">
            {top10Hook.map((c, i) => {
              const widthPct = maxBarHook > 0 ? (c.hook_rate / maxBarHook) * 100 : 0;
              const style = GRADE_STYLES[c.grade as Grade];
              return (
                <div key={c.ad_id} className="flex items-center gap-2 group cursor-pointer" onClick={() => onCreativeClick?.(c)}>
                  <span className="font-data text-[11px] text-muted-foreground w-4 text-right tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-body text-[12px] text-foreground truncate group-hover:text-primary transition-colors">{c.ad_name}</span>
                      <GradeBadge grade={c.grade as Grade} />
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", style.bg)}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                  <span className="font-data text-[12px] font-semibold text-foreground tabular-nums w-12 text-right">
                    {pct(c.hook_rate)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Video creatives table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Creative</TableHead>
            <SortableTableHead label="Hook Rate" sortKey="hook_rate" currentSort={sort} onSort={handleSort} className="text-right" />
            <SortableTableHead label="Hold Rate" sortKey="hold_rate_val" currentSort={sort} onSort={handleSort} className="text-right" />
            <SortableTableHead label="View→Click" sortKey="view_to_click" currentSort={sort} onSort={handleSort} className="text-right" />
            <SortableTableHead label="Cost/ThruPlay" sortKey="cost_per_thruplay" currentSort={sort} onSort={handleSort} className="text-right" />
            <SortableTableHead label="Avg Watch" sortKey="avg_play_time" currentSort={sort} onSort={handleSort} className="text-right" />
            <SortableTableHead label="Spend" sortKey="spend_val" currentSort={sort} onSort={handleSort} className="text-right" />
            <SortableTableHead label="ROAS" sortKey="roas_val" currentSort={sort} onSort={handleSort} className="text-right" />
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-center">Grade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(c => (
            <TableRow key={c.ad_id} className="cursor-pointer" onClick={() => onCreativeClick?.(c)}>
              <TableCell className="font-body text-[13px] font-medium text-foreground max-w-[200px] truncate">{c.ad_name}</TableCell>
              <TableCell className="text-right font-data text-[17px] tabular-nums">{pct(c.hook_rate)}</TableCell>
              <TableCell className="text-right font-data text-[17px] tabular-nums">{pct(c.hold_rate_val)}</TableCell>
              <TableCell className="text-right font-data text-[17px] tabular-nums">{pct(c.view_to_click)}</TableCell>
              <TableCell className="text-right font-data text-[17px] tabular-nums">{fmt$(c.cost_per_thruplay)}</TableCell>
              <TableCell className="text-right font-data text-[17px] tabular-nums">{c.avg_play_time > 0 ? `${c.avg_play_time.toFixed(1)}s` : "—"}</TableCell>
              <TableCell className="text-right font-data text-[17px] tabular-nums">${c.spend_val.toLocaleString("en-US", { maximumFractionDigits: 0 })}</TableCell>
              <TableCell className="text-right font-data text-[17px] tabular-nums">{c.roas_val.toFixed(2)}x</TableCell>
              <TableCell className="text-center"><GradeBadge grade={c.grade as Grade} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
