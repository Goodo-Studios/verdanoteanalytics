import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// US-005: On-demand long-range per-ad aggregates served from creative_daily_metrics.
//
// Long-range views (30/90/180/365d) are computed at query time by the
// get_creative_window_aggregates RPC — the same summable+derived contract as the
// US-003 snapshot rollup — instead of storing a wide per-window snapshot. This is
// what makes a full year cheap to hold: no stored 365d column, just a daily-grain
// sum backed by idx_daily_metrics_account_date.
//
// RETENTION_DAYS caps the requestable window; the RPC also enforces this
// server-side and rejects anything wider.
export const RETENTION_DAYS = 365;

// Common windows the UI can request directly. 365 is the full retained year.
export const WINDOW_PRESETS = [30, 90, 180, 365] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];

export interface CreativeWindowAggregate {
  ad_id: string;
  /** Joined from the creatives table when available; null when the ad is not found. */
  ad_name?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  adds_to_cart: number;
  video_views: number;
  // Derived ratios stay null when the RPC has no value (e.g. no purchases), not 0.
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  cost_per_add_to_cart: number | null;
  thumb_stop_rate: number | null;
  hold_rate: number | null;
  video_avg_play_time: number | null;
  // APPROXIMATE: impression-weighted mean daily frequency (no local reach).
  frequency: number | null;
  retention_p25: number | null;
  retention_p50: number | null;
  retention_p75: number | null;
  retention_p100: number | null;
}

// Format a Date as a UTC YYYY-MM-DD `date` literal (matches the RPC's date args).
function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Keep null/undefined as null. `Number(null) || 0` would turn "no value" into 0, which then
// reads as a perfect CPA or a zero ROAS.
function nullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const NAME_LOOKUP_CHUNK = 150;

async function fetchAdNames(accountId: string, adIds: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  for (let i = 0; i < adIds.length; i += NAME_LOOKUP_CHUNK) {
    const chunk = adIds.slice(i, i + NAME_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("creatives")
      .select("ad_id, ad_name")
      .eq("account_id", accountId)
      .in("ad_id", chunk);
    // Names are a display nicety; never fail the aggregates because the lookup failed.
    if (error || !data) continue;
    for (const r of data as { ad_id: string; ad_name: string | null }[]) names.set(r.ad_id, r.ad_name);
  }
  return names;
}

/**
 * Resolve a rolling window of `days` ending YESTERDAY (UTC, inclusive) into { from, to }
 * `date` params. Yesterday, not today: the date presets elsewhere end yesterday and today's
 * daily row is still partial. `days` is clamped to [1, RETENTION_DAYS] so the UI can never
 * request beyond the retained year (the RPC also rejects over-wide windows).
 */
export function resolveWindowRange(
  days: number,
  now: Date = new Date()
): { from: string; to: string } {
  const clamped = Math.max(1, Math.min(RETENTION_DAYS, Math.floor(days)));
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  // Inclusive endpoints: a `days`-long window spans (days - 1) prior days + the end day.
  from.setUTCDate(from.getUTCDate() - (clamped - 1));
  return { from: toDateParam(from), to: toDateParam(to) };
}

interface UseWindowAggregatesOptions {
  enabled?: boolean;
}

/**
 * Fetch per-ad aggregates for an arbitrary window (up to RETENTION_DAYS) served
 * from daily rows. Pass either a preset number of days (30/90/180/365, or any
 * value up to 365) — the hook resolves it to a from/to range and calls the
 * get_creative_window_aggregates RPC.
 */
export function useWindowAggregates(
  accountId: string | undefined,
  days: number,
  options: UseWindowAggregatesOptions = {}
) {
  const { from, to } = resolveWindowRange(days);
  const enabled = (options.enabled ?? true) && !!accountId;

  return useQuery<CreativeWindowAggregate[]>({
    queryKey: ["window-aggregates", accountId ?? "none", from, to],
    staleTime: 5 * 60 * 1000,
    enabled,
    queryFn: async () => {
      if (!accountId) return [];

      const { data, error } = await supabase.rpc("get_creative_window_aggregates", {
        p_account_id: accountId,
        p_from: from,
        p_to: to,
      });

      if (error) throw error;
      if (!data) return [];

      const names = await fetchAdNames(accountId, (data as CreativeWindowAggregate[]).map((r) => r.ad_id));

      return (data as CreativeWindowAggregate[]).map((row) => ({
        ad_id: row.ad_id,
        ad_name: names.get(row.ad_id) ?? null,
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        purchases: Number(row.purchases) || 0,
        purchase_value: Number(row.purchase_value) || 0,
        adds_to_cart: Number(row.adds_to_cart) || 0,
        video_views: Number(row.video_views) || 0,
        roas: nullableNumber(row.roas),
        cpa: nullableNumber(row.cpa),
        ctr: nullableNumber(row.ctr),
        cpm: nullableNumber(row.cpm),
        cpc: nullableNumber(row.cpc),
        cost_per_add_to_cart: nullableNumber(row.cost_per_add_to_cart),
        thumb_stop_rate: nullableNumber(row.thumb_stop_rate),
        hold_rate: nullableNumber(row.hold_rate),
        video_avg_play_time: nullableNumber(row.video_avg_play_time),
        frequency: nullableNumber(row.frequency),
        retention_p25: row.retention_p25 == null ? null : Number(row.retention_p25),
        retention_p50: row.retention_p50 == null ? null : Number(row.retention_p50),
        retention_p75: row.retention_p75 == null ? null : Number(row.retention_p75),
        retention_p100: row.retention_p100 == null ? null : Number(row.retention_p100),
      }));
    },
  });
}
