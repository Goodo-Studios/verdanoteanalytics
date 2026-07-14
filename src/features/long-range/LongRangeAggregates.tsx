import { useState } from "react";
import {
  useWindowAggregates,
  WINDOW_PRESETS,
  type WindowPreset,
} from "@/hooks/useWindowAggregates";
import { cn } from "@/lib/utils";

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
  const { data, isLoading, isError, error } = useWindowAggregates(accountId, days);

  const rows = data ?? [];

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
        <p className="font-body text-sm text-destructive">
          Failed to load window aggregates
          {error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {isLoading && (
        <div className="flex justify-center py-10">
          <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="font-body text-sm text-muted-foreground py-6">
          No data for the last {WINDOW_LABELS[days]}.
        </p>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border-light">
                <th className="py-2 pr-4 font-medium">Ad</th>
                <th className="py-2 px-4 font-medium text-right">Spend</th>
                <th className="py-2 px-4 font-medium text-right">Impr.</th>
                <th className="py-2 px-4 font-medium text-right">Purch.</th>
                <th className="py-2 px-4 font-medium text-right">ROAS</th>
                <th className="py-2 pl-4 font-medium text-right">CPA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ad_id} className="border-b border-border-light/50">
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {r.ad_id}
                  </td>
                  <td className="py-2 px-4 text-right">{fmtMoney(r.spend)}</td>
                  <td className="py-2 px-4 text-right">{fmtInt(r.impressions)}</td>
                  <td className="py-2 px-4 text-right">{fmtInt(r.purchases)}</td>
                  <td className="py-2 px-4 text-right">{fmtRatio(r.roas)}</td>
                  <td className="py-2 pl-4 text-right">{fmtMoney(r.cpa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
