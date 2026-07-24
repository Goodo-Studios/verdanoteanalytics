// US-007: Typed client for the session-authed `matrix` edge function — the
// in-app read path for the 2-D creative matrix (Theme/Persona × creative-type
// cross-tab, spend-ranked).
//
// In-app UI policy (mirrors ../config/api.ts): ALL matrix reads go through the
// first-party, session-authed edge function via supabase.functions.invoke —
// never the key-gated external `api` function. The edge fn verifies the session
// JWT + account ownership server-side, then reads the single rpc_creative_matrix
// path so React, GET /api/matrix, and verdanote-read-mcp see byte-identical
// numbers.
//
// HARD POLICY verdanote-winners-decided-by-spend-first: the RPC ranks + orders
// cells by SUM(spend) DESC only. This client returns the RPC's jsonb payload
// VERBATIM — no JS re-sort / re-rank / re-shape; the board colors by spend too.

import { supabase } from "@/integrations/supabase/client";

/** One Theme/Persona column from rpc_creative_matrix `angles` (spend DESC, untagged last). */
export interface MatrixAngle {
  /** null = the explicit untagged Theme/Persona bucket. */
  angle_id: string | null;
  /** 'Untagged' for the untagged bucket. */
  label: string | null;
  test_status: string | null;
  archived: boolean;
  total_spend: number;
}

/** One creative-type row from rpc_creative_matrix `creative_types` (spend DESC, untagged last). */
export interface MatrixCreativeType {
  /** null = the explicit untagged creative-type bucket. */
  creative_type: string | null;
  total_spend: number;
}

/** One angle×type cell. Ratios are DERIVED from summed bases in the RPC. */
export interface MatrixCell {
  angle_id: string | null;
  angle_label: string | null;
  is_untagged_angle: boolean;
  test_status: string | null;
  creative_type: string | null;
  is_untagged_type: boolean;
  total_spend: number;
  n_ads: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpm: number;
  purchases: number;
  total_purchase_value: number;
  result_count: number;
  cost_per_result: number;
  /** RANK() over cells by SUM(spend) DESC (untagged-on-either-axis last). */
  spend_rank: number;
}

/** The rpc_creative_matrix jsonb payload, returned verbatim by the edge fn. */
export interface CreativeMatrix {
  account_id: string;
  date_from: string | null;
  date_to: string | null;
  angles: MatrixAngle[];
  creative_types: MatrixCreativeType[];
  cells: MatrixCell[];
}

export interface FetchMatrixParams {
  accountId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function fetchCreativeMatrix({
  accountId,
  dateFrom,
  dateTo,
}: FetchMatrixParams): Promise<CreativeMatrix> {
  // The `matrix` edge fn is GET + query params (validation shared with GET
  // /api/matrix). supabase-js builds `${functionsUrl}/${name}` via `new URL(...)`
  // so a query string carried on the name is preserved; method:"GET" sends no
  // body, and the functions client attaches the user's session JWT.
  const qs = new URLSearchParams({ account_id: accountId });
  if (dateFrom) qs.set("date_from", dateFrom);
  if (dateTo) qs.set("date_to", dateTo);

  const { data, error } = await supabase.functions.invoke(`matrix?${qs.toString()}`, {
    method: "GET",
  });
  if (error) {
    // supabase-js nulls data on non-2xx; surface the server error when present.
    throw new Error(error.message ?? "Matrix request failed");
  }
  return (data as { matrix: CreativeMatrix }).matrix;
}
