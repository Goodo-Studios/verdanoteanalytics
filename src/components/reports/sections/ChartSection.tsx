import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useDailyTrends } from "@/hooks/useDailyTrends";
import { MultiLineTrendChart, type TrendLine } from "@/components/MultiLineTrendChart";
import { CHART_SERIES } from "@/lib/chartTheme";

interface ChartSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

const METRIC_OPTIONS = [
  { value: "spend", label: "Spend", prefix: "$", suffix: "", decimals: 0 },
  { value: "roas", label: "ROAS", prefix: "", suffix: "x", decimals: 2 },
  { value: "cpa", label: "CPA", prefix: "$", suffix: "", decimals: 2 },
  { value: "ctr", label: "CTR", prefix: "", suffix: "%", decimals: 2 },
];

export function ChartSection({ config, report, isEditing, onConfigChange }: ChartSectionProps) {
  const metric = config.metric || "spend";
  const metaInfo = METRIC_OPTIONS.find((m) => m.value === metric) || METRIC_OPTIONS[0];

  // Audit 7.3 / 6.1: per-day totals from the database (get_daily_trends), so every day in the
  // range is present (a raw per-ad select stopped at 1,000 rows, dropping the newest days) and
  // ROAS, CPA and CTR are totals over totals, not averages of per-ad values.
  const dateRange = report.date_range_start && report.date_range_end
    ? { from: report.date_range_start as string, to: report.date_range_end as string }
    : undefined;
  const { data: trends } = useDailyTrends(report.account_id || undefined, dateRange);

  const chartData = useMemo(() => {
    if (!dateRange || !trends?.length) return { dates: [] as string[], values: [] as number[] };
    const points = [...trends].sort((a, b) => a.date.localeCompare(b.date));
    const key = metric as "spend" | "roas" | "cpa" | "ctr";
    return { dates: points.map((p) => p.date), values: points.map((p) => Number(p[key]) || 0) };
  }, [trends, metric, dateRange]);

  const trendLines: TrendLine[] = useMemo(
    () => [
      {
        key: metric,
        label: metaInfo.label,
        color: CHART_SERIES[0],
        prefix: metaInfo.prefix,
        suffix: metaInfo.suffix,
        decimals: metaInfo.decimals,
        values: chartData.values,
      },
    ],
    [metric, metaInfo, chartData.values],
  );

  return (
    <div className="space-y-3">
      {isEditing && (
        <div className="p-3 rounded-[6px] bg-muted/50 border border-border-light">
          <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Metric</Label>
          <Select value={metric} onValueChange={(v) => onConfigChange?.({ ...config, metric: v })}>
            <SelectTrigger className="w-32 h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {chartData.dates.length > 0 ? (
        <MultiLineTrendChart dates={chartData.dates} lines={trendLines} height={200} />
      ) : (
        <div className="glass-panel flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">No daily data for this date range.</p>
        </div>
      )}
    </div>
  );
}
