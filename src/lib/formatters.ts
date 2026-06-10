/**
 * Shared formatting utilities used across pages and components.
 * Consolidates duplicated fmt$, fmtReport, fmtN, fmtPct, delta helpers.
 */

/** Format a dollar amount with k/M abbreviation */
export function fmt$(n: number): string {
  if (!isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** Format a nullable number with optional prefix/suffix — used in reports and tables */
export function fmtMetric(v: number | null | undefined, prefix = "", suffix = "", decimals = 2): string {
  if (v === null || v === undefined) return "—";
  if (!isFinite(Number(v))) return "—";
  return `${prefix}${Number(v).toLocaleString("en-US", { maximumFractionDigits: decimals })}${suffix}`;
}

/** Format a number with commas */
export function fmtN(n: number): string {
  if (!isFinite(n)) return '—';
  return n.toLocaleString();
}

/** Format a percentage */
export function fmtPct(n: number): string {
  if (!isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** Format a signed percentage change (e.g. +12% / -5%) */
export function fmtSignedPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}

/** Compute delta percentage between current and previous values */
export function delta(cur: number, prev: number | undefined): { value: number; positive: boolean } | undefined {
  if (prev == null || prev === 0) return undefined;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { value: Math.round(Math.abs(pct)), positive: pct >= 0 };
}

/** Inverse delta — positive when value decreases (e.g. CPA) */
export function deltaInverse(cur: number, prev: number | undefined): { value: number; positive: boolean } | undefined {
  const d = delta(cur, prev);
  if (!d) return undefined;
  return { ...d, positive: !d.positive };
}
