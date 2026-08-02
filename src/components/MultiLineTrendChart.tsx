import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Expand } from "lucide-react";
import { ChartTooltip, type TooltipSeriesMeta } from "@/components/charts/ChartTooltip";
import {
  assignAxes,
  axisFormatFor,
  axisProps,
  CHART_ANIMATE_IN,
  CHART_CURVE,
  CHART_CURSOR,
  formatAxisTick,
  gridProps,
  paddedDomain,
  type AxisId,
} from "@/lib/chartTheme";

export interface TrendLine {
  key: string;
  label: string;
  color: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  values: number[];
}

interface MultiLineTrendChartProps {
  dates: string[];
  lines: TrendLine[];
  height?: number;
}

/** Dates arrive as bare `yyyy-MM-dd`; anchor at noon so the local TZ can't shift the day. */
function parseDay(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

export function MultiLineTrendChart({ dates, lines, height = 260 }: MultiLineTrendChartProps) {
  const [expanded, setExpanded] = useState(false);

  const axisMap = useMemo(() => assignAxes(lines), [lines]);
  const hasRightAxis = useMemo(
    () => lines.some((l) => axisMap.get(l.key) === "right"),
    [lines, axisMap],
  );

  if (dates.length === 0 || lines.length === 0) {
    return (
      <div className="glass-panel flex items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">Select at least one metric to display</p>
      </div>
    );
  }

  const legend = (compact: boolean) => (
    <div className={compact ? "flex flex-wrap gap-3" : "mb-4 flex flex-wrap gap-4"}>
      {lines.map((line) => (
        <div key={line.key} className="flex items-center gap-1.5">
          <span className="h-[3px] w-3 rounded-full" style={{ backgroundColor: line.color }} />
          <span className={compact ? "font-body text-[12px] text-slate" : "text-sm font-medium"}>
            {line.label}
          </span>
          {hasRightAxis && (
            <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground">
              {axisMap.get(line.key) === "right" ? "R" : "L"}
            </span>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div
        className="glass-panel group relative cursor-pointer p-4"
        onClick={() => setExpanded(true)}
      >
        <div className="mb-3 flex items-center justify-between">
          {legend(true)}
          <Expand className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <TrendChart dates={dates} lines={lines} height={height} axisMap={axisMap} />
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="w-[90vw] max-w-4xl p-6">
          {legend(false)}
          <TrendChart dates={dates} lines={lines} height={400} axisMap={axisMap} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function TrendChart({
  dates,
  lines,
  height,
  axisMap,
}: {
  dates: string[];
  lines: TrendLine[];
  height: number;
  axisMap: Map<string, AxisId>;
}) {
  const data = useMemo(
    () =>
      dates.map((date, i) => {
        const row: Record<string, string | number | null> = { date };
        for (const line of lines) {
          const v = line.values[i];
          row[line.key] = Number.isFinite(v) ? v : null;
        }
        return row;
      }),
    [dates, lines],
  );

  const leftLines = lines.filter((l) => axisMap.get(l.key) !== "right");
  const rightLines = lines.filter((l) => axisMap.get(l.key) === "right");
  const leftFormat = axisFormatFor(leftLines);
  const rightFormat = axisFormatFor(rightLines);

  const seriesMeta = useMemo(() => {
    const map: Record<string, TooltipSeriesMeta> = {};
    for (const line of lines) {
      map[line.key] = {
        label: line.label,
        color: line.color,
        prefix: line.prefix,
        suffix: line.suffix,
        decimals: line.decimals,
      };
    }
    return map;
  }, [lines]);

  // Point markers stay legible up to ~40 points; past that the line alone reads
  // better and the active dot still marks the hovered value.
  const showDots = dates.length <= 40;
  const isSingleSeries = lines.length === 1;

  /** An axis owned by exactly one series is tinted to match it, so the reader
   *  never has to guess which line the numbers belong to. */
  const tickFill = (axisLines: TrendLine[]) =>
    axisLines.length === 1 ? axisLines[0].color : axisProps.tick.fill;

  const chartLabel = `Trend chart: ${lines.map((l) => l.label).join(", ")} over ${dates.length} points`;

  return (
    <div role="img" aria-label={chartLabel} className={CHART_ANIMATE_IN}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {lines.map((line) => (
              <linearGradient key={line.key} id={`fill-${line.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={line.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={line.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid {...gridProps} />

          <XAxis
            dataKey="date"
            {...axisProps}
            tickMargin={8}
            minTickGap={28}
            interval="preserveStartEnd"
            tickFormatter={(value: string) => format(parseDay(value), "MMM d")}
          />

          <YAxis
            yAxisId="left"
            {...axisProps}
            tick={{ ...axisProps.tick, fill: tickFill(leftLines) }}
            width={56}
            domain={paddedDomain}
            tickFormatter={(v: number) => formatAxisTick(leftFormat, v)}
          />

          {rightLines.length > 0 && (
            <YAxis
              yAxisId="right"
              orientation="right"
              {...axisProps}
              tick={{ ...axisProps.tick, fill: tickFill(rightLines) }}
              width={56}
              domain={paddedDomain}
              tickFormatter={(v: number) => formatAxisTick(rightFormat, v)}
            />
          )}

          <Tooltip
            cursor={{ stroke: CHART_CURSOR, strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.5 }}
            content={
              <ChartTooltip
                series={seriesMeta}
                formatHeader={(label) => format(parseDay(String(label)), "MMM d, yyyy")}
              />
            }
          />

          {lines.map((line) => {
            const yAxisId = axisMap.get(line.key) === "right" ? "right" : "left";
            const shared = {
              yAxisId,
              dataKey: line.key,
              name: line.label,
              stroke: line.color,
              strokeWidth: 2,
              type: CHART_CURVE,
              connectNulls: false,
              isAnimationActive: false,
              dot: showDots ? { r: 2.5, fill: line.color, strokeWidth: 0 } : false,
              activeDot: {
                r: 4.5,
                fill: line.color,
                stroke: "hsl(var(--background))",
                strokeWidth: 2,
              },
            } as const;

            // A lone series gets a soft gradient fill for weight; stacking fills
            // under multiple series just muddies the overlap.
            return isSingleSeries ? (
              <Area key={line.key} {...shared} fill={`url(#fill-${line.key})`} />
            ) : (
              <Line key={line.key} {...shared} />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
