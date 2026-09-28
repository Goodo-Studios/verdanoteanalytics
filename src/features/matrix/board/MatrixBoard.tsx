// Presentational Creative Matrix board, following the Goodo ad naming
// convention: Creative Type rows (the 4 types in fixed order, plus an
// "Other / untagged" row when any ad in scope has no type or a legacy value) ×
// Theme / Persona columns (exact creatives.theme text, spend DESC, untagged
// last). Cells are spend-colored in every view mode
// (verdanote-winners-decided-by-spend-first).
//
// A cell is a button that reports its selection via `onSelectCell`; the page
// opens the hook split for the selected cell below the board.

import { useMemo } from "react";
import type { CreativeMatrix, MatrixCell } from "./api";
import { OTHER_CREATIVE_TYPE_LABEL } from "./api";
import {
  boardRows,
  cellDisplay,
  cellKey,
  creativeTypeLabel,
  fmtMoney,
  indexCells,
  maxCellSpend,
  spendColor,
  spendTextColor,
  tagLabel,
  type ViewMode,
} from "./matrixView";

export interface MatrixBoardProps {
  matrix: CreativeMatrix;
  mode: ViewMode;
  selectedKey: string | null;
  onSelectCell: (cell: MatrixCell | null) => void;
}

export function MatrixBoard({ matrix, mode, selectedKey, onSelectCell }: MatrixBoardProps) {
  const { themes } = matrix;

  const rows = useMemo(() => boardRows(matrix.creative_types), [matrix.creative_types]);
  const cellIndex = useMemo(() => indexCells(matrix.cells), [matrix.cells]);
  const maxSpend = useMemo(() => maxCellSpend(matrix.cells), [matrix.cells]);
  const themeSpend = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const t of themes) m.set(t.theme, t.total_spend);
    return m;
  }, [themes]);

  return (
    <div className="space-y-2">
      <div className="glass-panel overflow-x-auto">
        <table className="w-full border-collapse text-[12px]" data-testid="matrix-board">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-card border-b border-r border-border-light px-3 py-2 text-left align-bottom font-body text-[11px] uppercase tracking-wide text-slate min-w-[180px]"
              >
                Creative Type
              </th>
              <th
                colSpan={Math.max(themes.length, 1)}
                className="border-b border-border-light px-2 py-1.5 text-left font-body text-[11px] uppercase tracking-wide text-slate"
              >
                Theme / Persona
              </th>
            </tr>
            <tr>
              {themes.length === 0 ? (
                <th className="border-b border-border-light px-2 py-2 text-left font-body text-[12px] font-normal italic text-muted-foreground">
                  No themes yet
                </th>
              ) : (
                themes.map((t) => (
                  <th
                    key={t.theme ?? "__untagged_theme"}
                    className={`border-b border-border-light px-2 py-2 text-left align-bottom min-w-[92px] ${
                      t.is_untagged ? "bg-muted/40" : ""
                    }`}
                  >
                    <div
                      className={`font-body text-[12px] font-medium ${
                        t.is_untagged ? "text-muted-foreground italic" : "text-forest"
                      }`}
                    >
                      {tagLabel(t.theme)}
                    </div>
                    <div className="font-body text-[10px] text-muted-foreground mt-0.5">
                      {fmtMoney(t.total_spend)}
                    </div>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.creative_type ?? "__other_type"}
                className="hover:bg-accent/30"
                data-testid="matrix-row"
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-10 bg-card border-b border-r border-border-light px-3 py-1.5 text-left font-body text-[12px] font-normal min-w-[180px] ${
                    r.is_other ? "text-muted-foreground italic" : "text-charcoal"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{creativeTypeLabel(r.creative_type)}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {fmtMoney(r.total_spend)}
                    </span>
                  </div>
                </th>
                {themes.length === 0 ? (
                  <td className="border-b border-l border-border-light" />
                ) : (
                  themes.map((t) => {
                    const key = cellKey(r.creative_type, t.theme);
                    const cell = cellIndex.get(key);
                    const spend = cell?.total_spend ?? 0;
                    const display = cellDisplay(cell, mode, themeSpend.get(t.theme) ?? 0);
                    const isSelected = selectedKey === key;
                    const covered = !!cell && cell.n_ads > 0;
                    return (
                      <td
                        key={t.theme ?? "__untagged_theme"}
                        className="border-b border-l border-border-light p-0"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectCell(covered && cell ? cell : null)}
                          disabled={!covered}
                          style={{
                            backgroundColor: spendColor(spend, maxSpend),
                            color: spendTextColor(spend, maxSpend) || undefined,
                          }}
                          className={`flex h-full min-h-[38px] w-full items-center justify-center px-2 py-1.5 text-center font-body text-[12px] transition-shadow ${
                            covered ? "cursor-pointer hover:brightness-95" : "cursor-default"
                          } ${isSelected ? "ring-2 ring-inset ring-verdant" : ""} ${
                            mode === "coverage" && covered ? "text-verdant" : ""
                          }`}
                          aria-label={`${creativeTypeLabel(r.creative_type)} × ${tagLabel(
                            t.theme,
                          )}: ${fmtMoney(spend)} spend, ${cell?.n_ads ?? 0} ads`}
                          aria-pressed={isSelected}
                        >
                          {display}
                        </button>
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-body text-[11px] text-muted-foreground" data-testid="matrix-legend">
        Rows are the 4 Creative Types from the ad name. Ads with no Creative Type, or an older
        value, are grouped in the “{OTHER_CREATIVE_TYPE_LABEL}” row. Columns are each Theme /
        Persona exactly as named. Click a cell to split its ads by Hook.
      </p>
    </div>
  );
}
