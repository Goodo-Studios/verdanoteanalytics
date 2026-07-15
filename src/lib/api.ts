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
 * Spend-ranked hook/angle leaderboard + tag-coverage header for one account.
 * Aggregation/ranking lives only in the SQL RPC (single source of truth);
 * callers render `rows` in the order received.
 *
 * Served by the first-party, session-authed `leaderboard` edge function — NOT
 * the external `api` function (that one is gated by provisioned API keys, so an
 * in-app session JWT is rejected with "Invalid API key"). The leaderboard
 * function verifies the session JWT, enforces per-account ownership, then calls
 * the SECURITY DEFINER RPCs via service role.
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
  return apiFetch("leaderboard", `?${params.toString()}`) as Promise<LibraryResponse>;
}

/** One destination row from the Landing Pages report (Creative Terminal — Feature 1).
 * Ratios are derived in the SQL RPC from summed base metrics — render verbatim,
 * never recompute. Percentages (cvr, atc_rate, ctr) are already true percentages. */
export interface LandingPageRow {
  destination_key: string;
  creative_count: number;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  adds_to_cart: number;
  video_views: number;
  roas: number;
  cpa: number;
  cvr: number;
  atc_rate: number;
  aov: number;
  ctr: number;
  cpm: number;
  cpc: number;
}

export interface LandingPagesResponse {
  account_id: string;
  from: string;
  to: string;
  min_spend: number;
  rows: LandingPageRow[];
}

/**
 * Landing Pages report for one account: every ad destination consolidated across
 * duplicate/UTM-variant links, over a date window. Served by the first-party,
 * session-authed `landing-pages` edge function (verifies the session JWT, enforces
 * per-account ownership, then calls the SECURITY DEFINER RPC via service role —
 * direct authenticated RPC access was revoked to close a cross-account IDOR).
 * Aggregation lives only in the SQL RPC; callers render `rows` in the order received.
 */
export async function getLandingPages(
  accountId: string,
  from?: string,
  to?: string,
  minSpend = 0,
): Promise<LandingPagesResponse> {
  const params = new URLSearchParams({ account_id: accountId, min_spend: String(minSpend) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return apiFetch("landing-pages", `?${params.toString()}`) as Promise<LandingPagesResponse>;
}
