// US-008: cell drill-down — the inner hook × body grid + atomic-ad panel that
// opens when a strategist clicks an outer Theme/Persona × creative-type cell.
//
// Hooks are columns, bodies are rows (mirrors the outer board's angle-columns /
// type-rows shape). Every inner cell is spend-colored in the same verdant scale
// as the outer board (verdanote-winners-decided-by-spend-first — fill is ALWAYS
// SUM(spend), never ROAS). Explicit untagged hook/body header + row/column are
// rendered, never hidden (AC #3). Clicking an inner cell opens the atomic ads in
// that hook×body combo below the grid (AC #2). All aggregation, ranking, and
// bucketing come from rpc_creative_matrix_cell — this component only renders.

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import type { CreativeMatrixCell } from "./api";
import { AtomicAdCard } from "./AtomicAdCard";
import {
  adsForInnerCell,
  fmtMoney,
  indexInnerCells,
  innerCellDisplay,
  innerCellKey,
  maxInnerCellSpend,
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
  const [selectedInner, setSelectedInner] = useState<string | null>(null);

  const cellIndex = useMemo(() => indexInnerCells(cell?.cells ?? []), [cell?.cells]);
  const maxSpend = useMemo(() => maxInnerCellSpend(cell?.cells ?? []), [cell?.cells]);

  // The (hook, body) pair currently opened, resolved back from its key.
  const openedInner = useMemo(() => {
    if (!selectedInner) return null;
    return (cell?.cells ?? []).find((c) => innerCellKey(c.hook, c.body) === selectedInner) ?? null;
  }, [selectedInner, cell?.cells]);

  const openedAds = useMemo(() => {
    if (!openedInner || !cell) return [];
    return adsForInnerCell(cell.ads, openedInner.hook, openedInner.body);
  }, [openedInner, cell]);

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
          {errorMessage ?? "Failed to load the hook × body grid."}
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

  const { hooks, bodies } = cell;

  if (hooks.length === 0 || bodies.length === 0) {
    return (
      <div className="glass-panel p-6 flex items-center justify-center text-center">
        <p className="font-body text-[13px] text-slate">
          No hook × body breakdown for this cell yet — tag the ads' hooks and bodies to populate the
          inner grid.
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
              <th className="sticky left-0 z-10 bg-card border-b border-r border-border-light px-3 py-2 text-left font-body text-[11px] uppercase tracking-wide text-slate min-w-[160px]">
                Body ╲ Hook
              </th>
              {hooks.map((h) => (
                <th
                  key={h.hook ?? "__untagged_hook"}
                  className={`border-b border-border-light px-2 py-2 text-left align-bottom min-w-[92px] ${
                    h.is_untagged ? "bg-muted/40" : ""
                  }`}
                >
                  <div
                    className={`font-body text-[12px] font-medium ${
                      h.is_untagged ? "text-muted-foreground italic" : "text-forest"
                    }`}
                  >
                    {tagLabel(h.hook)}
                  </div>
                  <div className="font-body text-[10px] text-muted-foreground mt-0.5">
                    {fmtMoney(h.total_spend)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodies.map((b) => (
              <tr key={b.body ?? "__untagged_body"} className="hover:bg-accent/30">
                <th
                  scope="row"
                  className={`sticky left-0 z-10 bg-card border-b border-r border-border-light px-3 py-1.5 text-left font-body text-[12px] font-normal min-w-[160px] ${
                    b.is_untagged ? "text-muted-foreground italic" : "text-charcoal"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{tagLabel(b.body)}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {fmtMoney(b.total_spend)}
                    </span>
                  </div>
                </th>
                {hooks.map((h) => {
                  const key = innerCellKey(h.hook, b.body);
                  const inner = cellIndex.get(key);
                  const spend = inner?.total_spend ?? 0;
                  const covered = !!inner && inner.n_ads > 0;
                  const isSelected = selectedInner === key;
                  return (
                    <td
                      key={h.hook ?? "__untagged_hook"}
                      className="border-b border-l border-border-light p-0"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedInner(isSelected ? null : key)}
                        disabled={!covered}
                        style={{
                          backgroundColor: spendColor(spend, maxSpend),
                          color: spendTextColor(spend, maxSpend) || undefined,
                        }}
                        className={`flex h-full min-h-[38px] w-full items-center justify-center px-2 py-1.5 text-center font-body text-[12px] transition-shadow ${
                          covered ? "cursor-pointer hover:brightness-95" : "cursor-default"
                        } ${isSelected ? "ring-2 ring-inset ring-verdant" : ""}`}
                        aria-label={`Hook ${tagLabel(h.hook)} × body ${tagLabel(b.body)}: ${fmtMoney(
                          spend,
                        )} spend, ${inner?.n_ads ?? 0} ads`}
                        aria-pressed={isSelected}
                      >
                        {innerCellDisplay(inner)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Atomic-ad panel for the opened inner cell */}
      {openedInner && (
        <div className="space-y-2" data-testid="atomic-ad-panel">
          <div className="font-body text-[12px] text-muted-foreground">
            {openedAds.length} ad{openedAds.length === 1 ? "" : "s"} · Hook{" "}
            <span className="text-forest">{tagLabel(openedInner.hook)}</span> × Body{" "}
            <span className="text-forest">{tagLabel(openedInner.body)}</span> ·{" "}
            {fmtMoney(openedInner.total_spend)} spend
          </div>
          {openedAds.length === 0 ? (
            <div className="glass-panel p-4 text-center font-body text-[12px] text-slate">
              No individual ads resolved for this combination.
            </div>
          ) : (
            <div className="grid gap-2">
              {openedAds.map((ad) => (
                <AtomicAdCard
                  key={ad.ad_id}
                  ad={ad}
                  angleLabel={cell.angle_label}
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
