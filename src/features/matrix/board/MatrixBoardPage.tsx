// Creative Matrix board (builder-only), following the Goodo ad naming
// convention: Creative Type rows (the 4 types from creatives.style in fixed
// order, plus Other / untagged) × Theme / Persona columns (creatives.theme),
// cells colored by SUM(spend) in every view mode
// (verdanote-winners-decided-by-spend-first). Clicking a cell splits its ads by
// exact Hook. Four view modes: performance (spend), coverage, volume, win rate.
//
// Data comes from the session-authed `matrix` edge fn → rpc_creative_matrix and
// rpc_creative_matrix_theme_cell. Route access is gated builder-only in App.tsx;
// this page assumes it only mounts for a builder.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Button } from "@/components/ui/button";
import { useAccountContext } from "@/contexts/AccountContext";
import { useDateRangeContext } from "@/contexts/DateRangeContext";
import { MatrixBoard } from "./MatrixBoard";
import { CellDrilldown } from "./CellDrilldown";
import { useCreativeMatrix, useCreativeMatrixCell } from "./useCreativeMatrix";
import { cellKey, creativeTypeLabel, fmtMoney, tagLabel, VIEW_MODES, type ViewMode } from "./matrixView";
import type { MatrixCell } from "./api";

const MatrixBoardPage = () => {
  const { selectedAccountId, accounts } = useAccountContext();

  // The board follows the app-wide selected account (the left sidebar controls
  // it) — no private account dropdown. When the app selection is the agency
  // "all" bucket or null, fall back to the first available account so the
  // builder-only board always has a concrete account to render.
  const accountId = useMemo(() => {
    if (
      selectedAccountId &&
      selectedAccountId !== "all" &&
      accounts.some((a) => a.id === selectedAccountId)
    ) {
      return selectedAccountId;
    }
    return accounts[0]?.id ?? null;
  }, [accounts, selectedAccountId]);

  // App-wide, per-account, persisted date range (shared with every other page).
  const { dateFrom, dateTo, setDateRange } = useDateRangeContext();
  const [mode, setMode] = useState<ViewMode>("performance");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<MatrixCell | null>(null);

  const matrixQuery = useCreativeMatrix(accountId, dateFrom, dateTo);
  // The selected cell's hook split + atomic ads. Fires only once a cell is
  // open (hasCell), and re-keys on the cell selector.
  const cellQuery = useCreativeMatrixCell(
    accountId,
    !!selectedCell,
    selectedCell?.creative_type ?? null,
    selectedCell?.theme ?? null,
    dateFrom,
    dateTo,
  );

  // The board account's optimization goal drives which objective metric each
  // atomic ad surfaces (getObjectiveConfig).
  const optimizationGoal = useMemo(
    () => accounts.find((a) => a.id === accountId)?.optimization_goal ?? null,
    [accounts, accountId],
  );

  const handleSelectCell = (cell: MatrixCell | null) => {
    if (!cell) {
      setSelectedKey(null);
      setSelectedCell(null);
      return;
    }
    const key = cellKey(cell.creative_type, cell.theme);
    if (key === selectedKey) {
      setSelectedKey(null);
      setSelectedCell(null);
    } else {
      setSelectedKey(key);
      setSelectedCell(cell);
    }
  };

  // Reselecting the account clears any open cell selection.
  useEffect(() => {
    setSelectedKey(null);
    setSelectedCell(null);
  }, [accountId]);

  const matrix = matrixQuery.data;
  const isEmpty = !!matrix && matrix.cells.length === 0;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Creative Matrix"
        description="Creative Type × Theme / Persona coverage, colored by spend. Click a cell to split it by Hook."
        actions={
          <div className="flex items-center gap-2">
            <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={setDateRange} />
          </div>
        }
      />

      {/* View-mode toggle */}
      <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5 w-fit">
        {VIEW_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            aria-pressed={mode === m.key}
            className={`px-3 py-1.5 rounded-[5px] font-label text-[11px] uppercase tracking-[0.08em] font-semibold transition-colors ${
              mode === m.key
                ? "bg-background text-forest shadow-sm"
                : "text-sage hover:text-forest"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Selected-cell strip + drill-down: the cell's ads split by Hook, and the
          atomic ads behind the opened hook. */}
      {selectedCell && (
        <>
          <div className="glass-panel px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-body text-[13px] text-forest font-medium">
              {creativeTypeLabel(selectedCell.creative_type)} × {tagLabel(selectedCell.theme)}
            </span>
            <span className="font-body text-[12px] text-muted-foreground">
              {fmtMoney(selectedCell.total_spend)} spend · {selectedCell.n_ads} ads · spend rank #
              {selectedCell.spend_rank}
            </span>
            <span className="font-body text-[11px] text-slate">
              Split by Hook
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-[12px]"
              onClick={() => handleSelectCell(null)}
            >
              Clear
            </Button>
          </div>
          <CellDrilldown
            cell={cellQuery.data}
            isLoading={cellQuery.isLoading}
            isError={cellQuery.isError}
            errorMessage={
              cellQuery.error instanceof Error ? cellQuery.error.message : undefined
            }
            onRetry={() => cellQuery.refetch()}
            optimizationGoal={optimizationGoal}
          />
        </>
      )}

      {accountId === null && accounts.length === 0 ? (
        <div className="glass-panel p-8 flex items-center justify-center text-center">
          <p className="font-body text-[13px] text-slate">
            Add an ad account to see its creative matrix.
          </p>
        </div>
      ) : matrixQuery.isLoading ? (
        <div className="glass-panel p-12 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : matrixQuery.isError ? (
        <div className="glass-panel p-8 flex flex-col items-center justify-center text-center gap-3">
          <p className="font-body text-[13px] text-slate">
            {matrixQuery.error instanceof Error
              ? matrixQuery.error.message
              : "Failed to load the creative matrix."}
          </p>
          <Button size="sm" variant="outline" onClick={() => matrixQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : isEmpty ? (
        <div className="glass-panel p-8 flex items-center justify-center text-center">
          <p className="font-body text-[13px] text-slate">
            No ads with spend in this date range yet. The board fills in as new ads are named
            with the generator.
          </p>
        </div>
      ) : matrix ? (
        <MatrixBoard
          matrix={matrix}
          mode={mode}
          selectedKey={selectedKey}
          onSelectCell={handleSelectCell}
        />
      ) : null}
    </div>
  );
};

export default MatrixBoardPage;
