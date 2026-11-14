import { useState } from "react";
import {
  useWindowAggregates,
  WINDOW_PRESETS,
  type WindowPreset,
} from "@/hooks/useWindowAggregates";
import { cn } from "@/lib/utils";
import { DataTable, EmptyState, ErrorState, LoadingState, type DataColumn } from "@/components/page-kit";

// US-005: On-demand long-range view. Lets the operator request a common window
// (30/90/180/365d) and renders the per-ad aggregates served from daily rows by
// the get_creative_window_aggregates RPC. Long-range views are query-time, not
// stored — this component is the UI surface for that.

interface LongRangeAggregatesProps {
  accountId?: string;
}

const WINDOW_LABELS: Record<WindowPreset, string> = {
  30: "30d",
  90: "90d",
  180: "180d",
  365: "365d",
};

function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtRatio(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function LongRangeAggregates({ accountId }: LongRangeAggregatesProps) {
  const [days, setDays] = useState<WindowPreset>(30);
  const { data, isLoading, isError, error, refetch } = useWindowAggregates(accountId, days);

  const rows = data ?? [];

  const columns: DataColumn<(typeof rows)[number]>[] = [
    { key: "ad", header: "Ad", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ad_id}</span> },
    { key: "spend", header: "Spend", align: "right", cell: (r) => fmtMoney(r.spend) },
    { key: "impr", header: "Impr.", align: "right", cell: (r) => fmtInt(r.impressions) },
    { key: "purch", header: "Purch.", align: "right", cell: (r) => fmtInt(r.purchases) },
    { key: "roas", header: "ROAS", align: "right", cell: (r) => fmtRatio(r.roas) },
    { key: "cpa", header: "CPA", align: "right", cell: (r) => fmtMoney(r.cpa) },
  ];

  return (
    <div className="space-y-4">
      {/* Window preset selector */}
      <div
        role="group"
        aria-label="Select window"
        className="inline-flex rounded-md border border-border-light bg-card p-0.5"
      >
        {WINDOW_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={days === preset}
            onClick={() => setDays(preset)}
            className={cn(
              "px-3 py-1.5 text-sm font-body rounded-[5px] transition-colors",
              days === preset
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {WINDOW_LABELS[preset]}
          </button>
        ))}
      </div>

      {isError && (
        <ErrorState
          message={`Failed to load window aggregates${error instanceof Error ? `: ${error.message}` : ""}.`}
          onRetry={() => void refetch()}
        />
      )}

      {isLoading && <LoadingState label="Loading window aggregates" />}

      {!isLoading && !isError && rows.length === 0 && <EmptyState title={`No data for the last ${WINDOW_LABELS[days]}.`} />}

      {!isLoading && !isError && rows.length > 0 && (
        <DataTable label="Ads in this window" columns={columns} rows={rows} rowKey={(r) => r.ad_id} />
      )}
    </div>
  );
}
