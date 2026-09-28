// react-query hooks for the creative-matrix board read path. Thin wrapper
// over fetchCreativeMatrix / fetchCreativeMatrixCell (the session-authed
// `matrix` edge fn). Read-only — no mutations.

import { useQuery } from "@tanstack/react-query";
import {
  CreativeMatrix,
  CreativeMatrixCell,
  fetchCreativeMatrix,
  fetchCreativeMatrixCell,
} from "./api";

const creativeMatrixQueryKey = (
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

// ── Cell drill-down query (ads split by hook) ────────────────────────────────

const creativeMatrixCellQueryKey = (
  accountId: string | null | undefined,
  creativeType: string | null,
  theme: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
) =>
  [
    "creative-matrix-cell",
    accountId,
    creativeType,
    theme,
    dateFrom ?? null,
    dateTo ?? null,
  ] as const;

/**
 * Fetch one Creative Type × Theme cell's hook split + atomic ads. `enabled`
 * only when both an account and a selected cell are present, so nothing fires
 * until a strategist actually drills in. creativeType / theme null are
 * legitimate selectors (the Other / untagged buckets), so the cell is keyed by
 * `hasCell`.
 */
export function useCreativeMatrixCell(
  accountId: string | null,
  hasCell: boolean,
  creativeType: string | null,
  theme: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
) {
  return useQuery<CreativeMatrixCell>({
    queryKey: creativeMatrixCellQueryKey(accountId, creativeType, theme, dateFrom, dateTo),
    queryFn: () =>
      fetchCreativeMatrixCell({ accountId: accountId!, creativeType, theme, dateFrom, dateTo }),
    enabled: !!accountId && hasCell,
    staleTime: 30_000,
  });
}
