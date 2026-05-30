import { useMemo, useRef, useState, useCallback } from "react";
import type { Database } from "@/integrations/supabase/types";

type Creative = Database["public"]["Tables"]["creatives"]["Row"];

/**
 * US-004 — Frame-by-frame retention / drop-off curve.
 *
 * Reads `creative.play_curve` (JSONB: an array of TRUE percentages in [0,100],
 * one per playback interval — already normalized upstream by the US-002 parser)
 * straight off the creatives row. No fetch hook: the modal already has the row.
 *
 * Renders a hand-rolled inline SVG (modeled on MultiLineTrendChart.tsx ChartSVG)
 * with a single drop-off line:
 *   x = playback progress 0 → 100% of the video
 *   y = retention % (share of viewers still watching at that point)
 *
 * p25/p50/p75/p100 completion marks are drawn as labeled vertical guides, with
 * the retention value at each mark sourced from the matching `retention_pNN`
 * scalar when present (consistent with the JSONB the parser emits).
 *
 * Null / empty / non-array play_curve → a clean empty-state, never a zero chart.
 */

interface RetentionCurveChartProps {
  creative: Pick<
    Creative,
    | "play_curve"
    | "retention_p25"
    | "retention_p50"
    | "retention_p75"
    | "retention_p100"
  >;
  height?: number;
}

/** Marks expressed as playback-progress fractions [0,1] + the matching scalar key. */
const THRESHOLD_MARKS = [
  { label: "25%", frac: 0.25, key: "retention_p25" as const },
  { label: "50%", frac: 0.5, key: "retention_p50" as const },
  { label: "75%", frac: 0.75, key: "retention_p75" as const },
  { label: "100%", frac: 1, key: "retention_p100" as const },
];

/** Coerce the JSONB play_curve into a clean number[] in [0,100], or null. */
function normalizeCurve(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export function RetentionCurveChart({ creative, height = 240 }: RetentionCurveChartProps) {
  const curve = useMemo(() => normalizeCurve(creative.play_curve), [creative.play_curve]);

  if (!curve || curve.length < 2) {
    return (
      <div data-testid="retention-curve-empty" className="glass-panel flex items-center justify-center py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No retention curve — backfill pending or non-video creative.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">
          Retention curve
        </p>
        <span className="font-body text-[11px] text-muted-foreground">
          % of viewers still watching vs. playback progress
        </span>
      </div>
      <CurveSVG
        curve={curve}
        height={height}
        thresholds={{
          retention_p25: creative.retention_p25,
          retention_p50: creative.retention_p50,
          retention_p75: creative.retention_p75,
          retention_p100: creative.retention_p100,
        }}
      />
    </div>
  );
}

function CurveSVG({
  curve,
  height,
  thresholds,
}: {
  curve: number[];
  height: number;
  thresholds: Pick<Creative, "retention_p25" | "retention_p50" | "retention_p75" | "retention_p100">;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const chart = useMemo(() => {
    const padding = 50;
    const rightPadding = 30;
    const width = 600;
    const top = 20;
    const chartH = height - 50;
    const lastIdx = curve.length - 1;
    const xStep = lastIdx > 0 ? (width - padding - rightPadding) / lastIdx : 0;

    // Retention is a true percentage: fix the y-domain to [0,100] so the
    // drop-off reads honestly (no auto-zoom that exaggerates a shallow curve).
    const yFor = (v: number) => top + chartH - (Math.max(0, Math.min(100, v)) / 100) * chartH;
    const xFor = (i: number) => padding + i * xStep;

    const points = curve.map((v, i) => ({ x: xFor(i), y: yFor(v), value: v, index: i }));
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    // Filled area under the curve down to the baseline.
    const areaPath =
      `M ${points[0].x} ${top + chartH} ` +
      points.map((p) => `L ${p.x} ${p.y}`).join(" ") +
      ` L ${points[lastIdx].x} ${top + chartH} Z`;

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const val = (100 * i) / 4;
      return { val, y: yFor(val) };
    });

    // p25/p50/p75/p100 playback-progress guides. Value comes from the matching
    // scalar when present; otherwise read off the curve at the mark position.
    const marks = THRESHOLD_MARKS.map((m) => {
      const pos = m.frac * lastIdx;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      const interp =
        lo === hi ? curve[lo] : curve[lo] + (curve[hi] - curve[lo]) * (pos - lo);
      const scalar = thresholds[m.key];
      const value = scalar ?? interp;
      return { ...m, x: padding + pos * xStep, y: yFor(value), value };
    });

    const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      label: `${Math.round(f * 100)}%`,
      x: padding + f * lastIdx * xStep,
    }));

    return { points, linePath, areaPath, yTicks, marks, xLabels, width, padding, rightPadding, xStep, top, chartH };
  }, [curve, height, thresholds]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * chart.width;
      const index = Math.round((svgX - chart.padding) / (chart.xStep || 1));
      if (index >= 0 && index < curve.length) {
        setHoveredIndex(index);
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setHoveredIndex(null);
      }
    },
    [chart.width, chart.padding, chart.xStep, curve.length],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    setTooltipPos(null);
  }, []);

  const lastIdx = curve.length - 1;
  const fmtPct = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  const fmtProgress = (i: number) =>
    `${((lastIdx > 0 ? i / lastIdx : 0) * 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chart.width} ${height}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Y gridlines + retention-% labels */}
        {chart.yTicks.map((tick, i) => (
          <g key={`y-${i}`}>
            <line x1={chart.padding} y1={tick.y} x2={chart.width - chart.rightPadding} y2={tick.y} stroke="hsl(var(--border))" strokeWidth={0.5} />
            <text x={chart.padding - 6} y={tick.y + 3} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize={11} fontFamily="'Crimson Pro', serif">
              {tick.val}%
            </text>
          </g>
        ))}

        {/* p25/p50/p75/p100 playback-progress guides */}
        {chart.marks.map((m) => (
          <g key={`mark-${m.label}`}>
            <line x1={m.x} y1={chart.top} x2={m.x} y2={chart.top + chart.chartH} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="2 3" opacity={0.4} />
            <circle cx={m.x} cy={m.y} r={3} fill="hsl(var(--primary))" opacity={0.9} />
            <text x={m.x} y={chart.top + chart.chartH + 26} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={9} fontFamily="'Space Grotesk', sans-serif">
              p{m.label.replace("%", "")}
            </text>
          </g>
        ))}

        {/* Filled area + drop-off line */}
        <path d={chart.areaPath} fill="hsl(var(--primary))" opacity={0.08} />
        <path d={chart.linePath} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />

        {/* Hover marker */}
        {hoveredIndex !== null && chart.points[hoveredIndex] && (
          <>
            <line x1={chart.points[hoveredIndex].x} y1={chart.top} x2={chart.points[hoveredIndex].x} y2={chart.top + chart.chartH} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.5} />
            <circle cx={chart.points[hoveredIndex].x} cy={chart.points[hoveredIndex].y} r={4} fill="hsl(var(--primary))" />
          </>
        )}

        {/* X-axis playback-progress labels */}
        {chart.xLabels.map((p, i) => (
          <text key={`x-${i}`} x={p.x} y={height - 4} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={10} fontFamily="'Space Grotesk', sans-serif">
            {p.label}
          </text>
        ))}
      </svg>

      {hoveredIndex !== null && tooltipPos && chart.points[hoveredIndex] && (
        <div
          className="absolute z-50 pointer-events-none bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-xs"
          style={{ left: tooltipPos.x, top: tooltipPos.y - 8, transform: "translate(-50%, -100%)" }}
        >
          <p className="font-medium text-foreground mb-1">{fmtProgress(hoveredIndex)} played</p>
          <div className="flex items-center gap-2 justify-between">
            <span className="text-muted-foreground">Retention</span>
            <span className="font-data text-[13px] font-semibold text-foreground ml-3">
              {fmtPct(chart.points[hoveredIndex].value)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
