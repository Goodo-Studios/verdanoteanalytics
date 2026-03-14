import { useDailyTrends } from "@/hooks/useDailyTrends";
import { MultiLineTrendChart, type TrendLine } from "@/components/MultiLineTrendChart";
import { useMemo } from "react";

const METRIC_CONFIG: Record<string, { label: string; color: string; prefix?: string; suffix?: string; decimals?: number }> = {
  roas: { label: "ROAS", color: "hsl(var(--verdant))", suffix: "x", decimals: 2 },
  spend: { label: "Spend", color: "hsl(var(--forest))", prefix: "$", decimals: 0 },
  cpa: { label: "CPA", color: "hsl(var(--gold))", prefix: "$", decimals: 2 },
  ctr: { label: "CTR", color: "#6366f1", suffix: "%", decimals: 2 },
  cpm: { label: "CPM", color: "#ec4899", prefix: "$", decimals: 2 },
};

interface Props {
  accountId?: string;
  metric?: string;
}

export function TrendChartSection({ accountId, metric = "roas" }: Props) {
  const { data: trends = [] } = useDailyTrends(accountId);

  const { dates, lines } = useMemo(() => {
    if (trends.length === 0) return { dates: [], lines: [] };
    const dates = trends.map((t) => t.date);
    const cfg = METRIC_CONFIG[metric] || METRIC_CONFIG.roas;
    const line: TrendLine = {
      key: metric,
      label: cfg.label,
      color: cfg.color,
      prefix: cfg.prefix,
      suffix: cfg.suffix,
      decimals: cfg.decimals,
      values: trends.map((t) => (t as any)[metric] || 0),
    };
    return { dates, lines: [line] };
  }, [trends, metric]);

  return (
    <div className="bg-card border border-border-light rounded-[8px] p-5">
      <h2 className="font-heading text-[18px] text-forest mb-4">Trend: {METRIC_CONFIG[metric]?.label || metric}</h2>
      {dates.length === 0 ? (
        <p className="font-body text-[13px] text-sage text-center py-8">No daily data available.</p>
      ) : (
        <MultiLineTrendChart dates={dates} lines={lines} height={220} />
      )}
    </div>
  );
}
