// US-007: Pure, unit-testable view helpers for the creative-matrix board —
// spend-first coloring, per-mode cell display, lane grouping, and cell lookup.
// No React, no I/O: aggregation/ranking already happened in rpc_creative_matrix
// (single source of truth); this module only shapes the RPC payload for render.
//
// HARD POLICY verdanote-winners-decided-by-spend-first: cell FILL is ALWAYS a
// function of SUM(spend), never ROAS — in every view mode. The mode only changes
// the text a cell displays; the color stays spend-driven.

import type { MatrixCell, MatrixCreativeType } from "./api";

export type ViewMode = "performance" | "status" | "coverage" | "volume" | "winrate";

export interface ViewModeMeta {
  key: ViewMode;
  label: string;
}

export const VIEW_MODES: ViewModeMeta[] = [
  { key: "performance", label: "Performance" },
  { key: "status", label: "Status" },
  { key: "coverage", label: "Coverage" },
  { key: "volume", label: "Volume" },
  { key: "winrate", label: "Win rate" },
];

// Brand verdant green (#1B7A4E) as an rgb triple, so we can vary alpha by spend.
const VERDANT_RGB = "27, 122, 78";

/**
 * Cell background for a given spend, scaled against the board's max cell spend.
 * intensity = spend / maxSpend; alpha uses sqrt for perceptual spread so mid
 * spenders stay visible. Zero spend (whitespace) renders transparent.
 */
export function spendColor(spend: number, maxSpend: number): string {
  if (!(spend > 0) || !(maxSpend > 0)) return "transparent";
  const intensity = Math.min(1, spend / maxSpend);
  const alpha = 0.12 + 0.78 * Math.sqrt(intensity); // 0.12 .. 0.90
  return `rgba(${VERDANT_RGB}, ${alpha.toFixed(3)})`;
}

/** White text once the fill is dark enough to hurt contrast; else inherit. */
export function spendTextColor(spend: number, maxSpend: number): string {
  if (!(spend > 0) || !(maxSpend > 0)) return "";
  const intensity = Math.min(1, spend / maxSpend);
  return intensity >= 0.55 ? "#ffffff" : "";
}

export const fmtMoney = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * The primary label shown inside a cell for the active view mode. Coloring is
 * spend-based in EVERY mode; only this text changes. Empty ("") means render
 * whitespace (no ads in that angle×type combo, or nothing to show).
 *
 * `angleSpend` is the total spend of this cell's Theme/Persona column, used by
 * the win-rate mode (see below).
 */
export function cellDisplay(
  cell: MatrixCell | undefined,
  mode: ViewMode,
  angleSpend: number,
): string {
  if (!cell || cell.n_ads === 0) {
    return mode === "volume" ? "0" : "";
  }
  switch (mode) {
    case "performance":
      return fmtMoney(cell.total_spend);
    case "status":
      return cell.test_status && cell.test_status.trim() ? cell.test_status : "Untested";
    case "coverage":
      return "●"; // ● — this angle×type is covered
    case "volume":
      return String(cell.n_ads);
    case "winrate": {
      // Spend-first "win rate": the share of this Theme/Persona column's spend
      // captured by this creative type — how much of the theme's spend this
      // type wins. Bounded 0–100%, derived PURELY from spend (never ROAS) per
      // verdanote-winners-decided-by-spend-first.
      if (!(angleSpend > 0)) return "0%";
      return `${Math.round((cell.total_spend / angleSpend) * 100)}%`;
    }
    default:
      return "";
  }
}

/** Stable map key for an (angle, type) pair; NUL sentinel stands in for null. */
export function cellKey(angleId: string | null, creativeType: string | null): string {
  return `${angleId ?? "\u0000"}|${creativeType ?? "\u0000"}`;
}

export function indexCells(cells: MatrixCell[]): Map<string, MatrixCell> {
  const m = new Map<string, MatrixCell>();
  for (const c of cells) m.set(cellKey(c.angle_id, c.creative_type), c);
  return m;
}

export function maxCellSpend(cells: MatrixCell[]): number {
  let max = 0;
  for (const c of cells) if (c.total_spend > max) max = c.total_spend;
  return max;
}

export interface LaneGroup {
  lane: string;
  types: MatrixCreativeType[];
}

/**
 * Group the spend-ordered creative-type rows by their creative lane, using a
 * type_name → lane map sourced from the account taxonomy (US-003). Types with no
 * lane mapping fall into "Other"; the untagged creative-type bucket gets its own
 * "Untagged" lane, always placed last. Incoming spend order is preserved within
 * each lane, and lanes appear in first-seen (≈ highest-spend-first) order.
 */
export function groupTypesByLane(
  types: MatrixCreativeType[],
  typeNameToLane: Map<string, string>,
): LaneGroup[] {
  const UNTAGGED = "Untagged";
  const OTHER = "Other";
  const byLane = new Map<string, MatrixCreativeType[]>();
  const laneOrder: string[] = [];

  for (const t of types) {
    const lane =
      t.creative_type === null ? UNTAGGED : typeNameToLane.get(t.creative_type) ?? OTHER;
    let list = byLane.get(lane);
    if (!list) {
      list = [];
      byLane.set(lane, list);
      laneOrder.push(lane);
    }
    list.push(t);
  }

  // Stable sort that only forces the Untagged lane to the end.
  laneOrder.sort((a, b) => (a === UNTAGGED ? 1 : 0) - (b === UNTAGGED ? 1 : 0));
  return laneOrder.map((lane) => ({ lane, types: byLane.get(lane)! }));
}
