// US-007: Presentational creative-matrix board. Theme/Persona columns ×
// creative-type rows, rows grouped by collapsible lane, cells spend-colored in
// every view mode (verdanote-winners-decided-by-spend-first). Explicit untagged
// buckets render on both axes (the RPC always emits them).
//
// A cell is a button that reports its selection via `onSelectCell`, and the
// selected cell carries a highlight ring. That is the seam US-008 hangs its
// cell drill-down (hooks × bodies) off of — this component intentionally does
// NOT implement that inner grid.

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CreativeMatrix, MatrixCell } from "./api";
import {
  cellDisplay,
  cellKey,
  fmtMoney,
  groupTypesByLane,
  indexCells,
  maxCellSpend,
  spendColor,
  spendTextColor,
  type ViewMode,
} from "./matrixView";

export interface MatrixBoardProps {
  matrix: CreativeMatrix;
  mode: ViewMode;
  /** type_name → lane, from the account taxonomy (US-003). */
  typeNameToLane: Map<string, string>;
  selectedKey: string | null;
  onSelectCell: (cell: MatrixCell | null) => void;
}

function typeLabel(creativeType: string | null): string {
  return creativeType === null ? "Untagged" : creativeType;
}

export function MatrixBoard({
  matrix,
  mode,
  typeNameToLane,
  selectedKey,
  onSelectCell,
}: MatrixBoardProps) {
  const { angles, creative_types } = matrix;

  const cellIndex = useMemo(() => indexCells(matrix.cells), [matrix.cells]);
  const maxSpend = useMemo(() => maxCellSpend(matrix.cells), [matrix.cells]);
  const laneGroups = useMemo(
    () => groupTypesByLane(creative_types, typeNameToLane),
    [creative_types, typeNameToLane],
  );
  const angleSpend = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const a of angles) m.set(a.angle_id, a.total_spend);
    return m;
  }, [angles]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleLane = (lane: string) =>
    setCollapsed((prev) => ({ ...prev, [lane]: !prev[lane] }));

  const colCount = angles.length + 1;

  return (
    <div className="glass-panel overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card border-b border-r border-border-light px-3 py-2 text-left font-body text-[11px] uppercase tracking-wide text-slate min-w-[180px]">
              Creative type
            </th>
            {angles.map((a) => (
              <th
                key={a.angle_id ?? "__untagged_angle"}
                className={`border-b border-border-light px-2 py-2 text-left align-bottom min-w-[92px] ${
                  a.angle_id === null ? "bg-muted/40" : ""
                }`}
              >
                <div
                  className={`font-body text-[12px] font-medium ${
                    a.angle_id === null ? "text-muted-foreground italic" : "text-forest"
                  }`}
                >
                  {a.label ?? "Untagged"}
                </div>
                <div className="font-body text-[10px] text-muted-foreground mt-0.5">
                  {fmtMoney(a.total_spend)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {laneGroups.map((group) => {
            const isCollapsed = !!collapsed[group.lane];
            return (
              <FragmentLane
                key={group.lane}
                lane={group.lane}
                isCollapsed={isCollapsed}
                colCount={colCount}
                onToggle={() => toggleLane(group.lane)}
              >
                {group.types.map((t) => (
                  <tr key={t.creative_type ?? "__untagged_type"} className="hover:bg-accent/30">
                    <th
                      scope="row"
                      className={`sticky left-0 z-10 bg-card border-b border-r border-border-light px-3 py-1.5 text-left font-body text-[12px] font-normal min-w-[180px] ${
                        t.creative_type === null ? "text-muted-foreground italic" : "text-charcoal"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{typeLabel(t.creative_type)}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {fmtMoney(t.total_spend)}
                        </span>
                      </div>
                    </th>
                    {angles.map((a) => {
                      const key = cellKey(a.angle_id, t.creative_type);
                      const cell = cellIndex.get(key);
                      const spend = cell?.total_spend ?? 0;
                      const display = cellDisplay(cell, mode, angleSpend.get(a.angle_id) ?? 0);
                      const isSelected = selectedKey === key;
                      const covered = !!cell && cell.n_ads > 0;
                      return (
                        <td
                          key={a.angle_id ?? "__untagged_angle"}
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
                            } ${
                              isSelected ? "ring-2 ring-inset ring-verdant" : ""
                            } ${
                              mode === "coverage" && covered ? "text-verdant" : ""
                            }`}
                            aria-label={`${a.label ?? "Untagged"} × ${typeLabel(
                              t.creative_type,
                            )}: ${fmtMoney(spend)} spend, ${cell?.n_ads ?? 0} ads`}
                            aria-pressed={isSelected}
                          >
                            {display}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </FragmentLane>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface FragmentLaneProps {
  lane: string;
  isCollapsed: boolean;
  colCount: number;
  onToggle: () => void;
  children: React.ReactNode;
}

/** A lane header row + (when expanded) its creative-type rows. */
function FragmentLane({ lane, isCollapsed, colCount, onToggle, children }: FragmentLaneProps) {
  return (
    <>
      <tr>
        <td colSpan={colCount} className="bg-sage-light/40 border-b border-border-light p-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!isCollapsed}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-label text-[10px] uppercase tracking-[0.1em] text-forest hover:bg-sage-light/70 transition-colors"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform duration-150 ${
                isCollapsed ? "" : "rotate-90"
              }`}
            />
            {lane}
          </button>
        </td>
      </tr>
      {!isCollapsed && children}
    </>
  );
}
