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

interface VideoTabProps {
  creatives: any[];
  killThreshold?: number;
  onCreativeClick?: (c: any) => void;
}

// Grade to color for scatter bubbles
const GRADE_COLORS: Record<Grade, string> = {
  A: "hsl(152, 60%, 36%)",
  B: "hsl(152, 50%, 50%)",
  C: "hsl(45, 90%, 55%)",
  D: "hsl(25, 90%, 55%)",
  F: "hsl(0, 70%, 50%)",
};

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

export function VideoTab({ creatives, killThreshold = 1.0, onCreativeClick }: VideoTabProps) {
  const [sort, setSort] = useState<SortConfig>({ key: "hook_rate", direction: "desc" });
  const [hoveredBubble, setHoveredBubble] = useState<string | null>(null);
  const [minSpendOverride, setMinSpendOverride] = useState<string>("");
  const effectiveMinSpend = minSpendOverride !== "" ? Math.max(0, Number(minSpendOverride) || 0) : 100;

  const grades = useMemo(() => gradeCreatives(creatives, killThreshold), [creatives, killThreshold]);

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

  // Scatter plot dimensions
  const SCATTER_W = 900;
  const SCATTER_H = 600;
  const PAD = { top: 30, right: 30, bottom: 60, left: 70 };
  const plotW = SCATTER_W - PAD.left - PAD.right;
  const plotH = SCATTER_H - PAD.top - PAD.bottom;

  const maxSpend = Math.max(...videoCreatives.map(c => c.spend_val), 1);
  const bubbleScale = (spend: number) => Math.max(4, Math.sqrt(spend / maxSpend) * 28);

  // Use account averages as quadrant dividers
  const HOOK_BENCHMARK = agg.avgHook;
  const HOLD_BENCHMARK = agg.avgHold;

  // Quadrant labels — X = Hold Rate, Y = Hook Rate
  const holdX = PAD.left + HOLD_BENCHMARK * plotW;
  const hookY = PAD.top + plotH - HOOK_BENCHMARK * plotH;
  const quadrants = [
    { label: "Hooks & Holds", x: holdX + (PAD.left + plotW - holdX) / 2, y: hookY - (hookY - PAD.top) / 2, className: "text-primary" },
    { label: "Hooks, doesn't hold", x: PAD.left + (holdX - PAD.left) / 2, y: hookY - (hookY - PAD.top) / 2, className: "text-warning" },
    { label: "Holds, doesn't hook", x: holdX + (PAD.left + plotW - holdX) / 2, y: hookY + (PAD.top + plotH - hookY) / 2, className: "text-warning" },
    { label: "Losing them", x: PAD.left + (holdX - PAD.left) / 2, y: hookY + (PAD.top + plotH - hookY) / 2, className: "text-destructive" },
  ];

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
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${SCATTER_W} ${SCATTER_H}`} className="w-full max-w-[600px]" style={{ minWidth: 400 }}>
              {/* Axes */}
              <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} stroke="hsl(var(--border))" strokeWidth="1" />
              <line x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH} stroke="hsl(var(--border))" strokeWidth="1" />

              {/* Grid lines at benchmarks */}
              <line x1={holdX} y1={PAD.top} x2={holdX} y2={PAD.top + plotH} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
              <line x1={PAD.left} y1={hookY} x2={PAD.left + plotW} y2={hookY} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />

              {/* Quadrant labels */}
              {quadrants.map(q => (
                 <text key={q.label} x={q.x} y={q.y} textAnchor="middle" className={cn("text-[13px] font-label font-semibold fill-current", q.className)} opacity="0.6">
                   {q.label}
                 </text>
              ))}

              {/* Axis labels */}
              <text x={PAD.left + plotW / 2} y={SCATTER_H - 6} textAnchor="middle" className="text-[13px] font-label fill-muted-foreground font-medium">
                Hold Rate →
              </text>
              <text x={14} y={PAD.top + plotH / 2} textAnchor="middle" className="text-[13px] font-label fill-muted-foreground font-medium" transform={`rotate(-90, 14, ${PAD.top + plotH / 2})`}>
                Hook Rate →
              </text>

              {/* Tick marks */}
              {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1].map(v => (
                <g key={`xtick-${v}`}>
                  <text x={PAD.left + v * plotW} y={PAD.top + plotH + 20} textAnchor="middle" className="text-[15px] font-data fill-muted-foreground tabular-nums">
                    {(v * 100).toFixed(0)}%
                  </text>
                </g>
              ))}
              {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1].map(v => (
                <g key={`ytick-${v}`}>
                  <text x={PAD.left - 8} y={PAD.top + plotH - v * plotH + 5} textAnchor="end" className="text-[15px] font-data fill-muted-foreground tabular-nums">
                    {(v * 100).toFixed(0)}%
                  </text>
                </g>
              ))}

              {/* Bubbles */}
              {videoCreatives.map(c => {
                const cx = PAD.left + Math.min(c.hold_rate_val, 1) * plotW;
                const cy = PAD.top + plotH - Math.min(c.hook_rate, 1) * plotH;
                const r = bubbleScale(c.spend_val);
                const isHovered = hoveredBubble === c.ad_id;
                return (
                  <g key={c.ad_id}
                    onMouseEnter={() => setHoveredBubble(c.ad_id)}
                    onMouseLeave={() => setHoveredBubble(null)}
                    onClick={() => onCreativeClick?.(c)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={cx} cy={cy} r={isHovered ? r + 2 : r}
                      fill={GRADE_COLORS[c.grade as Grade]}
                      opacity={isHovered ? 0.9 : 0.55}
                      stroke={isHovered ? "hsl(var(--foreground))" : "none"}
                      strokeWidth={isHovered ? 1.5 : 0}
                    />
                    {isHovered && (
                      <foreignObject x={cx + r + 4} y={cy - 36} width="180" height="72" className="pointer-events-none overflow-visible">
                        <div className="bg-popover border border-border rounded-md shadow-lg p-2 text-[11px] font-body space-y-0.5">
                          <p className="font-semibold text-foreground truncate">{c.ad_name}</p>
                          <p className="text-muted-foreground">ROAS: <span className="font-data font-semibold text-foreground">{c.roas_val.toFixed(2)}x</span></p>
                          <p className="text-muted-foreground">Spend: <span className="font-data font-semibold text-foreground">${c.spend_val.toFixed(0)}</span></p>
                        </div>
                      </foreignObject>
                    )}
                  </g>
                );
              })}
            </svg>
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
