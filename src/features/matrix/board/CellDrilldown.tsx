// Cell drill-down: opens when a strategist clicks a Creative Type × Theme cell
// and splits that cell's ads by their EXACT hook text (no clustering, no body
// axis). Each hook row is spend-colored in the same verdant scale as the board
// (verdanote-winners-decided-by-spend-first — fill is ALWAYS SUM(spend), never
// ROAS). The untagged hook bucket is rendered, never hidden. Clicking a hook
// row opens the atomic ads carrying that hook below the list. All aggregation,
// ranking, and bucketing come from rpc_creative_matrix_theme_cell — this
// component only renders.

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import type { CreativeMatrixCell } from "./api";
import { AtomicAdCard } from "./AtomicAdCard";
import {
  adsForHook,
  fmtMoney,
  hookKey,
  hookRowDisplay,
  maxCellSpend,
  spendColor,
  spendTextColor,
  tagLabel,
} from "./matrixView";

export interface CellDrilldownProps {
  cell: CreativeMatrixCell | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  /** Account optimization goal → objective metric on each atomic ad. */
  optimizationGoal: string | null | undefined;
}

export function CellDrilldown({
  cell,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  optimizationGoal,
}: CellDrilldownProps) {
  const [selectedHook, setSelectedHook] = useState<string | null>(null);

  const hooks = useMemo(() => cell?.hooks ?? [], [cell?.hooks]);
  const maxSpend = useMemo(() => maxCellSpend(hooks), [hooks]);

  const openedHook = useMemo(() => {
    if (selectedHook === null) return null;
    return hooks.find((h) => hookKey(h.hook) === selectedHook) ?? null;
  }, [selectedHook, hooks]);

  const openedAds = useMemo(() => {
    if (!openedHook || !cell) return [];
    return adsForHook(cell.ads, openedHook.hook);
  }, [openedHook, cell]);

  if (isLoading) {
    return (
      <div className="glass-panel p-8 flex items-center justify-center" data-testid="cell-drilldown-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="glass-panel p-6 flex flex-col items-center justify-center gap-3 text-center">
        <p className="font-body text-[13px] text-slate">
          {errorMessage ?? "Failed to load the hook breakdown."}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border-light px-3 py-1.5 font-body text-[12px] text-forest hover:bg-sage-light/40"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!cell) return null;

  if (hooks.length === 0) {
    return (
      <div className="glass-panel p-6 flex items-center justify-center text-center">
        <p className="font-body text-[13px] text-slate">
          No hooks for this cell yet. The breakdown fills in as new ads are named with the
          generator.
        </p>
      </div>
    );
  }

  return (
    <div
      className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200"
      data-testid="cell-drilldown"
    >
      <div className="glass-panel overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="border-b border-r border-border-light px-3 py-2 text-left font-body text-[11px] uppercase tracking-wide text-slate min-w-[200px]">
                Hook
              </th>
              <th className="border-b border-border-light px-3 py-2 text-left font-body text-[11px] uppercase tracking-wide text-slate min-w-[120px]">
                Spend
              </th>
              <th className="border-b border-border-light px-3 py-2 text-right font-body text-[11px] uppercase tracking-wide text-slate w-[80px]">
                Ads
              </th>
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => {
              const key = hookKey(h.hook);
              const isSelected = selectedHook === key;
              const covered = h.n_ads > 0;
              return (
                <tr key={key} className="hover:bg-accent/30" data-testid="hook-row">
                  <th
                    scope="row"
                    className={`border-b border-r border-border-light px-3 py-1.5 text-left font-body text-[12px] font-normal ${
                      h.is_untagged ? "text-muted-foreground italic" : "text-charcoal"
                    }`}
                  >
                    {tagLabel(h.hook)}
                  </th>
                  <td className="border-b border-border-light p-0">
                    <button
                      type="button"
                      onClick={() => setSelectedHook(isSelected ? null : key)}
                      disabled={!covered}
                      style={{
                        backgroundColor: spendColor(h.total_spend, maxSpend),
                        color: spendTextColor(h.total_spend, maxSpend) || undefined,
                      }}
                      className={`flex h-full min-h-[34px] w-full items-center px-3 py-1.5 font-body text-[12px] transition-shadow ${
                        covered ? "cursor-pointer hover:brightness-95" : "cursor-default"
                      } ${isSelected ? "ring-2 ring-inset ring-verdant" : ""}`}
                      aria-label={`Hook ${tagLabel(h.hook)}: ${fmtMoney(h.total_spend)} spend, ${
                        h.n_ads
                      } ads`}
                      aria-pressed={isSelected}
                    >
                      {hookRowDisplay(h)}
                    </button>
                  </td>
                  <td className="border-b border-border-light px-3 py-1.5 text-right font-body text-[12px] text-charcoal">
                    {h.n_ads}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Atomic-ad panel for the opened hook */}
      {openedHook && (
        <div className="space-y-2" data-testid="atomic-ad-panel">
          <div className="font-body text-[12px] text-muted-foreground">
            {openedAds.length} ad{openedAds.length === 1 ? "" : "s"} · Hook{" "}
            <span className="text-forest">{tagLabel(openedHook.hook)}</span> ·{" "}
            {fmtMoney(openedHook.total_spend)} spend
          </div>
          {openedAds.length === 0 ? (
            <div className="glass-panel p-4 text-center font-body text-[12px] text-slate">
              No individual ads resolved for this hook.
            </div>
          ) : (
            <div className="grid gap-2">
              {openedAds.map((ad) => (
                <AtomicAdCard
                  key={ad.ad_id}
                  ad={ad}
                  theme={cell.theme}
                  creativeType={cell.creative_type}
                  optimizationGoal={optimizationGoal}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
