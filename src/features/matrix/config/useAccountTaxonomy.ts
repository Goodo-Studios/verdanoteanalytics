// US-003: react-query hook + mutations for the account taxonomy config surface.
//
// Every edge-function action responds with a fresh `taxonomy` payload, so each
// mutation writes that payload straight into the query cache
// (queryClient.setQueryData) instead of invalidating — no refetch round-trip,
// and the UI is consistent with what the server just committed.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccountTaxonomy,
  SeedResult,
  createTheme,
  fetchTaxonomy,
  renameTheme,
  seedTaxonomy,
  setCreativeTypeActive,
  setThemeArchived,
} from "./api";

export const taxonomyQueryKey = (accountId: string | null | undefined) =>
  ["account-taxonomy", accountId] as const;

export function useAccountTaxonomy(accountId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery<AccountTaxonomy>({
    queryKey: taxonomyQueryKey(accountId),
    queryFn: () => fetchTaxonomy(accountId!),
    enabled: !!accountId,
    staleTime: 30_000,
  });

  const writeCache = (taxonomy: AccountTaxonomy) => {
    if (accountId) queryClient.setQueryData(taxonomyQueryKey(accountId), taxonomy);
  };

  const create = useMutation({
    mutationFn: (name: string) => createTheme(accountId!, name),
    onSuccess: (res) => writeCache(res.taxonomy),
  });

  const rename = useMutation({
    mutationFn: ({ angleId, name }: { angleId: string; name: string }) =>
      renameTheme(accountId!, angleId, name),
    onSuccess: (res) => writeCache(res.taxonomy),
  });

  const setArchived = useMutation({
    mutationFn: ({ angleId, archived }: { angleId: string; archived: boolean }) =>
      setThemeArchived(accountId!, angleId, archived),
    onSuccess: (res) => writeCache(res.taxonomy),
  });

  const setTypeActive = useMutation({
    mutationFn: ({ creativeTypeId, active }: { creativeTypeId: string; active: boolean }) =>
      setCreativeTypeActive(accountId!, creativeTypeId, active),
    onSuccess: (res) => writeCache(res.taxonomy),
  });

  const seed = useMutation<{ seed: SeedResult; taxonomy: AccountTaxonomy }>({
    mutationFn: () => seedTaxonomy(accountId!),
    onSuccess: (res) => writeCache(res.taxonomy),
  });

  return { query, create, rename, setArchived, setTypeActive, seed };
}
