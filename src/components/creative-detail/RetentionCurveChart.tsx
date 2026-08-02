import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Database } from "@/integrations/supabase/types";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import {
  axisProps,
  CHART_ANIMATE_IN,
  CHART_CURSOR,
  CHART_CURVE,
  CHART_SERIES,
  gridProps,
} from "@/lib/chartTheme";

type Creative = Database["public"]["Tables"]["creatives"]["Row"];

/**
 * US-004 — Frame-by-frame retention / drop-off curve.
 *
 * Reads `creative.play_curve` (JSONB: an array of TRUE percentages in [0,100],
 * one per playback interval — already normalized upstream by the US-002 parser)
 * straight off the creatives row. No fetch hook: the modal already has the row.
 *
 * Rendered with Recharts on the shared chart theme:
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

const RETENTION_COLOR = CHART_SERIES[0];

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
      <div className="mb-3 flex items-center justify-between">
        <p className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">
          Retention curve
        </p>
        <span className="font-body text-[11px] text-muted-foreground">
          % of viewers still watching vs. playback progress
        </span>
      </div>
      <CurveChart
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

function CurveChart({
  curve,
  height,
  thresholds,
}: {
  curve: number[];
  height: number;
  thresholds: Pick<Creative, "retention_p25" | "retention_p50" | "retention_p75" | "retention_p100">;
}) {
  const lastIdx = curve.length - 1;

  const data = useMemo(
    () =>
      curve.map((v, i) => ({
        progress: (i / lastIdx) * 100,
        retention: Math.max(0, Math.min(100, v)),
      })),
    [curve, lastIdx],
  );

  /** Value at each completion mark: the reported scalar when present, else the
   *  curve interpolated at that position. */
  const marks = useMemo(
    () =>
      THRESHOLD_MARKS.map((m) => {
        const pos = m.frac * lastIdx;
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        const interp = lo === hi ? curve[lo] : curve[lo] + (curve[hi] - curve[lo]) * (pos - lo);
        const scalar = thresholds[m.key];
        return { ...m, x: m.frac * 100, value: scalar ?? interp };
      }),
    [curve, lastIdx, thresholds],
  );

  return (
    <div className={CHART_ANIMATE_IN} role="img" aria-label="Retention curve: share of viewers still watching against playback progress">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
          <defs>
            <linearGradient id="fill-retention" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RETENTION_COLOR} stopOpacity={0.24} />
              <stop offset="100%" stopColor={RETENTION_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid {...gridProps} />

          <XAxis
            dataKey="progress"
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            {...axisProps}
            tickMargin={8}
            tickFormatter={(v: number) => `${v}%`}
          />

          <YAxis
            // Retention is a true percentage: fix the domain to [0,100] so the
            // drop-off reads honestly (no auto-zoom that exaggerates a shallow curve).
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            {...axisProps}
            width={44}
            tickFormatter={(v: number) => `${v}%`}
          />

          {marks.map((m) => (
            <ReferenceLine
              key={`guide-${m.label}`}
              x={m.x}
              stroke={CHART_CURSOR}
              strokeDasharray="2 3"
              strokeWidth={1}
              opacity={0.4}
              label={{
                value: `p${m.label.replace("%", "")}`,
                position: "insideTop",
                offset: -2,
                fill: axisProps.tick.fill,
                fontSize: 9,
                fontFamily: "'Space Grotesk', sans-serif",
              }}
            />
          ))}

          <Tooltip
            cursor={{ stroke: CHART_CURSOR, strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.5 }}
            content={
              <ChartTooltip
                series={{
                  retention: {
                    label: "Retention",
                    color: RETENTION_COLOR,
                    suffix: "%",
                    decimals: 1,
                  },
                }}
                formatHeader={(label) => `${Math.round(Number(label))}% played`}
              />
            }
          />

          <Area
            dataKey="retention"
            name="Retention"
            type={CHART_CURVE}
            stroke={RETENTION_COLOR}
            strokeWidth={2}
            fill="url(#fill-retention)"
            dot={false}
            activeDot={{ r: 4.5, fill: RETENTION_COLOR, stroke: "hsl(var(--background))", strokeWidth: 2 }}
            isAnimationActive={false}
          />

          {marks.map((m) => (
            <ReferenceDot
              key={`dot-${m.label}`}
              x={m.x}
              y={m.value}
              r={3}
              fill={RETENTION_COLOR}
              stroke="none"
opacity={0.9}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
