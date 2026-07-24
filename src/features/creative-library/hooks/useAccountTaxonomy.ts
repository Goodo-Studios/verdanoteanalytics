import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildAccountTagOptions,
  type AccountTagOptions,
  type AccountTaxonomy,
} from "@/lib/tagOptions";
import { fetchAccountTaxonomy, fetchBodyVocabulary } from "../api";

/**
 * US-004: load an account's governed tag lists (Theme/Persona, activated creative
 * types, body vocabulary) and project them into the option shapes the governed
 * tag editor renders. Two reads — the taxonomy RPC (via the account-taxonomy edge
 * fn) and the account's in-use body values — are fetched in parallel and memoized
 * into a single AccountTagOptions.
 */
export function useAccountTaxonomy(accountId: string | null | undefined) {
  const taxonomyQuery = useQuery<AccountTaxonomy>({
    queryKey: ["account-taxonomy", accountId ?? "none"],
    enabled: !!accountId,
    queryFn: () => fetchAccountTaxonomy(accountId!),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const bodyQuery = useQuery<string[]>({
    queryKey: ["account-body-vocab", accountId ?? "none"],
    enabled: !!accountId,
    queryFn: () => fetchBodyVocabulary(accountId!),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const options: AccountTagOptions = useMemo(
    () => buildAccountTagOptions(taxonomyQuery.data, bodyQuery.data),
    [taxonomyQuery.data, bodyQuery.data],
  );

  return {
    options,
    taxonomy: taxonomyQuery.data,
    isLoading: taxonomyQuery.isLoading || bodyQuery.isLoading,
    isError: taxonomyQuery.isError || bodyQuery.isError,
    error: taxonomyQuery.error ?? bodyQuery.error,
    refetch: () => {
      void taxonomyQuery.refetch();
      void bodyQuery.refetch();
    },
  };
}
