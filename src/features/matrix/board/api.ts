// Typed client for the session-authed `matrix` edge function — the in-app read
// path for the Creative Matrix. The board follows the Goodo ad naming
// convention (migration 20260927200001):
//   rows    = Creative Type (creatives.style): UGC Native, Studio Clean,
//             Text Forward, Lifestyle in that fixed order, then an
//             "Other / untagged" row (creative_type null) for ads with no
//             style or a legacy value outside the 4;
//   columns = Theme / Persona (creatives.theme, exact free text), spend DESC,
//             untagged last;
//   cell    = drill-down that splits the cell's ads by exact hook text.
//
// In-app UI policy: ALL matrix reads go through the first-party, session-authed
// edge function via supabase.functions.invoke — never the key-gated external
// `api` function. The edge fn verifies the session JWT + account ownership
// server-side, then reads rpc_creative_matrix / rpc_creative_matrix_theme_cell.
//
// HARD POLICY verdanote-winners-decided-by-spend-first: the RPC ranks + orders
// cells by SUM(spend) DESC only. This client returns the RPC's jsonb payload
// VERBATIM — no JS re-sort / re-rank / re-shape; the board colors by spend too.

import { supabase } from "@/integrations/supabase/client";

/** The 4 Creative Types, in the fixed row order the RPC emits them. */
export const CREATIVE_TYPE_ROWS = ["UGC Native", "Studio Clean", "Text Forward", "Lifestyle"] as const;

/** Row label for the bucket of ads with no Creative Type or a legacy value. */
export const OTHER_CREATIVE_TYPE_LABEL = "Other / untagged";

/** One Creative Type row from rpc_creative_matrix `creative_types` (fixed order). */
export interface MatrixCreativeType {
  /** null = the Other / untagged row. */
  creative_type: string | null;
  is_other: boolean;
  total_spend: number;
  n_ads: number;
}

/** One Theme / Persona column from rpc_creative_matrix `themes` (spend DESC, untagged last). */
export interface MatrixTheme {
  /** null = the explicit untagged Theme bucket. */
  theme: string | null;
  is_untagged: boolean;
  total_spend: number;
  n_ads: number;
}

/** One Creative Type × Theme cell. Ratios are DERIVED from summed bases in the RPC. */
export interface MatrixCell {
  creative_type: string | null;
  is_other_type: boolean;
  theme: string | null;
  is_untagged_theme: boolean;
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
  /** RANK() over cells by SUM(spend) DESC (other/untagged-on-either-axis last). */
  spend_rank: number;
}

/** The rpc_creative_matrix jsonb payload, returned verbatim by the edge fn. */
export interface CreativeMatrix {
  account_id: string;
  date_from: string | null;
  date_to: string | null;
  creative_types: MatrixCreativeType[];
  themes: MatrixTheme[];
  cells: MatrixCell[];
}

export interface FetchMatrixParams {
  accountId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}

// ── Cell drill-down (ads split by exact hook) ────────────────────────────────

/** One hook row from rpc_creative_matrix_theme_cell `hooks` (untagged last, then spend DESC). */
export interface MatrixCellHook {
  /** null = the explicit untagged hook bucket. */
  hook: string | null;
  is_untagged: boolean;
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
  /** RANK() over hooks by SUM(spend) DESC (untagged hook last). */
  spend_rank: number;
}

/** One atomic ad inside the opened cell. */
export interface MatrixAtomicAd {
  ad_id: string;
  ad_name: string | null;
  /** Meta delivery state, e.g. 'ACTIVE'. */
  ad_status: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  video_url: string | null;
  hook: string | null;
  is_untagged_hook: boolean;
  total_spend: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpm: number;
  purchases: number;
  total_purchase_value: number;
  result_count: number;
  cost_per_result: number;
}

/** The rpc_creative_matrix_theme_cell jsonb payload, returned verbatim by the edge fn. */
export interface CreativeMatrixCell {
  account_id: string;
  creative_type: string | null;
  is_other_type: boolean;
  theme: string | null;
  is_untagged_theme: boolean;
  date_from: string | null;
  date_to: string | null;
  hooks: MatrixCellHook[];
  ads: MatrixAtomicAd[];
}

export interface FetchMatrixCellParams {
  accountId: string;
  /** null ⇒ the Other / untagged Creative Type row. */
  creativeType: string | null;
  /** null ⇒ the untagged Theme column. */
  theme: string | null;
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

/**
 * Fetch one Creative Type × Theme cell's drill-down (ads split by exact hook)
 * through the SAME session-authed `matrix` edge fn (?view=cell). The RPC
 * ranks/orders by SUM(spend); this returns its jsonb payload VERBATIM.
 */
export async function fetchCreativeMatrixCell({
  accountId,
  creativeType,
  theme,
  dateFrom,
  dateTo,
}: FetchMatrixCellParams): Promise<CreativeMatrixCell> {
  const qs = new URLSearchParams({ view: "cell", account_id: accountId });
  // Absent creative_type / theme ⇒ the Other / untagged bucket on that axis
  // (the server reads empty as null); only send concrete values.
  if (creativeType) qs.set("creative_type", creativeType);
  if (theme) qs.set("theme", theme);
  if (dateFrom) qs.set("date_from", dateFrom);
  if (dateTo) qs.set("date_to", dateTo);

  const { data, error } = await supabase.functions.invoke(`matrix?${qs.toString()}`, {
    method: "GET",
  });
  if (error) {
    throw new Error(error.message ?? "Matrix cell request failed");
  }
  return (data as { cell: CreativeMatrixCell }).cell;
}
