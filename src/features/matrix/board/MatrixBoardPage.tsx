// US-007: Creative Matrix board (builder-only). A /matrix board of Theme/Persona
// columns × creative-type rows, rows grouped by collapsible lane, cells colored
// by SUM(spend) in every view mode (verdanote-winners-decided-by-spend-first),
// with an explicit untagged bucket on each axis. Five view modes: performance
// (spend), status, coverage, volume, win rate.
//
// Data comes from the session-authed `matrix` edge fn → rpc_creative_matrix
// (US-006); the row-lane grouping reuses the account taxonomy read (US-003) for
// its creative_type → lane map. Route access is gated builder-only in App.tsx
// (matching the US-003 config surface); this page assumes it only mounts for a
// builder.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAccountTaxonomy } from "@/features/matrix/config/useAccountTaxonomy";
import { MatrixBoard } from "./MatrixBoard";
import { useCreativeMatrix } from "./useCreativeMatrix";
import { cellKey, fmtMoney, VIEW_MODES, type ViewMode } from "./matrixView";
import type { MatrixCell } from "./api";

const MatrixBoardPage = () => {
  const { selectedAccountId, accounts } = useAccountContext();

  // Resolve the board account: the app-selected account when it's a real
  // account (agency "all" and null are not), else the first available account.
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => {
    if (accountId && accounts.some((a) => a.id === accountId)) return;
    const appMatch =
      selectedAccountId &&
      selectedAccountId !== "all" &&
      accounts.some((a) => a.id === selectedAccountId)
        ? selectedAccountId
        : null;
    setAccountId(appMatch ?? accounts[0]?.id ?? null);
  }, [accounts, selectedAccountId, accountId]);

  const [dateFrom, setDateFrom] = useState<string | undefined>(undefined);
  const [dateTo, setDateTo] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<ViewMode>("performance");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<MatrixCell | null>(null);

  const matrixQuery = useCreativeMatrix(accountId, dateFrom, dateTo);
  const taxonomyQuery = useAccountTaxonomy(accountId).query;

  // type_name → lane, sourced from the account taxonomy. Matrix rows whose
  // creative_type has no lane mapping fall into "Other" (see groupTypesByLane).
  const typeNameToLane = useMemo(() => {
    const m = new Map<string, string>();
    for (const ct of taxonomyQuery.data?.creative_types ?? []) {
      if (ct.type_name) m.set(ct.type_name, ct.lane);
    }
    return m;
  }, [taxonomyQuery.data]);

  const handleSelectCell = (cell: MatrixCell | null) => {
    if (!cell) {
      setSelectedKey(null);
      setSelectedCell(null);
      return;
    }
    const key = cellKey(cell.angle_id, cell.creative_type);
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
  const isEmpty =
    !!matrix && matrix.angles.length === 0 && matrix.cells.length === 0;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Creative Matrix"
        description="Theme/Persona × creative-type coverage, ranked and colored by spend."
        actions={
          <div className="flex items-center gap-2">
            {accounts.length > 1 && (
              <Select value={accountId ?? ""} onValueChange={(v) => setAccountId(v)}>
                <SelectTrigger className="w-52 h-9">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {[...accounts]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <DateRangeFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={(from, to) => {
                setDateFrom(from);
                setDateTo(to);
              }}
            />
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

      {/* Selected-cell strip — the seam US-008 hangs the hook × body drill-down
          off of. We surface the cell summary here; the inner grid is US-008. */}
      {selectedCell && (
        <div className="glass-panel px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-body text-[13px] text-forest font-medium">
            {selectedCell.angle_label ?? "Untagged"} × {selectedCell.creative_type ?? "Untagged"}
          </span>
          <span className="font-body text-[12px] text-muted-foreground">
            {fmtMoney(selectedCell.total_spend)} spend · {selectedCell.n_ads} ads · spend rank #
            {selectedCell.spend_rank}
          </span>
          <span className="font-body text-[11px] text-muted-foreground italic">
            Hook × body drill-down coming soon
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
            No creatives in scope yet — tag creatives and adjust the date range to populate the
            matrix.
          </p>
        </div>
      ) : matrix ? (
        <MatrixBoard
          matrix={matrix}
          mode={mode}
          typeNameToLane={typeNameToLane}
          selectedKey={selectedKey}
          onSelectCell={handleSelectCell}
        />
      ) : null}
    </div>
  );
};

export default MatrixBoardPage;
