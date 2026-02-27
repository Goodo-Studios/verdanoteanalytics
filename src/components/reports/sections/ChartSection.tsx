import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface ChartSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

const METRIC_OPTIONS = [
  { value: "spend", label: "Spend", prefix: "$", suffix: "" },
  { value: "roas", label: "ROAS", prefix: "", suffix: "x" },
  { value: "cpa", label: "CPA", prefix: "$", suffix: "" },
  { value: "ctr", label: "CTR", prefix: "", suffix: "%" },
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

  const fmtVal = (v: number) => `${metaInfo.prefix}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${metaInfo.suffix}`;

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
        <MiniLineChart dates={chartData.dates} values={chartData.values} fmtVal={fmtVal} color="hsl(var(--primary))" />
      ) : (
        <div className="glass-panel flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">No daily data for this date range.</p>
        </div>
      )}
    </div>
  );
}

function MiniLineChart({ dates, values, fmtVal, color }: { dates: string[]; values: number[]; fmtVal: (v: number) => string; color: string }) {
  const width = 600;
  const height = 180;
  const padding = 50;
  const chartH = height - 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xStep = dates.length > 1 ? (width - padding * 2) / (dates.length - 1) : 0;
  const points = values.map((v, i) => ({
    x: padding + i * xStep,
    y: 20 + chartH - ((v - min) / range) * chartH,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const yTicks = Array.from({ length: 4 }, (_, i) => {
    const val = min + (range * i) / 3;
    const y = 20 + chartH - (i / 3) * chartH;
    return { val, y };
  });
  const xLabelInterval = Math.max(1, Math.floor(dates.length / 6));

  return (
    <div className="glass-panel p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padding} y1={t.y} x2={width - padding} y2={t.y} stroke="hsl(var(--border))" strokeWidth={0.5} />
            <text x={padding - 4} y={t.y + 3} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize={10}>
              {fmtVal(t.val)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {dates.map((d, i) =>
          (i % xLabelInterval === 0 || i === dates.length - 1) ? (
            <text key={i} x={points[i].x} y={height - 4} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={10}>
              {format(new Date(d + "T12:00:00"), "MMM d")}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
