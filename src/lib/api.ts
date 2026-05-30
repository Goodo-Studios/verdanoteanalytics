import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function apiFetch(
  functionName: string,
  path: string = "",
  options: RequestInit = {}
): Promise<any> {
  const url = `${SUPABASE_URL}/functions/v1/${functionName}${path ? `/${path}` : ""}`;

  // Get current session token
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(error.error || `API error: ${resp.status}`);
  }

  return resp.json();
}

/** Dimension served by GET /library — `theme` is surfaced to users as "Angle". */
export type LibraryDimension = "hook" | "theme";

/** Coverage header returned alongside the leaderboard. Numbers come straight
 * from rpc_hook_angle_coverage — never recomputed client-side. */
export interface LibraryCoverage {
  total_spend: number;
  tagged_spend: number;
  untagged_spend: number;
  tag_coverage_pct: number;
}

/** One leaderboard row. Already ranked by the RPC (is_untagged ASC, then
 * total_spend DESC); the untagged bucket (is_untagged=true) arrives last. */
export interface LibraryRow {
  label: string;
  is_untagged: boolean;
  total_spend: number;
  n_ads: number;
  avg_roas: number;
  avg_ctr: number;
  total_purchase_value: number;
}

export interface LibraryResponse {
  dimension: LibraryDimension;
  coverage: LibraryCoverage;
  /** Rows in RPC order — render verbatim, never re-sort or re-rank. */
  rows: LibraryRow[];
}

/**
 * GET /library — spend-ranked hook/angle leaderboard + tag-coverage header for
 * one account. Aggregation/ranking lives only in the SQL RPC (single source of
 * truth); callers render `rows` in the order received.
 */
export async function getLibrary(
  accountId: string,
  dimension: LibraryDimension = "hook",
  limit = 100
): Promise<LibraryResponse> {
  const params = new URLSearchParams({
    account_id: accountId,
    dimension,
    limit: String(limit),
  });
  return apiFetch("api", `library?${params.toString()}`) as Promise<LibraryResponse>;
}
