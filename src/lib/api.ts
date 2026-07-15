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

// ── Creative Rotation report (Feature 3) ────────────────────────────────────
/** The fresh-window toggle: creative counts as "fresh" if age <= this many days. */
export type FreshDays = 7 | 14 | 30;

/** Window-level freshness KPIs (the RPC's synthetic 'total' row). All ratios are
 * derived in SQL from summed base metrics — never recomputed client-side. */
export interface RotationKpis {
  bucket: "total";
  week_start: null;
  total_spend: number;
  fresh_spend: number;
  mid_spend: number;
  stale_spend: number;
  fresh_spend_pct: number;       // true percentage
  spend_weighted_age: number;    // days
  fresh_purchases: number;
  fresh_spend_conv: number;
  stale_purchases: number;
  fresh_cpa: number;
  stale_cpa: number;
}

/** One ISO-week row for the stacked spend-by-age + freshness-vs-CPA series. */
export interface RotationWeeklyAge {
  bucket: "week";
  week_start: string;            // Monday, YYYY-MM-DD
  total_spend: number;
  fresh_spend: number;
  mid_spend: number;
  stale_spend: number;
  fresh_spend_pct: number;
  spend_weighted_age: number;
  fresh_purchases: number;
  fresh_spend_conv: number;
  stale_purchases: number;
  fresh_cpa: number;
  stale_cpa: number;
}

/** One launch-cohort row (creatives grouped by launch week). */
export interface RotationCohort {
  launch_week: string;           // Monday, YYYY-MM-DD
  creative_count: number;
  still_live: number;
  spend: number;
  spend_share: number;           // true percentage
  purchases: number;
  purchase_value: number;
  cpa: number;
  roas: number;
}

/** One "new ads added over time" row. */
export interface RotationNewAds {
  week_start: string;            // Monday, YYYY-MM-DD
  new_ads: number;
  cumulative: number;
}

export interface CreativeRotationResponse {
  fresh_days: FreshDays;
  from: string;
  to: string;
  kpis: RotationKpis | null;
  weekly_age: RotationWeeklyAge[];
  cohorts: RotationCohort[];
  new_ads_timeline: RotationNewAds[];
}

/**
 * Creative Rotation report data for one account + window. Served by the
 * session-authed `creative-rotation` edge fn (verifies the session JWT, enforces
 * per-account ownership, then calls the IDOR-gated rpc_creative_rotation_* RPCs
 * via service role). All aggregation lives in SQL — render rows verbatim.
 */
export async function getCreativeRotation(
  accountId: string,
  from: string,
  to: string,
  freshDays: FreshDays = 14
): Promise<CreativeRotationResponse> {
  const params = new URLSearchParams({
    account_id: accountId,
    from,
    to,
    fresh_days: String(freshDays),
  });
  return apiFetch("creative-rotation", `?${params.toString()}`) as Promise<CreativeRotationResponse>;
}
