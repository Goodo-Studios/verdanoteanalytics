const fmt = (v: number | null, prefix = "", suffix = "") => {
  if (v === null || v === undefined) return "—";
  return `${prefix}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
};

interface MetricSummarySectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

export function MetricSummarySection({ report }: MetricSummarySectionProps) {
  const clickWindow = report.click_window ?? 7;
  const viewWindow = report.view_window ?? 1;
  const clickLabel = clickWindow === 1 ? "1d click" : clickWindow === 7 ? "7d click" : "28d click";
  const viewLabel = viewWindow === 0 ? "no view" : "1d view";

  const metrics = [
    { label: "Creatives", value: report.creative_count },
    { label: "Total Spend", value: fmt(report.total_spend, "$") },
    { label: "Blended ROAS", value: fmt(report.blended_roas, "", "x") },
    { label: "Avg CPA", value: fmt(report.average_cpa, "$") },
    { label: "Avg CTR", value: fmt(report.average_ctr, "", "%") },
    { label: "Win Rate", value: fmt(report.win_rate, "", "%") },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="glass-panel p-4 text-center space-y-1">
            <div className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
            <div className="font-data text-[20px] font-semibold text-foreground tabular-nums">{m.value}</div>
          </div>
        ))}
      </div>
      <p className="font-body text-[10px] text-muted-foreground text-right">
        Attribution: {clickLabel}, {viewLabel}
      </p>
    </div>
  );
}
