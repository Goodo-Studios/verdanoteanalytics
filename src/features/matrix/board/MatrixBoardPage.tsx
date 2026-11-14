// Creative Matrix board (builder-only), following the Goodo ad naming
// convention: Creative Type rows (the 4 types from creatives.style in fixed
// order, plus Other / untagged) × Theme / Persona columns (creatives.theme),
// cells colored by SUM(spend) in every view mode
// (verdanote-winners-decided-by-spend-first). Clicking a cell splits its ads by
// exact Hook. Four view modes: performance (spend), coverage, volume, share of theme spend.
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
  // The header names the account and says so when the board picked it, so a builder on "All
  // accounts" is never shown one account's numbers without knowing.
  const { accountId, usedFallback } = useMemo(() => {
    if (
      selectedAccountId &&
      selectedAccountId !== "all" &&
      accounts.some((a) => a.id === selectedAccountId)
    ) {
      return { accountId: selectedAccountId, usedFallback: false };
    }
    return { accountId: accounts[0]?.id ?? null, usedFallback: accounts.length > 0 };
  }, [accounts, selectedAccountId]);
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? null;

  // App-wide, per-account, persisted date range (shared with every other page).
  const { dateFrom, dateTo, setDateRange } = useDateRangeContext();
  const [mode, setMode] = useState<ViewMode>("performance");
  // Only the selected cell's identity is stored. The cell itself is read from the current matrix by
  // key, so the strip always shows the same numbers as the board and the drill-down.
  // The selection remembers which board (account and range) it was made on and only counts there, so
  // no render pairs an open cell with a different account or range.
  const scope = `${accountId}|${dateFrom}|${dateTo}`;
  const [picked, setPicked] = useState<{ scope: string; creative_type: string | null; theme: string | null } | null>(null);
  const selection = picked && picked.scope === scope ? picked : null;
  const selectedKey = selection ? cellKey(selection.creative_type, selection.theme) : null;

  const matrixQuery = useCreativeMatrix(accountId, dateFrom, dateTo);
  const matrix = matrixQuery.data;
  const selectedCell = useMemo<MatrixCell | null>(() => {
    if (!selectedKey || !matrix) return null;
    return matrix.cells.find((c) => cellKey(c.creative_type, c.theme) === selectedKey) ?? null;
  }, [matrix, selectedKey]);

  // The selected cell's hook split + atomic ads. Fires only once a cell is
  // open (hasCell), and re-keys on the cell selector.
  const cellQuery = useCreativeMatrixCell(
    accountId,
    !!selection,
    selection?.creative_type ?? null,
    selection?.theme ?? null,
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
    if (!cell || cellKey(cell.creative_type, cell.theme) === selectedKey) {
      setPicked(null);
    } else {
      setPicked({ scope, creative_type: cell.creative_type, theme: cell.theme });
    }
  };

  // A different account or date range is a different board, so any open cell is closed for good
  // (going back to the old range does not bring the old cell back).
  useEffect(() => {
    setPicked(null);
  }, [scope]);

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

      {accountName && (
        <p data-testid="matrix-account" className="font-body text-[12px] text-muted-foreground">
          Account: <span className="font-medium text-forest">{accountName}</span>
          {usedFallback && (
            <>
              {" "}
              (the app is set to All accounts, so the board shows the first account. Pick an account in
              the sidebar to change it.)
            </>
          )}
        </p>
      )}

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
