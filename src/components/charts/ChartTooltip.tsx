/**
 * Shared Recharts tooltip.
 *
 * Recharts clones whatever element is passed to `<Tooltip content={...} />`
 * and injects `active` / `payload` / `label`, so those props are optional here.
 * Styling matches the popover surface used elsewhere in the app.
 */
import { formatSeriesValue, type SeriesFormat } from "@/lib/chartTheme";

export interface TooltipSeriesMeta extends SeriesFormat {
  label: string;
  color: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: unknown; name?: string }>;
  label?: string | number;
  /** Formats the row of data being hovered — usually a date. */
  formatHeader?: (label: string | number) => string;
  /** Series metadata keyed by dataKey, for label/color/precision. */
  series: Record<string, TooltipSeriesMeta>;
}

export function ChartTooltip({ active, payload, label, formatHeader, series }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const header = formatHeader && label !== undefined ? formatHeader(label) : String(label ?? "");

  return (
    <div className="pointer-events-none rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {header && <p className="mb-1.5 font-medium text-foreground">{header}</p>}
      {payload.map((entry) => {
        const key = String(entry.dataKey ?? "");
        const meta = series[key];
        if (!meta) return null;
        const value = typeof entry.value === "number" ? entry.value : Number(entry.value);
        return (
          <div key={key} className="flex items-center justify-between gap-2 py-0.5">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: meta.color }}
              />
              <span className="text-muted-foreground">{meta.label}</span>
            </span>
            <span className="ml-3 font-data text-[13px] font-semibold text-foreground">
              {formatSeriesValue(meta, value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
