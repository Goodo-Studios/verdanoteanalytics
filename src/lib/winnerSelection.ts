import type { Account } from "@/types/account";

/**
 * Single source of truth for "who is a winner" — the exact scale-threshold
 * logic that `useOverviewPageState` uses to compute `winRate` (the same source
 * builders/strategists see). Extracted so the client "What's working" surface
 * (US-004) and the strategist overview cannot diverge on who counts as winning.
 *
 * Mirrors useOverviewPageState's winRate definition:
 *   - active = creatives with spend > 0
 *   - winnerKpi = kill_scale_kpi || winner_kpi || "roas"
 *   - direction = kill_scale_kpi_direction || winner_kpi_direction || "gte"
 *   - threshold = scale_threshold || winner_roas_threshold (default 2.0)
 *   - gte:  val >= threshold
 *   - lte:  val > 0 && val <= threshold
 */
export interface WinnerThresholdConfig {
  winnerKpi: string;
  isGte: boolean;
  threshold: number;
}

/** Resolve the winner threshold config from an account, identically to useOverviewPageState. */
export function resolveWinnerConfig(account: Account | null | undefined): WinnerThresholdConfig {
  const roasThreshold = parseFloat((account as any)?.winner_roas_threshold || "2.0");
  const winnerKpi =
    (account as any)?.kill_scale_kpi || (account as any)?.winner_kpi || "roas";
  const winnerKpiDirection =
    (account as any)?.kill_scale_kpi_direction ||
    (account as any)?.winner_kpi_direction ||
    "gte";
  const threshold = parseFloat((account as any)?.scale_threshold || "0") || roasThreshold;
  return {
    winnerKpi,
    isGte: winnerKpiDirection !== "lte",
    threshold,
  };
}

/** True if a single creative qualifies as a winner under the given config. */
export function isWinner(creative: Record<string, any>, config: WinnerThresholdConfig): boolean {
  if ((Number(creative.spend) || 0) <= 0) return false;
  const val = Number(creative[config.winnerKpi]) || 0;
  return config.isGte ? val >= config.threshold : val > 0 && val <= config.threshold;
}

/**
 * Select the winning creatives from a list, sorted best-first by the winner KPI.
 * Same active-spend gate + threshold rule as useOverviewPageState's winRate.
 */
export function selectWinners<T extends Record<string, any>>(
  creatives: T[],
  config: WinnerThresholdConfig,
): T[] {
  const winners = creatives.filter((c) => isWinner(c, config));
  const dir = config.isGte ? -1 : 1; // gte → highest first; lte → lowest first
  return [...winners].sort(
    (a, b) =>
      dir * ((Number(a[config.winnerKpi]) || 0) - (Number(b[config.winnerKpi]) || 0)),
  );
}
