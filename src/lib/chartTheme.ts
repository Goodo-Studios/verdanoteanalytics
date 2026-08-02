/**
 * Shared chart theme.
 *
 * Single source of truth for series colors, axis/grid chrome, typography and
 * value formatting across every chart in the app. Colors resolve through the
 * `--chart-*` CSS variables declared in src/index.css, so charts follow the
 * light/dark theme automatically. Never hardcode a series color at a call
 * site — pick one of the exports below.
 */

/** Categorical series palette, ordered for maximum adjacent-pair separation. */
export const CHART_SERIES = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
] as const;

/** Semantic series colors, for scales that carry a good → bad meaning. */
export const CHART_SEMANTIC = {
  positive: "hsl(var(--chart-positive))",
  caution: "hsl(var(--chart-caution))",
  negative: "hsl(var(--chart-negative))",
} as const;

/** A→F grade ramp, for marks colored by creative grade. */
export const CHART_GRADE_COLORS: Record<"A" | "B" | "C" | "D" | "F", string> = {
  A: "hsl(var(--grade-a))",
  B: "hsl(var(--grade-b))",
  C: "hsl(var(--grade-c))",
  D: "hsl(var(--grade-d))",
  F: "hsl(var(--grade-f))",
};

/** Chart chrome. */
export const CHART_GRID = "hsl(var(--chart-grid))";
export const CHART_AXIS = "hsl(var(--chart-axis))";
export const CHART_CURSOR = "hsl(var(--muted-foreground))";

/** Typography — mirrors `font-data` / `font-label` from tailwind.config.ts. */
export const AXIS_TICK_FONT = {
  fontFamily: "'Crimson Pro', serif",
  fontSize: 11,
} as const;

export const AXIS_LABEL_FONT = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 10,
} as const;

/**
 * Charts animate via the `.chart-animate-in` container fade in src/index.css,
 * NOT via Recharts' built-in per-series reveal. That reveal animates a clip
 * rect (areas) or stroke-dasharray (lines) up from zero and restarts whenever
 * the series re-renders — so a chart that re-renders mid-flight can be left
 * stuck at frame zero, showing no data. Always pass `isAnimationActive={false}`
 * to Line/Area/Scatter and put this class on the wrapper instead.
 */
export const CHART_ANIMATE_IN = "chart-animate-in";

/** Curve interpolation. `monotone` smooths without overshooting real values. */
export const CHART_CURVE = "monotone" as const;

/** Shared Cartesian grid props — horizontal rules only, verticals are noise. */
export const gridProps = {
  stroke: CHART_GRID,
  strokeDasharray: "0",
  vertical: false,
} as const;

/** Shared axis props. */
export const axisProps = {
  stroke: "transparent",
  tickLine: false,
  axisLine: false,
  tick: { ...AXIS_TICK_FONT, fill: CHART_AXIS },
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Value formatting                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SeriesFormat {
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

/** Full-precision value, for tooltips and legends. */
export function formatSeriesValue(fmt: SeriesFormat, v: number): string {
  if (!Number.isFinite(v)) return "—";
  const decimals = fmt.decimals ?? 2;
  const body = v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${fmt.prefix ?? ""}${body}${fmt.suffix ?? ""}`;
}

/**
 * Abbreviated value, for axis ticks. Long numbers ($178,831.00) crowd the
 * gutter and force the plot area to shrink; $179k reads instantly.
 */
export function formatAxisTick(fmt: SeriesFormat, v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  let body: string;

  if (abs >= 1_000_000) {
    body = `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  } else if (abs >= 10_000) {
    body = `${Math.round(abs / 1_000)}k`;
  } else if (abs >= 1_000) {
    body = `${(abs / 1_000).toFixed(1)}k`;
  } else {
    // Below 1k, respect the series' own precision but never show more than 2dp
    // on an axis — the tooltip is where exact values belong.
    const decimals = Math.min(fmt.decimals ?? 2, 2);
    body = abs.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return `${sign}${fmt.prefix ?? ""}${body}${fmt.suffix ?? ""}`;
}

/**
 * Y-domain that keeps the shape of the data readable without the hard zoom the
 * old hand-rolled charts used. Pads 12% either side; clamps to zero for
 * all-non-negative series so a spend line never appears to dip below nothing.
 */
export function paddedDomain([dataMin, dataMax]: [number, number]): [number, number] {
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return [0, 1];
  if (dataMin === dataMax) {
    const pad = Math.abs(dataMin) * 0.1 || 1;
    return [Math.min(dataMin - pad, dataMin >= 0 ? dataMin : dataMin - pad), dataMax + pad];
  }
  const pad = (dataMax - dataMin) * 0.12;
  const lo = dataMin - pad;
  return [dataMin >= 0 && lo < 0 ? 0 : lo, dataMax + pad];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Axis assignment                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

export type AxisId = "left" | "right";

export interface AxisAssignable extends SeriesFormat {
  key: string;
  values: number[];
}

/**
 * Ratio between two series' peaks above which they can no longer share a
 * readable axis. At 8x the smaller series is pinned into the bottom eighth of
 * the plot and reads as a flat line.
 */
const MAGNITUDE_SPLIT_RATIO = 8;

function peakOf(values: number[]): number {
  let peak = 0;
  for (const v of values) {
    if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  }
  return peak;
}

function unitKeyOf(fmt: SeriesFormat): string {
  // NUL as the separator so a prefix/suffix pair can never collide with a
  // different pair that concatenates the same way. Written as an escape, not
  // a literal control byte — a literal NUL makes git treat the file as binary.
  return `${fmt.prefix ?? ""}\u0000${fmt.suffix ?? ""}`;
}

/**
 * Decide which Y axis each series belongs to.
 *
 * Series that share an axis share a domain, so their heights are directly
 * comparable. Series on different axes are not — which is exactly why the old
 * hand-rolled chart (every series normalized to its own invisible range, only
 * the first one labelled) was misleading.
 *
 * Rules, in order:
 *   1. One series → left.
 *   2. Two or more distinct units ($ vs % vs bare) → the unit group with the
 *      biggest peak takes the left axis, everything else goes right.
 *   3. One unit but a wide magnitude spread → split at the largest ratio jump.
 *   4. Otherwise → everything shares the left axis.
 */
export function assignAxes(lines: AxisAssignable[]): Map<string, AxisId> {
  const assignment = new Map<string, AxisId>();
  if (lines.length === 0) return assignment;

  const meta = lines.map((l) => ({
    key: l.key,
    peak: peakOf(l.values),
    unit: unitKeyOf(l),
  }));

  if (lines.length === 1) {
    assignment.set(meta[0].key, "left");
    return assignment;
  }

  const units = [...new Set(meta.map((m) => m.unit))];

  if (units.length > 1) {
    // Rank unit groups by their biggest series; the heaviest owns the left axis.
    const peakByUnit = new Map<string, number>();
    for (const m of meta) {
      peakByUnit.set(m.unit, Math.max(peakByUnit.get(m.unit) ?? 0, m.peak));
    }
    const primaryUnit = [...peakByUnit.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const m of meta) {
      assignment.set(m.key, m.unit === primaryUnit ? "left" : "right");
    }
    return assignment;
  }

  // Single unit — split on magnitude only if the spread makes sharing unreadable.
  const sorted = [...meta].sort((a, b) => b.peak - a.peak);
  const top = sorted[0].peak;
  const bottom = sorted[sorted.length - 1].peak;

  if (top > 0 && bottom > 0 && top / bottom > MAGNITUDE_SPLIT_RATIO) {
    // Cut at the widest consecutive ratio gap so naturally-grouped series stay together.
    let cutIndex = 1;
    let widestGap = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i].peak / (sorted[i + 1].peak || 1);
      if (gap > widestGap) {
        widestGap = gap;
        cutIndex = i + 1;
      }
    }
    sorted.forEach((m, i) => assignment.set(m.key, i < cutIndex ? "left" : "right"));
    return assignment;
  }

  for (const m of meta) assignment.set(m.key, "left");
  return assignment;
}

/**
 * Pick a representative format for an axis. Series sharing an axis share a
 * unit (or, in the magnitude-split case, are close enough that the largest
 * one's format is the right label). Falls back to a bare number.
 */
export function axisFormatFor(lines: AxisAssignable[]): SeriesFormat {
  if (lines.length === 0) return {};
  return [...lines].sort((a, b) => peakOf(b.values) - peakOf(a.values))[0];
}
