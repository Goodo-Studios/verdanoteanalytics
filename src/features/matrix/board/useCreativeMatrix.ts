// US-007: react-query hook for the creative-matrix board read path. Thin wrapper
// over fetchCreativeMatrix (the session-authed `matrix` edge fn). Read-only — no
// mutations — so unlike the config hook there is no cache-write plumbing.

import { useQuery } from "@tanstack/react-query";
import { CreativeMatrix, fetchCreativeMatrix } from "./api";

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
