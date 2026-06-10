import { DateRangeFilter } from "@/components/DateRangeFilter";
import { useOverviewPageState } from "@/hooks/useOverviewPageState";
import { useSync } from "@/hooks/useSyncApi";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { MetricCardSkeletonRow } from "@/components/skeletons/MetricCardSkeleton";
import { fmt$, fmtN, fmtPct, delta, deltaInverse } from "@/lib/formatters";
import { cn } from "@/lib/utils";

function BigMetric({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: { value: number; positive: boolean };
}) {
  return (
    <div className="bg-card p-8 space-y-3">
      <p className="font-label text-[11px] uppercase tracking-widest text-sage font-medium">
        {label}
      </p>
      <p className="font-data text-[48px] font-bold text-charcoal leading-none tracking-tight">
        {value}
      </p>
      {trend ? (
        <p className={cn("font-data text-[16px] font-medium", trend.positive ? "text-verdant" : "text-red-700")}>
          {trend.positive ? "↑" : "↓"} {Math.abs(trend.value)}% vs prior period
        </p>
      ) : (
        <p className="text-[16px] text-transparent select-none">—</p>
      )}
    </div>
  );
}

const OverviewPage = () => {
  const sync = useSync();
  const { isClient } = useAuth();
  const { isClientPreview } = useClientPreview();
  const effectiveClient = isClient || isClientPreview;

  const {
    accountName,
    lastSyncedAgo,
    dateFrom, dateTo, setDateFrom, setDateTo,
    metrics, prevMetrics, hasPrevPeriod,
    isLoading,
    creatives,
    selectedAccountId,
  } = useOverviewPageState();

  const subtitle = [
    dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : "All time",
    lastSyncedAgo ? `Synced ${lastSyncedAgo}` : null,
    !isLoading ? `${fmtN(creatives.length)} creatives` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-[24px] sm:text-[32px] text-forest">{accountName}</h1>
          <p className="font-body text-[12px] sm:text-[13px] text-slate font-light mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
          {!effectiveClient && (
            <Button
              size="sm"
              className="bg-verdant hover:bg-verdant/90 text-white font-body text-[13px] font-medium"
              onClick={() => sync.mutate({ account_id: selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined })}
              disabled={sync.isPending}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", sync.isPending && "animate-spin")} />
              Sync
            </Button>
          )}
        </div>
      </div>

      {/* Metrics */}
      {isLoading ? (
        <MetricCardSkeletonRow />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border-light border border-border-light rounded-[8px] overflow-hidden">
          <BigMetric
            label="Total Spend"
            value={fmt$(metrics.totalSpend)}
            trend={hasPrevPeriod ? delta(metrics.totalSpend, prevMetrics?.totalSpend) : undefined}
          />
          <BigMetric
            label="Active Creatives"
            value={fmtN(metrics.activeCount)}
            trend={hasPrevPeriod ? delta(metrics.activeCount, prevMetrics?.activeCount) : undefined}
          />
          <BigMetric
            label="Avg CPA"
            value={fmt$(metrics.avgCpa)}
            trend={hasPrevPeriod ? deltaInverse(metrics.avgCpa, prevMetrics?.avgCpa) : undefined}
          />
          <BigMetric
            label="Avg ROAS"
            value={`${metrics.avgRoas.toFixed(2)}x`}
            trend={hasPrevPeriod ? delta(metrics.avgRoas, prevMetrics?.avgRoas) : undefined}
          />
          <BigMetric
            label="Win Rate"
            value={fmtPct(metrics.winRate)}
          />
          <BigMetric
            label="Blended CTR"
            value={fmtPct(metrics.avgCtr)}
            trend={hasPrevPeriod ? delta(metrics.avgCtr, prevMetrics?.avgCtr) : undefined}
          />
        </div>
      )}
    </div>
  );
};

export default OverviewPage;
