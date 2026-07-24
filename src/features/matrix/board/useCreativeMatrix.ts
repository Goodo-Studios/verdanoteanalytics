// US-007: react-query hook for the creative-matrix board read path. Thin wrapper
// over fetchCreativeMatrix (the session-authed `matrix` edge fn). Read-only — no
// mutations — so unlike the config hook there is no cache-write plumbing.

import { useQuery } from "@tanstack/react-query";
import {
  CreativeMatrix,
  CreativeMatrixCell,
  fetchCreativeMatrix,
  fetchCreativeMatrixCell,
} from "./api";

export const creativeMatrixQueryKey = (
  accountId: string | null | undefined,
  dateFrom?: string | null,
  dateTo?: string | null,
) => ["creative-matrix", accountId, dateFrom ?? null, dateTo ?? null] as const;

export function useCreativeMatrix(
  accountId: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
) {
  return useQuery<CreativeMatrix>({
    queryKey: creativeMatrixQueryKey(accountId, dateFrom, dateTo),
    queryFn: () => fetchCreativeMatrix({ accountId: accountId!, dateFrom, dateTo }),
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

// ── US-008: cell drill-down query ────────────────────────────────────────────

export const creativeMatrixCellQueryKey = (
  accountId: string | null | undefined,
  angleId: string | null,
  creativeType: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
) =>
  [
    "creative-matrix-cell",
    accountId,
    angleId,
    creativeType,
    dateFrom ?? null,
    dateTo ?? null,
  ] as const;

/**
 * Fetch one outer cell's inner hook × body grid + atomic ads. `enabled` only
 * when both an account and a selected cell are present, so nothing fires until
 * a strategist actually drills in. angleId / creativeType null are legitimate
 * selectors (the untagged buckets), so the cell is keyed by `hasCell`.
 */
export function useCreativeMatrixCell(
  accountId: string | null,
  hasCell: boolean,
  angleId: string | null,
  creativeType: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
) {
  return useQuery<CreativeMatrixCell>({
    queryKey: creativeMatrixCellQueryKey(accountId, angleId, creativeType, dateFrom, dateTo),
    queryFn: () =>
      fetchCreativeMatrixCell({ accountId: accountId!, angleId, creativeType, dateFrom, dateTo }),
    enabled: !!accountId && hasCell,
    staleTime: 30_000,
  });
}
