import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCreativeLibrary, type LibraryCreative } from "../api";
// Single source of truth for the F6 rules — shared with the edge function's
// classification RPC contract (percentages are already true percentages).
import {
  classifyAll,
  type ClassificationInput,
  type ClassificationResult,
  type CreativeClass,
} from "../../../../supabase/functions/_shared/creative-classification.ts";

export type { CreativeClass, ClassificationResult };

export interface LibraryData {
  rows: LibraryCreative[];
  from: string;
  to: string;
  classification: Map<string, ClassificationResult>;
  counts: Record<CreativeClass, number>;
}

/** Map a library row into the classifier's input shape. */
function toClassInput(r: LibraryCreative): ClassificationInput {
  return {
    ad_id: r.ad_id,
    spend: r.spend,
    roas: r.roas,
    cpa: r.cpa,
    ctr: r.ctr,
    thumb_stop_rate: r.thumb_stop_rate,
    purchases: r.purchases,
    frequency: r.frequency,
    recent_spend: r.recent_spend,
    prior_spend: r.prior_spend,
    recent_roas: r.recent_roas,
    prior_roas: r.prior_roas,
    recent_ctr: r.recent_ctr,
    prior_ctr: r.prior_ctr,
    recent_cpa: r.recent_cpa,
    prior_cpa: r.prior_cpa,
  };
}

/**
 * Fetch the account's live creatives + window performance, then classify them
 * (Winner / Rising / Fatiguing / neutral) client-side using the shared F6 rules.
 * The classification is memoized against the fetched rows.
 */
export function useCreativeLibrary(accountId: string | null | undefined, from: string, to: string) {
  const query = useQuery<{ rows: LibraryCreative[]; from: string; to: string }>({
    queryKey: ["creative-library", accountId ?? "none", from, to],
    enabled: !!accountId,
    queryFn: async () => {
      const res = await fetchCreativeLibrary(accountId!, from, to);
      return { rows: res.rows ?? [], from: res.from, to: res.to };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const data: LibraryData | undefined = useMemo(() => {
    if (!query.data) return undefined;
    const classification = classifyAll(query.data.rows.map(toClassInput));
    const counts: Record<CreativeClass, number> = {
      winner: 0,
      rising: 0,
      fatiguing: 0,
      neutral: 0,
    };
    for (const r of classification.values()) counts[r.klass]++;
    return { rows: query.data.rows, from: query.data.from, to: query.data.to, classification, counts };
  }, [query.data]);

  return { ...query, data };
}
