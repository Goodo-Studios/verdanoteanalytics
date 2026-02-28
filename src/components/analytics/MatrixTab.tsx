import { useMemo, useState, useCallback } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceLine, ZAxis, Cell,
} from "recharts";
import { gradeCreatives, type Grade, type GradeInfo } from "@/lib/creativeGrading";
import { GradeBadge } from "@/components/creatives/GradeBadge";
import { useNavigate } from "react-router-dom";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { computeFatigueMap, type FatigueResult } from "@/lib/fatigueScore";

/* ── Types ─────────────────────────────────────────── */

interface Props {
  creatives: any[];
  scaleThreshold: number;
  onCreativeClick?: (c: any) => void;
}

type ColorMode = "grade" | "format" | "hook" | "fatigue";

interface Dot {
  ad_id: string;
  ad_name: string;
  spend: number;
  roas: number;
  purchases: number;
  grade: Grade;
  format: string;
  hook: string;
  fatigueLevel: string;
  creative: any;
}

type Quadrant = "stars" | "gems" | "tests" | "drains";

const QUADRANT_META: Record<Quadrant, { label: string; emoji: string; action: string; color: string }> = {
  stars:  { label: "Stars",       emoji: "⭐", action: "Protect",  color: "hsl(142 71% 45%)" },
  gems:   { label: "Hidden Gems", emoji: "💎", action: "Scale",    color: "hsl(199 89% 48%)" },
  tests:  { label: "Tests",       emoji: "🧪", action: "Wait",     color: "hsl(45 93% 47%)" },
  drains: { label: "Drains",      emoji: "🚨", action: "Cut",      color: "hsl(0 84% 60%)" },
};

const GRADE_COLORS: Record<Grade, string> = {
  A: "#059669", B: "#10b981", C: "#f59e0b", D: "#f97316", F: "#dc2626",
};
const FORMAT_COLORS: Record<string, string> = {
  video: "#6366f1", image: "#ec4899", carousel: "#14b8a6", unknown: "#94a3b8",
};
const FATIGUE_COLORS: Record<string, string> = {
  high: "#dc2626", warning: "#f59e0b", ok: "#22c55e",
};

function getColor(dot: Dot, mode: ColorMode): string {
  if (mode === "grade") return GRADE_COLORS[dot.grade] || "#94a3b8";
  if (mode === "format") return FORMAT_COLORS[dot.format.toLowerCase()] || FORMAT_COLORS.unknown;
  if (mode === "fatigue") return FATIGUE_COLORS[dot.fatigueLevel] || FATIGUE_COLORS.ok;
  // hook — hash to color
  const hash = (dot.hook || "none").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;
  return `hsl(${hue} 65% 50%)`;
}

function getQuadrant(dot: Dot, avgSpend: number, scaleThreshold: number): Quadrant {
  const highSpend = dot.spend >= avgSpend;
  const highRoas = dot.roas >= scaleThreshold;
  if (highSpend && highRoas) return "stars";
  if (!highSpend && highRoas) return "gems";
  if (highSpend && !highRoas) return "drains";
  return "tests";
}

/* ── Custom Tooltip ────────────────────────────────── */

function DotTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload as Dot;
  return (
    <div className="bg-card border border-border-light rounded-lg shadow-card-hover p-3 text-sm space-y-1 max-w-[240px]">
      <p className="font-heading text-[13px] font-semibold text-foreground truncate">{d.ad_name}</p>
      <div className="flex items-center gap-2">
        <GradeBadge grade={d.grade} />
        <span className="font-data text-[12px] text-muted-foreground">
          {d.roas.toFixed(2)}x ROAS · ${d.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })} spend
        </span>
      </div>
      {d.purchases > 0 && <p className="font-data text-[11px] text-muted-foreground">{d.purchases} purchases</p>}
    </div>
  );
}

/* ── Component ─────────────────────────────────────── */

export function MatrixTab({ creatives, scaleThreshold, onCreativeClick }: Props) {
  const navigate = useNavigate();
  const [colorMode, setColorMode] = useState<ColorMode>("grade");
  const [minSpend, setMinSpend] = useState(10);

  const gradeMap = useMemo(() => gradeCreatives(creatives, scaleThreshold), [creatives, scaleThreshold]);
  const fatigueMap = useMemo(() => computeFatigueMap(creatives), [creatives]);

  const { dots, avgSpend } = useMemo(() => {
    const filtered = creatives.filter((c: any) => (Number(c.spend) || 0) >= minSpend);
    const totalSpend = filtered.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
    const avg = filtered.length > 0 ? totalSpend / filtered.length : 100;

    const mapped: Dot[] = filtered.map((c: any) => ({
      ad_id: c.ad_id,
      ad_name: c.ad_name || c.unique_code || "—",
      spend: Math.max(1, Number(c.spend) || 0),
      roas: Number(c.roas) || 0,
      purchases: Number(c.purchases) || 0,
      grade: gradeMap.get(c.ad_id)?.grade || "F",
      format: c.ad_type || "unknown",
      hook: c.hook || "none",
      fatigueLevel: fatigueMap.get(c.ad_id)?.level || "ok",
      creative: c,
    }));

    return { dots: mapped, avgSpend: avg };
  }, [creatives, minSpend, gradeMap, fatigueMap]);

  // Quadrant summary
  const quadrantSummary = useMemo(() => {
    const summary: Record<Quadrant, { count: number; totalSpend: number; totalRoas: number }> = {
      stars: { count: 0, totalSpend: 0, totalRoas: 0 },
      gems: { count: 0, totalSpend: 0, totalRoas: 0 },
      tests: { count: 0, totalSpend: 0, totalRoas: 0 },
      drains: { count: 0, totalSpend: 0, totalRoas: 0 },
    };
    for (const d of dots) {
      const q = getQuadrant(d, avgSpend, scaleThreshold);
      summary[q].count++;
      summary[q].totalSpend += d.spend;
      summary[q].totalRoas += d.roas;
    }
    return (Object.entries(summary) as [Quadrant, typeof summary.stars][]).map(([key, val]) => ({
      key,
      ...QUADRANT_META[key],
      count: val.count,
      totalSpend: val.totalSpend,
      avgRoas: val.count > 0 ? val.totalRoas / val.count : 0,
    }));
  }, [dots, avgSpend, scaleThreshold]);

  const handleDotClick = useCallback((d: Dot) => {
    onCreativeClick?.(d.creative);
  }, [onCreativeClick]);

  const handleQuadrantClick = useCallback((q: Quadrant) => {
    // Navigate to creatives page with a filter hint
    navigate(`/creatives?matrix_q=${q}`);
  }, [navigate]);

  const maxPurchases = useMemo(() => Math.max(1, ...dots.map((d) => d.purchases)), [dots]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-label text-[11px] uppercase tracking-wider text-muted-foreground">Color by</span>
          <Select value={colorMode} onValueChange={(v) => setColorMode(v as ColorMode)}>
            <SelectTrigger className="w-32 h-8 text-[12px] font-body">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grade">Grade</SelectItem>
              <SelectItem value="format">Format</SelectItem>
              <SelectItem value="hook">Hook Type</SelectItem>
              <SelectItem value="fatigue">Fatigue Level</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <span className="font-label text-[11px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">Min spend</span>
          <input
            type="range"
            value={minSpend}
            onChange={(e) => setMinSpend(Number(e.target.value))}
            min={0}
            max={500}
            step={10}
            className="flex-1 accent-primary h-1.5"
          />
          <span className="font-data text-[12px] text-muted-foreground w-12 text-right">${minSpend}</span>
        </div>
      </div>

      {/* Quadrant labels */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-body">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="w-2 h-2 rounded-full" style={{ background: QUADRANT_META.gems.color }} />
          💎 Hidden Gems — Scale these now
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="w-2 h-2 rounded-full" style={{ background: QUADRANT_META.stars.color }} />
          ⭐ Stars — Protect and iterate
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="w-2 h-2 rounded-full" style={{ background: QUADRANT_META.tests.color }} />
          🧪 Tests — Not enough data
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="w-2 h-2 rounded-full" style={{ background: QUADRANT_META.drains.color }} />
          🚨 Drains — Cut or fix
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-border-light bg-card p-4">
        {dots.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center text-muted-foreground font-body text-sm">
            No creatives with spend ≥ ${minSpend}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="spend"
                type="number"
                scale="log"
                domain={[Math.max(1, minSpend), "auto"]}
                name="Spend"
                tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                label={{ value: "Spend (log scale)", position: "insideBottom", offset: -10, style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                dataKey="roas"
                type="number"
                domain={[0, "auto"]}
                name="ROAS"
                tickFormatter={(v: number) => `${v}x`}
                label={{ value: "ROAS", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <ZAxis
                dataKey="purchases"
                range={[30, 200]}
                domain={[0, maxPurchases]}
              />
              <ReTooltip content={<DotTooltip />} />
              <ReferenceLine
                x={avgSpend}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="6 4"
                strokeWidth={1}
                opacity={0.6}
                label={{ value: `Avg $${avgSpend >= 1000 ? `${(avgSpend / 1000).toFixed(1)}k` : avgSpend.toFixed(0)}`, position: "top", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }}
              />
              <ReferenceLine
                y={scaleThreshold}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="6 4"
                strokeWidth={1}
                opacity={0.6}
                label={{ value: `${scaleThreshold}x ROAS`, position: "right", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }}
              />
              <Scatter data={dots} onClick={(data: any) => handleDotClick(data)} style={{ cursor: "pointer" }}>
                {dots.map((d, i) => (
                  <Cell key={d.ad_id} fill={getColor(d, colorMode)} fillOpacity={0.8} stroke={getColor(d, colorMode)} strokeWidth={1} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Quadrant Summary Table */}
      <div className="rounded-lg border border-border-light overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-label text-[11px] uppercase tracking-wider">Quadrant</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wider text-right">Count</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wider text-right">Total Spend</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wider text-right">Avg ROAS</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quadrantSummary.map((q) => (
              <TableRow key={q.key} className="cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => handleQuadrantClick(q.key)}>
                <TableCell className="font-body text-[13px] font-medium">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: q.color }} />
                    {q.emoji} {q.label}
                  </span>
                </TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums">{q.count}</TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums">
                  ${q.totalSpend >= 1000 ? `${(q.totalSpend / 1000).toFixed(1)}k` : q.totalSpend.toFixed(0)}
                </TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums">{q.avgRoas.toFixed(2)}x</TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className="font-body text-[10px]">{q.action}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
