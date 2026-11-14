// Pure, unit-testable view helpers for the Creative Matrix board — spend-first
// coloring, per-mode cell display, fixed Creative Type row order, cell lookup,
// and the hook split inside a cell. No React, no I/O: aggregation/ranking
// already happened in rpc_creative_matrix / rpc_creative_matrix_theme_cell;
// this module only shapes the RPC payload for render.
//
// HARD POLICY verdanote-winners-decided-by-spend-first: cell FILL is ALWAYS a
// function of SUM(spend), never ROAS — in every view mode. The mode only changes
// the text a cell displays; the color stays spend-driven.

import {
  CREATIVE_TYPE_ROWS,
  OTHER_CREATIVE_TYPE_LABEL,
  type MatrixAtomicAd,
  type MatrixCell,
  type MatrixCellHook,
  type MatrixCreativeType,
} from "./api";

export type ViewMode = "performance" | "coverage" | "volume" | "winrate";

export interface ViewModeMeta {
  key: ViewMode;
  label: string;
}

export const VIEW_MODES: ViewModeMeta[] = [
  { key: "performance", label: "Performance" },
  { key: "coverage", label: "Coverage" },
  { key: "volume", label: "Volume" },
  { key: "winrate", label: "Share of theme spend" },
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

/** Row label for a Creative Type; null ⇒ the Other / untagged row. */
export function creativeTypeLabel(creativeType: string | null): string {
  return creativeType === null ? OTHER_CREATIVE_TYPE_LABEL : creativeType;
}

/** Display label for a theme or hook value; null ⇒ the explicit untagged bucket. */
export function tagLabel(value: string | null): string {
  return value === null ? "Untagged" : value;
}

/**
 * The primary label shown inside a cell for the active view mode. Coloring is
 * spend-based in EVERY mode; only this text changes. Empty ("") means render
 * whitespace (no ads in that type×theme combo).
 *
 * `themeSpend` is the total spend of this cell's Theme column, used by the
 * share-of-theme-spend mode (internal id "winrate"): the share of the theme's spend won by this Creative Type,
 * derived PURELY from spend (never ROAS).
 */
export function cellDisplay(
  cell: MatrixCell | undefined,
  mode: ViewMode,
  themeSpend: number,
): string {
  if (!cell || cell.n_ads === 0) {
    return mode === "volume" ? "0" : "";
  }
  switch (mode) {
    case "performance":
      return fmtMoney(cell.total_spend);
    case "coverage":
      return "●";
    case "volume":
      return String(cell.n_ads);
    case "winrate": {
      if (!(themeSpend > 0)) return "0%";
      return `${Math.round((cell.total_spend / themeSpend) * 100)}%`;
    }
    default:
      return "";
  }
}

/** Stable map key for a (creative type, theme) pair; NUL sentinel stands in for null. */
export function cellKey(creativeType: string | null, theme: string | null): string {
  return `${creativeType ?? "\u0000"}|${theme ?? "\u0000"}`;
}

export function indexCells(cells: MatrixCell[]): Map<string, MatrixCell> {
  const m = new Map<string, MatrixCell>();
  for (const c of cells) m.set(cellKey(c.creative_type, c.theme), c);
  return m;
}

export function maxCellSpend(cells: { total_spend: number }[]): number {
  let max = 0;
  for (const c of cells) if (c.total_spend > max) max = c.total_spend;
  return max;
}

/**
 * The board's rows: always the 4 Creative Types in the fixed naming-convention
 * order (UGC Native, Studio Clean, Text Forward, Lifestyle), each carrying its
 * RPC totals (zero when the RPC has none), then the Other / untagged row only
 * when the RPC emitted it (i.e. it has ads in scope). Any other value the RPC
 * might carry is ignored — the RPC already buckets unknown styles into Other.
 */
export function boardRows(types: MatrixCreativeType[]): MatrixCreativeType[] {
  const byType = new Map<string, MatrixCreativeType>();
  let other: MatrixCreativeType | undefined;
  for (const t of types) {
    if (t.creative_type === null || t.is_other) other = t;
    else byType.set(t.creative_type, t);
  }
  const rows: MatrixCreativeType[] = CREATIVE_TYPE_ROWS.map(
    (name) =>
      byType.get(name) ?? { creative_type: name, is_other: false, total_spend: 0, n_ads: 0 },
  );
  if (other) rows.push({ ...other, creative_type: null, is_other: true });
  return rows;
}

// ── Cell drill-down: ads split by exact hook ─────────────────────────────────

/** Hook row label: spend money once there are ads, else whitespace. */
export function hookRowDisplay(hook: MatrixCellHook | undefined): string {
  if (!hook || hook.n_ads === 0) return "";
  return fmtMoney(hook.total_spend);
}

/** Stable key for a hook row; NUL sentinel stands in for the untagged bucket. */
export function hookKey(hook: string | null): string {
  return hook ?? "\u0000";
}

/**
 * The atomic ads carrying one exact hook, highest-spend first. null matches the
 * untagged hook bucket — untagged ads are surfaced, never hidden. The RPC
 * already orders `ads` by spend DESC; the filter preserves that order.
 */
export function adsForHook(ads: MatrixAtomicAd[], hook: string | null): MatrixAtomicAd[] {
  return ads.filter((a) => a.hook === hook);
}
