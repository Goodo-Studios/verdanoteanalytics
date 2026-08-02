import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

  const { data: dailyData } = useQuery({
    queryKey: ["report-chart-data", report.account_id, report.date_range_start, report.date_range_end],
    queryFn: async () => {
      if (!report.date_range_start || !report.date_range_end) return [];
      let q = supabase
        .from("creative_daily_metrics")
        .select("date, spend, roas, cpa, ctr")
        .gte("date", report.date_range_start)
        .lte("date", report.date_range_end)
        .order("date");
      if (report.account_id) q = q.eq("account_id", report.account_id);
      const { data } = await q;
      return data || [];
    },
    enabled: !!report.date_range_start && !!report.date_range_end,
  });

  const chartData = useMemo(() => {
    if (!dailyData?.length) return { dates: [] as string[], values: [] as number[] };
    const byDate = new Map<string, number[]>();
    for (const row of dailyData) {
      const vals = byDate.get(row.date) || [];
      vals.push(Number((row as any)[metric]) || 0);
      byDate.set(row.date, vals);
    }
    const dates = [...byDate.keys()].sort();
    const values = dates.map((d) => {
      const vals = byDate.get(d)!;
      if (metric === "spend") return vals.reduce((s, v) => s + v, 0);
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    });
    return { dates, values };
  }, [dailyData, metric]);

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
